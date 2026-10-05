use axum::{extract::State, http::StatusCode};
use serde::Deserialize;
use time::OffsetDateTime;
use utoipa::{IntoParams, ToSchema};
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::extract::{Json, Path, Query};
use crate::{
    AppState,
    auth::AuthUser,
    db::batches::{self, TaskView},
    error::{AppError, ErrorBody},
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_tasks))
        .routes(routes!(complete_task))
        .routes(routes!(snooze_task))
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct SnoozeTask {
    /// When to remind you again. Within the next week.
    #[serde(with = "time::serde::rfc3339")]
    until: OffsetDateTime,
}

/// Push a task back. You get a new reminder when the snooze ends.
#[utoipa::path(
    post,
    path = "/tasks/{id}/snooze",
    tag = "tasks",
    security(("session" = [])),
    params(("id" = Uuid, Path)),
    request_body = SnoozeTask,
    responses(
        (status = 204, description = "Snoozed"),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, description = "The task is done or its batch has ended", body = ErrorBody),
        (status = 422, description = "The time is in the past or more than a week away", body = ErrorBody),
    ),
)]
async fn snooze_task(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<Uuid>,
    Json(request): Json<SnoozeTask>,
) -> Result<StatusCode, AppError> {
    let now = OffsetDateTime::now_utc();
    batches::snooze_task(&state.pool, user.id, id, request.until, now).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct ListQuery {
    /// Only return tasks due at or before this time, like the end of the user's day.
    #[serde(default, with = "time::serde::rfc3339::option")]
    #[param(value_type = Option<String>, format = DateTime)]
    due_before: Option<OffsetDateTime>,
}

/// List open tasks on your active batches, soonest first.
#[utoipa::path(
    get,
    path = "/tasks",
    tag = "tasks",
    security(("session" = [])),
    params(ListQuery),
    responses(
        (status = 200, body = Vec<TaskView>),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
    ),
)]
async fn list_tasks(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Query(query): Query<ListQuery>,
) -> Result<Json<Vec<TaskView>>, AppError> {
    let tasks = batches::open_tasks(&state.pool, user.id, query.due_before, None).await?;
    Ok(Json(tasks))
}

/// Mark a task done. Finishing a care task schedules the next one. Finishing an advance task
/// moves the batch into its next step, and moving into harvest ends the batch.
#[utoipa::path(
    post,
    path = "/tasks/{id}/complete",
    tag = "tasks",
    security(("session" = [])),
    params(("id" = Uuid, Path)),
    responses(
        (status = 204, description = "Done"),
        (status = 401, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (
            status = 409,
            description = "The task is already done (`task_done`), or its batch has moved on (`batch_not_active`, `stale_task`)",
            body = ErrorBody,
        ),
    ),
)]
async fn complete_task(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    batches::complete_task(&state.pool, user.id, id, OffsetDateTime::now_utc()).await?;
    Ok(StatusCode::NO_CONTENT)
}
