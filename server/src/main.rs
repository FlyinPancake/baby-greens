use std::{
    io::IsTerminal,
    net::{Ipv4Addr, Ipv6Addr, SocketAddr},
    sync::Arc,
    time::Duration,
};

use anyhow::{Context, Result};
use baby_greens_server::{
    AppState, api, app, auth::AuthState, config::Config, domain::library, jobs, notify::WebPush,
};
use sqlx::postgres::PgPoolOptions;
use tokio::net::TcpListener;
use tower_sessions::ExpiredDeletion;
use tower_sessions_sqlx_store::PostgresStore;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    // `baby-greens-server openapi` prints the API spec and exits, without a database or config.
    // `baby-greens-server vapid-key` prints a new VAPID private key for VAPID_PRIVATE_KEY.
    // `baby-greens-server healthcheck` asks a running server whether it's healthy, for container
    // health checks in images without curl.
    match std::env::args().nth(1).as_deref() {
        Some("openapi") => {
            println!("{}", api::openapi().to_pretty_json()?);
            return Ok(());
        }
        Some("vapid-key") => {
            println!("{}", WebPush::generate_private_key());
            return Ok(());
        }
        Some("healthcheck") => return healthcheck().await,
        _ => {}
    }

    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("baby_greens_server=info,tower_http=info")),
        )
        // Plain text when logs go to a file or a container runtime instead of a terminal.
        .with_ansi(std::io::stdout().is_terminal())
        .init();

    let config = Config::from_env()?;

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&config.database_url)
        .await
        .context("could not connect to Postgres")?;

    sqlx::migrate!()
        .run(&pool)
        .await
        .context("could not run migrations")?;

    // tower-sessions keeps its table in its own `tower_sessions` schema, outside our migrations.
    let session_store = PostgresStore::new(pool.clone());
    session_store
        .migrate()
        .await
        .context("could not create the session table")?;
    tokio::spawn(
        session_store
            .clone()
            .continuously_delete_expired(Duration::from_secs(60 * 60)),
    );

    // Parse the built-in plant library now, so a bad entry stops startup instead of a request.
    tracing::info!(
        plants = library::builtin().len(),
        "loaded the built-in plant library"
    );

    let auth = AuthState::new(&config.oidc, &config.public_url).await?;
    let push = config
        .push
        .as_ref()
        .map(WebPush::new)
        .transpose()?
        .map(Arc::new);
    match &push {
        Some(push) => {
            tokio::spawn(jobs::reminders::run(pool.clone(), push.clone()));
            tracing::info!("push notifications are on");
        }
        None => tracing::warn!("push notifications are off; set VAPID_PRIVATE_KEY to turn them on"),
    }

    let state = AppState {
        pool,
        auth: Arc::new(auth),
        push,
    };

    let app = app(state, session_store, &config);

    let listener = TcpListener::bind(config.bind_addr)
        .await
        .with_context(|| format!("could not bind to {}", config.bind_addr))?;
    tracing::info!(addr = %config.bind_addr, "listening");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

/// Calls `/api/health` on the server at BIND_ADDR and fails unless it answers 200.
async fn healthcheck() -> Result<()> {
    let mut addr: SocketAddr = std::env::var("BIND_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:3000".to_owned())
        .parse()
        .context("BIND_ADDR is not a valid socket address")?;
    // A server listening on every interface also answers on loopback.
    if addr.ip().is_unspecified() {
        addr.set_ip(match addr {
            SocketAddr::V4(_) => Ipv4Addr::LOCALHOST.into(),
            SocketAddr::V6(_) => Ipv6Addr::LOCALHOST.into(),
        });
    }

    let response = reqwest::Client::new()
        .get(format!("http://{addr}/api/health"))
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .with_context(|| format!("could not reach the server at {addr}"))?;
    anyhow::ensure!(
        response.status().is_success(),
        "the server is unhealthy: {}",
        response.status()
    );
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("could not install the Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("could not install the SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {}
        () = terminate => {}
    }

    tracing::info!("shutting down");
}
