use std::{env, net::SocketAddr, path::PathBuf};

use anyhow::{Context, Result};
use url::Url;

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub bind_addr: SocketAddr,
    /// The origin users open in their browser. Login redirects and the Origin check use it.
    pub public_url: Url,
    /// Directory with the built frontend. When unset, the server only serves the API.
    pub web_dist: Option<PathBuf>,
    pub oidc: OidcConfig,
    /// Web push settings. Push notifications are off when `VAPID_PRIVATE_KEY` is unset.
    pub push: Option<PushConfig>,
}

#[derive(Debug, Clone)]
pub struct PushConfig {
    /// The VAPID private key, as base64url. `baby-greens-server vapid-key` makes one.
    pub vapid_private_key: String,
    /// Who push services can contact about this server: a `mailto:` or `https:` URL.
    pub vapid_subject: String,
}

#[derive(Debug, Clone)]
pub struct OidcConfig {
    pub issuer_url: String,
    pub client_id: String,
    pub client_secret: String,
    /// When set, only users whose `groups` claim contains this value can sign in.
    pub allowed_group: Option<String>,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let bind_addr = env::var("BIND_ADDR")
            .unwrap_or_else(|_| "127.0.0.1:3000".to_owned())
            .parse()
            .context("BIND_ADDR is not a valid socket address")?;

        let public_url = required("PUBLIC_URL")?
            .parse()
            .context("PUBLIC_URL is not a valid URL")?;

        Ok(Self {
            database_url: required("DATABASE_URL")?,
            bind_addr,
            public_url,
            web_dist: env::var_os("WEB_DIST").map(PathBuf::from),
            push: push_from_env()?,
            oidc: OidcConfig {
                issuer_url: required("OIDC_ISSUER_URL")?,
                client_id: required("OIDC_CLIENT_ID")?,
                client_secret: required("OIDC_CLIENT_SECRET")?,
                allowed_group: env::var("OIDC_ALLOWED_GROUP")
                    .ok()
                    .filter(|group| !group.is_empty()),
            },
        })
    }
}

fn push_from_env() -> Result<Option<PushConfig>> {
    let Some(vapid_private_key) = env::var("VAPID_PRIVATE_KEY")
        .ok()
        .filter(|key| !key.is_empty())
    else {
        return Ok(None);
    };
    let vapid_subject = required("VAPID_SUBJECT")
        .context("VAPID_SUBJECT is required when VAPID_PRIVATE_KEY is set")?;
    if !vapid_subject.starts_with("mailto:") && !vapid_subject.starts_with("https://") {
        anyhow::bail!("VAPID_SUBJECT must be a mailto: or https: URL");
    }
    Ok(Some(PushConfig {
        vapid_private_key,
        vapid_subject,
    }))
}

fn required(name: &str) -> Result<String> {
    env::var(name).with_context(|| format!("{name} is not set"))
}
