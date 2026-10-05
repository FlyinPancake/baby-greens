use axum::{extract::State, http::StatusCode};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};

use super::extract::Json;
use crate::{
    AppState,
    auth::AuthUser,
    db::push::{self, NewSubscription},
    error::{AppError, ErrorBody},
    jobs::reminders,
    notify::PushMessage,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(push_key))
        .routes(routes!(subscribe, unsubscribe))
        .routes(routes!(send_test))
}

#[derive(Serialize, ToSchema)]
struct PushKey {
    /// The VAPID public key, as base64url, for `pushManager.subscribe`. Null when push
    /// notifications are off on this server.
    public_key: Option<String>,
}

#[utoipa::path(
    get,
    path = "/push/key",
    tag = "push",
    security(("session" = [])),
    responses(
        (status = 200, body = PushKey),
        (status = 401, body = ErrorBody),
    ),
)]
async fn push_key(State(state): State<AppState>, _user: AuthUser) -> Json<PushKey> {
    Json(PushKey {
        public_key: state.push.as_ref().map(|push| push.public_key().to_owned()),
    })
}

/// The JSON a browser's `PushSubscription.toJSON()` gives.
#[derive(Deserialize, ToSchema)]
struct SubscriptionBody {
    endpoint: String,
    keys: SubscriptionKeys,
}

#[derive(Deserialize, ToSchema)]
struct SubscriptionKeys {
    p256dh: String,
    auth: String,
}

/// Save this device's push subscription, so reminders reach it.
#[utoipa::path(
    post,
    path = "/push/subscriptions",
    tag = "push",
    security(("session" = [])),
    request_body = SubscriptionBody,
    responses(
        (status = 204, description = "Saved"),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 422, body = ErrorBody),
    ),
)]
async fn subscribe(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    headers: axum::http::HeaderMap,
    Json(body): Json<SubscriptionBody>,
) -> Result<StatusCode, AppError> {
    if !body.endpoint.starts_with("https://") {
        return Err(AppError::invalid("endpoint", "must be an https URL"));
    }
    let decodes_to = |text: &str, length: usize| {
        URL_SAFE_NO_PAD
            .decode(text.trim_end_matches('='))
            .is_ok_and(|bytes| bytes.len() == length)
    };
    if !decodes_to(&body.keys.p256dh, 65) {
        return Err(AppError::invalid(
            "keys.p256dh",
            "must be a base64url P-256 public key",
        ));
    }
    if !decodes_to(&body.keys.auth, 16) {
        return Err(AppError::invalid(
            "keys.auth",
            "must be 16 bytes of base64url",
        ));
    }

    let user_agent = headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|value| value.to_str().ok());
    let subscription = NewSubscription {
        endpoint: &body.endpoint,
        p256dh: body.keys.p256dh.trim_end_matches('='),
        auth: body.keys.auth.trim_end_matches('='),
        user_agent,
    };
    push::save(&state.pool, user.id, &subscription).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize, ToSchema)]
struct UnsubscribeBody {
    endpoint: String,
}

/// Stop sending reminders to this device.
#[utoipa::path(
    delete,
    path = "/push/subscriptions",
    tag = "push",
    security(("session" = [])),
    request_body = UnsubscribeBody,
    responses(
        (status = 204, description = "Removed, or it wasn't saved"),
        (status = 401, body = ErrorBody),
    ),
)]
async fn unsubscribe(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Json(body): Json<UnsubscribeBody>,
) -> Result<StatusCode, AppError> {
    push::remove(&state.pool, user.id, &body.endpoint).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize, ToSchema)]
struct TestResult {
    /// Devices the push service accepted the message for.
    sent: usize,
    /// Subscriptions removed because the push service no longer knows them.
    removed: usize,
}

/// Send a test notification to all of your devices.
#[utoipa::path(
    post,
    path = "/push/test",
    tag = "push",
    security(("session" = [])),
    responses(
        (status = 200, body = TestResult),
        (status = 401, body = ErrorBody),
        (status = 409, description = "Push notifications are off on this server (`push_disabled`)", body = ErrorBody),
    ),
)]
async fn send_test(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
) -> Result<Json<TestResult>, AppError> {
    let notifier = state
        .push
        .as_ref()
        .ok_or(AppError::Conflict("push_disabled"))?;
    let message = PushMessage {
        title: "Reminders are on".into(),
        body: "This is how baby-greens tells you it's time to rinse, water, or harvest.".into(),
        url: "/settings".into(),
        tag: "test".into(),
    };
    let delivery =
        reminders::send_to_user(&state.pool, notifier.as_ref(), user.id, &message).await?;
    Ok(Json(TestResult {
        sent: delivery.sent,
        removed: delivery.removed,
    }))
}
