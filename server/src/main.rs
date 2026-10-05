mod api;
mod auth;
mod config;
mod db;
mod error;

use std::{sync::Arc, time::Duration};

use anyhow::{Context, Result};
use axum::{Router, middleware};
use sqlx::{PgPool, postgres::PgPoolOptions};
use tokio::net::TcpListener;
use tower_http::{
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use tower_sessions::{ExpiredDeletion, Expiry, SessionManagerLayer, cookie::SameSite};
use tower_sessions_sqlx_store::PostgresStore;
use tracing_subscriber::EnvFilter;

use crate::{auth::AuthState, config::Config};

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub auth: Arc<AuthState>,
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

    let auth = AuthState::new(&config.oidc, &config.public_url).await?;
    let state = AppState {
        pool,
        auth: Arc::new(auth),
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

fn app(state: AppState, session_store: PostgresStore, config: &Config) -> Router {
    let sessions = SessionManagerLayer::new(session_store)
        .with_name("bg_session")
        .with_secure(config.public_url.scheme() == "https")
        .with_same_site(SameSite::Lax)
        .with_http_only(true)
        // Saving on every request makes the idle timeout count from the last visit.
        .with_always_save(true)
        .with_expiry(Expiry::OnInactivity(auth::SESSION_IDLE_TIMEOUT));

    let mut app = Router::new()
        .nest("/api", api::router())
        .nest("/auth", auth::router());

    // Unknown paths fall back to index.html so client-side routes survive a reload.
    if let Some(dist) = &config.web_dist {
        let spa = ServeDir::new(dist).fallback(ServeFile::new(dist.join("index.html")));
        app = app.fallback_service(spa);
    }

    app.layer(middleware::from_fn_with_state(
        state.clone(),
        auth::require_same_origin,
    ))
    .layer(sessions)
    .layer(TraceLayer::new_for_http())
    .with_state(state)
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
