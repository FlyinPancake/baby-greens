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

fn required(name: &str) -> Result<String> {
    env::var(name).with_context(|| format!("{name} is not set"))
}
