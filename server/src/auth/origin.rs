use axum::{
    Json,
    extract::{Request, State},
    http::{HeaderValue, Method, StatusCode, header::ORIGIN},
    middleware::Next,
    response::{IntoResponse, Response},
};
use serde_json::json;

use crate::AppState;

/// CSRF protection. Rejects state-changing requests whose `Origin` header isn't the app's own
/// origin. Browsers send `Origin` on every POST, PUT, PATCH, and DELETE.
pub async fn require_same_origin(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    let origin = request.headers().get(ORIGIN);

    if is_allowed(request.method(), origin, &state.auth.public_origin) {
        next.run(request).await
    } else {
        tracing::warn!(method = %request.method(), uri = %request.uri(), ?origin, "rejected cross-origin request");
        (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "cross_origin" })),
        )
            .into_response()
    }
}

fn is_allowed(method: &Method, origin: Option<&HeaderValue>, expected: &str) -> bool {
    if matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS) {
        return true;
    }

    origin.is_some_and(|origin| origin.as_bytes() == expected.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    const APP: &str = "http://localhost:5173";

    #[test]
    fn safe_methods_pass_without_origin() {
        assert!(is_allowed(&Method::GET, None, APP));
        assert!(is_allowed(&Method::HEAD, None, APP));
    }

    #[test]
    fn writes_need_a_matching_origin() {
        let same = HeaderValue::from_static(APP);
        let other = HeaderValue::from_static("https://evil.example");
        let null = HeaderValue::from_static("null");

        assert!(is_allowed(&Method::POST, Some(&same), APP));
        assert!(!is_allowed(&Method::POST, Some(&other), APP));
        assert!(!is_allowed(&Method::DELETE, Some(&null), APP));
        assert!(!is_allowed(&Method::PUT, None, APP));
    }
}
