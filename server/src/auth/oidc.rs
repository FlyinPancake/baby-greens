use std::sync::{Arc, RwLock};

use anyhow::{Context, Result};
use openidconnect::{
    AdditionalClaims, ClaimsVerificationError, Client, ClientId, ClientSecret,
    EmptyExtraTokenFields, EndpointMaybeSet, EndpointNotSet, EndpointSet, IdToken, IdTokenClaims,
    IdTokenFields, IssuerUrl, Nonce, RedirectUrl, SignatureVerificationError,
    StandardErrorResponse, StandardTokenResponse,
    core::{
        CoreAuthDisplay, CoreAuthPrompt, CoreErrorResponseType, CoreGenderClaim, CoreJsonWebKey,
        CoreJweContentEncryptionAlgorithm, CoreJwsSigningAlgorithm, CoreProviderMetadata,
        CoreRevocableToken, CoreRevocationErrorResponse, CoreTokenIntrospectionResponse,
        CoreTokenType,
    },
    reqwest,
};
use serde::{Deserialize, Serialize};

use crate::config::OidcConfig;

/// The non-standard `groups` claim, used for `OIDC_ALLOWED_GROUP`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GroupsClaim {
    #[serde(default)]
    pub groups: Vec<String>,
}

impl AdditionalClaims for GroupsClaim {}

type IdTokenFieldsWithGroups = IdTokenFields<
    GroupsClaim,
    EmptyExtraTokenFields,
    CoreGenderClaim,
    CoreJweContentEncryptionAlgorithm,
    CoreJwsSigningAlgorithm,
>;

type IdTokenWithGroups = IdToken<
    GroupsClaim,
    CoreGenderClaim,
    CoreJweContentEncryptionAlgorithm,
    CoreJwsSigningAlgorithm,
>;

pub type Claims = IdTokenClaims<GroupsClaim, CoreGenderClaim>;

type TokenResponse = StandardTokenResponse<IdTokenFieldsWithGroups, CoreTokenType>;

/// `CoreClient` with the groups claim, in the endpoint state that discovery produces.
pub type OidcClient = Client<
    GroupsClaim,
    CoreAuthDisplay,
    CoreGenderClaim,
    CoreJweContentEncryptionAlgorithm,
    CoreJsonWebKey,
    CoreAuthPrompt,
    StandardErrorResponse<CoreErrorResponseType>,
    TokenResponse,
    CoreTokenIntrospectionResponse,
    CoreRevocableToken,
    CoreRevocationErrorResponse,
    EndpointSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointMaybeSet,
    EndpointMaybeSet,
>;

/// HTTP client for talking to the provider. It must not follow redirects, so a compromised
/// provider can't point token requests at internal services.
fn http_client() -> Result<reqwest::Client> {
    reqwest::ClientBuilder::new()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .context("could not build the OIDC HTTP client")
}

/// The client for the configured provider. Discovery runs again when an ID token is signed with a
/// key the client doesn't have, because providers rotate their signing keys. Dex does every 6 hours.
pub struct Provider {
    client: RwLock<Arc<OidcClient>>,
    config: OidcConfig,
    redirect_url: RedirectUrl,
    http: reqwest::Client,
}

impl Provider {
    pub async fn discover(config: &OidcConfig, redirect_url: RedirectUrl) -> Result<Self> {
        let http = http_client()?;
        let client = discover(config, redirect_url.clone(), &http).await?;
        Ok(Self {
            client: RwLock::new(Arc::new(client)),
            config: config.clone(),
            redirect_url,
            http,
        })
    }

    pub fn client(&self) -> Arc<OidcClient> {
        self.client
            .read()
            .expect("the OIDC client lock is poisoned")
            .clone()
    }

    pub fn http(&self) -> &reqwest::Client {
        &self.http
    }

    /// Verifies an ID token's signature and claims. If none of the provider's keys match, it fetches
    /// them again and retries once.
    ///
    /// A refetch only happens after a code exchange succeeded, so each one costs a real login at
    /// the provider, and nobody can trigger them in bulk.
    pub async fn verify(&self, id_token: &IdTokenWithGroups, nonce: &Nonce) -> Result<Claims> {
        let client = self.client();
        match id_token.claims(&client.id_token_verifier(), nonce) {
            Ok(claims) => return Ok(claims.clone()),
            Err(ClaimsVerificationError::SignatureVerification(
                SignatureVerificationError::NoMatchingKey,
            )) => {}
            Err(error) => return Err(error).context("the ID token didn't verify"),
        }

        tracing::info!("no provider key matches the ID token; running OIDC discovery again");
        let client = Arc::new(discover(&self.config, self.redirect_url.clone(), &self.http).await?);
        *self
            .client
            .write()
            .expect("the OIDC client lock is poisoned") = client.clone();

        id_token
            .claims(&client.id_token_verifier(), nonce)
            .cloned()
            .context("the ID token didn't verify")
    }
}

