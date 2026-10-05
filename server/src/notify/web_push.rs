use std::time::Duration;

use anyhow::{Context, Result};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use reqwest::StatusCode;
use web_push_native::{
    Auth, WebPushBuilder,
    jwt_simple::algorithms::{ECDSAP256PublicKeyLike, ES256KeyPair},
    p256::PublicKey,
};

use super::{Notifier, PushMessage, SendOutcome, Subscription};
use crate::config::PushConfig;

/// How long a push service keeps trying to deliver a reminder to an offline device.
const TIME_TO_LIVE: Duration = Duration::from_secs(12 * 60 * 60);

/// Sends Web Push messages, signed with the server's VAPID key.
pub struct WebPush {
    key_pair: ES256KeyPair,
    subject: String,
    /// The VAPID public key, as base64url. Browsers need it to subscribe.
    public_key: String,
    http: reqwest::Client,
}

impl WebPush {
    pub fn new(config: &PushConfig) -> Result<Self> {
        let private_key = URL_SAFE_NO_PAD
            .decode(config.vapid_private_key.trim())
            .context("VAPID_PRIVATE_KEY is not base64url")?;
        // The key library panics on other lengths, so check first.
        anyhow::ensure!(
            private_key.len() == 32,
            "VAPID_PRIVATE_KEY must be 32 bytes, not {}",
            private_key.len()
        );
        let key_pair = ES256KeyPair::from_bytes(&private_key)
            .map_err(|error| anyhow::anyhow!("VAPID_PRIVATE_KEY is not a P-256 key: {error}"))?;
        let public_key =
            URL_SAFE_NO_PAD.encode(key_pair.public_key().public_key().to_bytes_uncompressed());
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .context("could not build the push HTTP client")?;

        Ok(Self {
            key_pair,
            subject: config.vapid_subject.clone(),
            public_key,
            http,
        })
    }

    pub fn public_key(&self) -> &str {
        &self.public_key
    }

    /// A new VAPID private key, as base64url, for `VAPID_PRIVATE_KEY`.
    pub fn generate_private_key() -> String {
        URL_SAFE_NO_PAD.encode(ES256KeyPair::generate().to_bytes())
    }

    fn build(&self, subscription: &Subscription, body: Vec<u8>) -> Result<reqwest::Request> {
        let p256dh = URL_SAFE_NO_PAD.decode(&subscription.p256dh)?;
        let auth = URL_SAFE_NO_PAD.decode(&subscription.auth)?;
        anyhow::ensure!(auth.len() == 16, "the auth secret must be 16 bytes");

        let request = WebPushBuilder::new(
            subscription.endpoint.parse()?,
            PublicKey::from_sec1_bytes(&p256dh)?,
            Auth::clone_from_slice(&auth),
        )
        .with_valid_duration(TIME_TO_LIVE)
        .with_vapid(&self.key_pair, &self.subject)
        .build(body)
        .map_err(|error| anyhow::anyhow!("could not encrypt the push message: {error}"))?;

        Ok(reqwest::Request::try_from(request)?)
    }
}

impl Notifier for WebPush {
    async fn send(
        &self,
        subscription: &Subscription,
        message: &PushMessage,
    ) -> Result<SendOutcome> {
        let body = serde_json::to_vec(message)?;
        // Keys the browser sent that we can't use won't get better with retries.
        let request = match self.build(subscription, body) {
            Ok(request) => request,
            Err(error) => {
                tracing::warn!(subscription = %subscription.id, %error, "dropping an unusable push subscription");
                return Ok(SendOutcome::Gone);
            }
        };

        let response = self
            .http
            .execute(request)
            .await
            .context("could not reach the push service")?;

        match response.status() {
            status if status.is_success() => Ok(SendOutcome::Sent),
            StatusCode::NOT_FOUND | StatusCode::GONE => Ok(SendOutcome::Gone),
            status => {
                let detail = response.text().await.unwrap_or_default();
                anyhow::bail!("the push service answered {status}: {detail}")
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use uuid::Uuid;
    use web_push_native::p256::{SecretKey, elliptic_curve::sec1::ToEncodedPoint};

    use super::*;

    fn web_push() -> WebPush {
        WebPush::new(&PushConfig {
            vapid_private_key: WebPush::generate_private_key(),
            vapid_subject: "mailto:grower@example.com".into(),
        })
        .unwrap()
    }

    #[test]
    fn requests_decrypt_to_the_message() {
        // The browser's side: a key pair and an auth secret, as a subscription would hold them.
        let browser_secret = SecretKey::from_slice(&[7; 32]).unwrap();
        let browser_public = browser_secret.public_key().to_encoded_point(false);
        let auth = [3u8; 16];
        let subscription = Subscription {
            id: Uuid::nil(),
            endpoint: "https://push.example/send/abc".into(),
            p256dh: URL_SAFE_NO_PAD.encode(browser_public.as_bytes()),
            auth: URL_SAFE_NO_PAD.encode(auth),
        };

        let push = web_push();
        let message = PushMessage {
            title: "Rinse and drain".into(),
            body: "Mung bean sprouts in jar 1".into(),
            url: "/batches/1".into(),
            tag: "task-1".into(),
        };
        let body = serde_json::to_vec(&message).unwrap();
        let request = push.build(&subscription, body.clone()).unwrap();

        assert_eq!(request.url().as_str(), "https://push.example/send/abc");
        let header = |name: &str| request.headers()[name].to_str().unwrap().to_owned();
        assert_eq!(header("content-encoding"), "aes128gcm");
        assert_eq!(header("ttl"), "43200");
        let authorization = header("authorization");
        assert!(authorization.starts_with("vapid t="), "{authorization}");
        assert!(
            authorization.ends_with(&format!("k={}", push.public_key())),
            "{authorization}"
        );

        let encrypted = request.body().unwrap().as_bytes().unwrap().to_vec();
        let decrypted =
            web_push_native::decrypt(encrypted, &browser_secret, &Auth::clone_from_slice(&auth))
                .unwrap();
        assert_eq!(decrypted, body);
    }

    #[test]
    fn public_key_is_an_uncompressed_point() {
        let key = URL_SAFE_NO_PAD.decode(web_push().public_key()).unwrap();
        assert_eq!(key.len(), 65);
        assert_eq!(key[0], 0x04);
    }

    #[test]
    fn bad_keys_are_rejected_at_startup() {
        let config = |key: &str| PushConfig {
            vapid_private_key: key.into(),
            vapid_subject: "mailto:grower@example.com".into(),
        };
        assert!(WebPush::new(&config("not base64!")).is_err());
        assert!(WebPush::new(&config("AAAA")).is_err());
    }
}
