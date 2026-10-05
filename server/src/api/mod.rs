//! The JSON API, served under `/api/v1`. Every handler is registered through utoipa-axum, so
//! the router and the OpenAPI spec come from the same list.

mod account;
mod batches;
mod containers;
mod extract;
mod plants;
mod push;
mod tasks;

use axum::{Router, extract::State, http::StatusCode, routing::get};
use serde::Serialize;
use utoipa::{
    Modify, OpenApi,
    openapi::{
        self,
        security::{ApiKey, ApiKeyValue, SecurityScheme},
    },
};
use utoipa_axum::router::OpenApiRouter;
use utoipa_scalar::{Scalar, Servable};

use self::extract::Json;
use crate::{AppState, error::AppError};

#[derive(OpenApi)]
#[openapi(
    info(title = "baby-greens", version = "1", description = "Sprout and microgreen tracker"),
    servers((url = "/api/v1")),
    modifiers(&SessionCookie),
    tags(
        (name = "account", description = "The signed-in user"),
        (name = "plants", description = "The plant library"),
        (name = "batches", description = "What you're growing"),
        (name = "containers", description = "Jars and trays, shared by the household"),
        (name = "tasks", description = "Chores and step changes"),
        (name = "push", description = "Reminders on your devices"),
    ),
)]
struct ApiDoc;

/// Registers the session cookie that `/auth/login` sets.
struct SessionCookie;

impl Modify for SessionCookie {
    fn modify(&self, openapi: &mut openapi::OpenApi) {
        let components = openapi.components.get_or_insert_with(Default::default);
        components.add_security_scheme(
            "session",
            SecurityScheme::ApiKey(ApiKey::Cookie(ApiKeyValue::new("bg_session"))),
        );
    }
}

fn v1() -> OpenApiRouter<AppState> {
    OpenApiRouter::with_openapi(ApiDoc::openapi())
        .merge(account::router())
        .merge(plants::router())
        .merge(batches::router())
        .merge(containers::router())
        .merge(tasks::router())
        .merge(push::router())
}

/// The OpenAPI spec for `/api/v1`.
pub fn openapi() -> openapi::OpenApi {
    v1().into_openapi()
}

/// Everything under `/api`: the versioned API, its spec and docs, and the health check.
pub fn router() -> Router<AppState> {
    let (v1, spec) = v1().split_for_parts();
    let docs = Scalar::with_url("/docs", spec.clone());

    let v1 = v1
        .route(
            "/openapi.json",
            get(move || async move { Json(spec.clone()) }),
        )
        .merge(docs);

    Router::new()
        .route("/health", get(health))
        .nest("/v1", v1)
        .fallback(|| async { AppError::NotFound })
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spec_lists_every_route() {
        let spec = openapi();
        let mut paths: Vec<_> = spec.paths.paths.keys().map(String::as_str).collect();
        paths.sort_unstable();
        assert_eq!(
            paths,
            [
                "/batches",
                "/batches/{id}",
                "/batches/{id}/discard",
                "/containers",
                "/containers/{id}",
                "/me",
                "/plants",
                "/plants/{slug}",
                "/push/key",
                "/push/subscriptions",
                "/push/test",
                "/tasks",
                "/tasks/{id}/complete",
                "/tasks/{id}/snooze",
            ]
        );
    }
}
