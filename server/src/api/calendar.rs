use axum::extract::State;
use serde::Deserialize;
use time::{Duration, OffsetDateTime};
use utoipa::IntoParams;
use utoipa_axum::{router::OpenApiRouter, routes};

use super::extract::{Json, Query};
use crate::{
    AppState,
    auth::AuthUser,
    db::batches::{self, CalendarBatch},
    domain::plant::Problem,
    error::{AppError, ErrorBody},
};

/// The longest range one request can ask for. A month view with six weeks needs 42 days.
const MAX_RANGE: Duration = Duration::days(93);

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(calendar))
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct CalendarQuery {
    /// The start of the range.
    #[serde(with = "time::serde::rfc3339")]
    #[param(value_type = String, format = DateTime)]
    from: OffsetDateTime,
    /// The end of the range, at most 93 days after `from`.
    #[serde(with = "time::serde::rfc3339")]
    #[param(value_type = String, format = DateTime)]
    to: OffsetDateTime,
}

/// List the batches that were growing between `from` and `to`, with their step history and, for
/// active batches, the planned steps up to harvest. Oldest first.
#[utoipa::path(
    get,
    path = "/calendar",
    tag = "batches",
    security(("session" = [])),
    params(CalendarQuery),
    responses(
        (status = 200, body = Vec<CalendarBatch>),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 422, description = "`to` isn't after `from`, or the range is too long", body = ErrorBody),
    ),
)]
async fn calendar(
    State(state): State<AppState>,
    _user: AuthUser,
    Query(query): Query<CalendarQuery>,
) -> Result<Json<Vec<CalendarBatch>>, AppError> {
    let message = if query.to <= query.from {
        Some("must be after from")
    } else if query.to - query.from > MAX_RANGE {
        Some("must be at most 93 days after from")
    } else {
        None
    };
    if let Some(message) = message {
        return Err(AppError::Invalid(vec![Problem {
            path: "to".to_owned(),
            message: message.to_owned(),
        }]));
    }

    Ok(Json(
        batches::calendar(&state.pool, query.from, query.to).await?,
    ))
}
