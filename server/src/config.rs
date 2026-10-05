use std::{env, net::SocketAddr, path::PathBuf};

use anyhow::{Context, Result};

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub bind_addr: SocketAddr,
    /// Directory with the built frontend. When unset, the server only serves the API.
    pub web_dist: Option<PathBuf>,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let database_url = env::var("DATABASE_URL").context("DATABASE_URL is not set")?;

        let bind_addr = env::var("BIND_ADDR")
            .unwrap_or_else(|_| "127.0.0.1:3000".to_owned())
            .parse()
            .context("BIND_ADDR is not a valid socket address")?;

        let web_dist = env::var_os("WEB_DIST").map(PathBuf::from);

        Ok(Self {
            database_url,
            bind_addr,
            web_dist,
        })
    }
}
