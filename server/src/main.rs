mod api;
mod config;

use anyhow::{Context, Result};
use axum::Router;
use sqlx::{PgPool, postgres::PgPoolOptions};
use tokio::net::TcpListener;
use tower_http::{
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use tracing_subscriber::EnvFilter;

use crate::config::Config;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
}

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("baby_greens_server=info,tower_http=info")),
        )
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

    let app = app(AppState { pool }, &config);

    let listener = TcpListener::bind(config.bind_addr)
        .await
        .with_context(|| format!("could not bind to {}", config.bind_addr))?;
    tracing::info!(addr = %config.bind_addr, "listening");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

fn app(state: AppState, config: &Config) -> Router {
    let mut app = Router::new().nest("/api", api::router());

    // Unknown paths fall back to index.html so client-side routes survive a reload.
    if let Some(dist) = &config.web_dist {
        let spa = ServeDir::new(dist).fallback(ServeFile::new(dist.join("index.html")));
        app = app.fallback_service(spa);
    }

    app.layer(TraceLayer::new_for_http()).with_state(state)
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
