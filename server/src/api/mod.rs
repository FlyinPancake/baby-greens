use axum::{Json, Router, extract::State, http::StatusCode, routing::get};
use serde::Serialize;

use crate::{AppState, auth::AuthUser, db::users::User};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/health", get(health))
        .route("/me", get(me))
        .fallback(|| async { StatusCode::NOT_FOUND })
}

#[derive(Serialize)]
struct Health {
    database: bool,
}

async fn health(State(state): State<AppState>) -> (StatusCode, Json<Health>) {
    match sqlx::query("SELECT 1").execute(&state.pool).await {
        Ok(_) => (StatusCode::OK, Json(Health { database: true })),
        Err(error) => {
            tracing::warn!(%error, "health check could not reach the database");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(Health { database: false }),
            )
        }
    }
}

async fn me(AuthUser(user): AuthUser) -> Json<User> {
    Json(user)
}