async fn discover(
    config: &OidcConfig,
    redirect_url: RedirectUrl,
    http: &reqwest::Client,
) -> Result<OidcClient> {
    let issuer = IssuerUrl::new(config.issuer_url.clone()).context("OIDC_ISSUER_URL is invalid")?;

    let metadata = CoreProviderMetadata::discover_async(issuer, http)
        .await
        .with_context(|| format!("could not run OIDC discovery for {}", config.issuer_url))?;

    let client = OidcClient::from_provider_metadata(
        metadata,
        ClientId::new(config.client_id.clone()),
        Some(ClientSecret::new(config.client_secret.clone())),
    )
    .set_redirect_uri(redirect_url);

    Ok(client)
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Mutex,
        atomic::{AtomicUsize, Ordering},
    };

    use axum::{Json, Router, routing::get};
    use chrono::{Duration, Utc};
    use openidconnect::{
        Audience, AuthUrl, EmptyAdditionalProviderMetadata, JsonWebKeyId, JsonWebKeySet,
        JsonWebKeySetUrl, PrivateSigningKey, ResponseTypes, StandardClaims, SubjectIdentifier,
        TokenUrl,
        core::{CoreResponseType, CoreRsaPrivateSigningKey, CoreSubjectIdentifierType},
    };

    use super::*;

    /// A throwaway key for these tests only.
    const SIGNING_KEY: &str = include_str!("testdata/signing-key.pem");
    const CLIENT_ID: &str = "baby-greens";

    fn signing_key(kid: &str) -> CoreRsaPrivateSigningKey {
        CoreRsaPrivateSigningKey::from_pem(SIGNING_KEY, Some(JsonWebKeyId::new(kid.to_owned())))
            .unwrap()
    }

    /// A provider that publishes one key under `kid`. Rotating means changing `kid`.
    struct FakeProvider {
        issuer: String,
        kid: Arc<Mutex<String>>,
        discoveries: Arc<AtomicUsize>,
    }

    impl FakeProvider {
        async fn start(kid: &str) -> Self {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let issuer = format!("http://{}", listener.local_addr().unwrap());
            let kid = Arc::new(Mutex::new(kid.to_owned()));
            let discoveries = Arc::new(AtomicUsize::new(0));

            let metadata = CoreProviderMetadata::new(
                IssuerUrl::new(issuer.clone()).unwrap(),
                AuthUrl::new(format!("{issuer}/auth")).unwrap(),
                JsonWebKeySetUrl::new(format!("{issuer}/keys")).unwrap(),
                vec![ResponseTypes::new(vec![CoreResponseType::Code])],
                vec![CoreSubjectIdentifierType::Public],
                vec![CoreJwsSigningAlgorithm::RsaSsaPkcs1V15Sha256],
                EmptyAdditionalProviderMetadata {},
            )
            .set_token_endpoint(Some(TokenUrl::new(format!("{issuer}/token")).unwrap()));

            let router = Router::new()
                .route(
                    "/.well-known/openid-configuration",
                    get({
                        let discoveries = discoveries.clone();
                        move || async move {
                            discoveries.fetch_add(1, Ordering::SeqCst);
                            Json(metadata)
                        }
                    }),
                )
                .route(
                    "/keys",
                    get({
                        let kid = kid.clone();
                        move || async move {
                            let kid = kid.lock().unwrap().clone();
                            Json(JsonWebKeySet::new(vec![
                                signing_key(&kid).as_verification_key(),
                            ]))
                        }
                    }),
                );
            tokio::spawn(axum::serve(listener, router).into_future());

            Self {
                issuer,
                kid,
                discoveries,
            }
        }

        fn rotate(&self, kid: &str) {
            *self.kid.lock().unwrap() = kid.to_owned();
        }

        fn discoveries(&self) -> usize {
            self.discoveries.load(Ordering::SeqCst)
        }

        async fn client(&self) -> Provider {
            let config = OidcConfig {
                issuer_url: self.issuer.clone(),
                client_id: CLIENT_ID.to_owned(),
                client_secret: "secret".to_owned(),
                allowed_group: None,
            };
            let redirect_url =
                RedirectUrl::new("http://localhost/auth/callback".to_owned()).unwrap();
            Provider::discover(&config, redirect_url).await.unwrap()
        }

        fn id_token(&self, kid: &str, nonce: &Nonce) -> IdTokenWithGroups {
            let claims = IdTokenClaims::new(
                IssuerUrl::new(self.issuer.clone()).unwrap(),
                vec![Audience::new(CLIENT_ID.to_owned())],
                Utc::now() + Duration::minutes(5),
                Utc::now(),
                StandardClaims::new(SubjectIdentifier::new("grower".to_owned())),
                GroupsClaim::default(),
            )
            .set_nonce(Some(nonce.clone()));
            IdToken::new(
                claims,
                &signing_key(kid),
                CoreJwsSigningAlgorithm::RsaSsaPkcs1V15Sha256,
                None,
                None,
            )
            .unwrap()
        }
    }

    #[tokio::test]
    async fn picks_up_rotated_keys() {
        let provider = FakeProvider::start("old").await;
        let client = provider.client().await;
        let nonce = Nonce::new_random();

        provider.rotate("new");
        let claims = client
            .verify(&provider.id_token("new", &nonce), &nonce)
            .await
            .unwrap();
        assert_eq!(claims.subject().as_str(), "grower");
        assert_eq!(provider.discoveries(), 2);

        // The new keys stay, so the next login doesn't fetch them again.
        client
            .verify(&provider.id_token("new", &nonce), &nonce)
            .await
            .unwrap();
        assert_eq!(provider.discoveries(), 2);
    }

    #[tokio::test]
    async fn retries_an_unknown_key_only_once() {
        let provider = FakeProvider::start("old").await;
        let client = provider.client().await;
        let nonce = Nonce::new_random();

        let result = client
            .verify(&provider.id_token("unknown", &nonce), &nonce)
            .await;
        assert!(result.is_err());
        assert_eq!(provider.discoveries(), 2);
    }

    #[tokio::test]
    async fn other_failures_skip_discovery() {
        let provider = FakeProvider::start("old").await;
        let client = provider.client().await;

        let token = provider.id_token("old", &Nonce::new_random());
        let result = client.verify(&token, &Nonce::new_random()).await;
        assert!(result.is_err());
        assert_eq!(provider.discoveries(), 1);
    }
}
