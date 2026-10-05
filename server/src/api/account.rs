use axum::extract::State;
use serde::Deserialize;
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};

use super::extract::{Json, present};
use crate::{
    AppState,
    auth::AuthUser,
    db::users::{self, User},
    domain::quiet::{QuietHours, is_timezone},
    error::{AppError, ErrorBody},
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(me, update_me))
}

/// The signed-in user.
#[utoipa::path(
    get,
    path = "/me",
    tag = "account",
    security(("session" = [])),
    responses(
        (status = 200, body = User),
        (status = 401, body = ErrorBody),
    ),
)]
async fn me(AuthUser(user): AuthUser) -> Json<User> {
    Json(user)
}

/// Settings to change. Leave a field out to keep it. Send `"quiet_hours": null` to turn quiet
/// hours off.
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct UpdateMe {
    /// An IANA timezone, like `Europe/Budapest`.
    timezone: Option<String>,
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<QuietHours>)]
    quiet_hours: Option<Option<QuietHours>>,
}

/// Change your timezone or quiet hours.
#[utoipa::path(
    patch,
    path = "/me",
    tag = "account",
    security(("session" = [])),
    request_body = UpdateMe,
    responses(
        (status = 200, body = User),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 422, body = ErrorBody),
    ),
)]
async fn update_me(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Json(request): Json<UpdateMe>,
) -> Result<Json<User>, AppError> {
    if let Some(timezone) = &request.timezone
        && !is_timezone(timezone)
    {
        return Err(AppError::invalid("timezone", "is not a known timezone"));
    }

    users::update_settings(
        &state.pool,
        user.id,
        request.timezone.as_deref(),
        request.quiet_hours,
    )
    .await?;

    let user = users::find(&state.pool, user.id)
        .await?
        .ok_or(AppError::Unauthorized)?;
    Ok(Json(user))
}
