//! The baby-greens API server. `main.rs` handles startup; everything else lives here.

pub mod api;
pub mod auth;
pub mod config;
pub mod db;
pub mod domain;
pub mod error;
pub mod jobs;
pub mod notify;

use std::sync::Arc;

use axum::{Router, middleware};
use sqlx::PgPool;
use tower_http::{
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use tower_sessions::{Expiry, SessionManagerLayer, cookie::SameSite};
use tower_sessions_sqlx_store::PostgresStore;

use crate::{auth::AuthState, config::Config};

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub auth: Arc<AuthState>,
    /// None when push notifications aren't configured.
    pub push: Option<Arc<notify::WebPush>>,
}

pub fn app(state: AppState, session_store: PostgresStore, config: &Config) -> Router {
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
