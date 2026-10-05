use axum::{extract::State, http::StatusCode};
use serde::Deserialize;
use time::{Duration, OffsetDateTime};
use utoipa::{IntoParams, ToSchema};
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::extract::{Json, Path, Query};
use crate::{
    AppState,
    auth::AuthUser,
    db::{
        batches::{self, BatchDetail, BatchFilter, BatchStatus, BatchSummary, NewBatch},
        plants,
    },
    domain::plant::{Problem, Slug},
    error::{AppError, ErrorBody},
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_batches, create_batch))
        .routes(routes!(get_batch))
        .routes(routes!(discard_batch))
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct ListQuery {
    /// Only return batches with this status.
    status: Option<BatchStatus>,
    /// Only return batches grown in this jar or tray.
    container_id: Option<Uuid>,
}

/// List your batches, newest first.
#[utoipa::path(
    get,
    path = "/batches",
    tag = "batches",
    security(("session" = [])),
    params(ListQuery),
    responses(
        (status = 200, body = Vec<BatchSummary>),
        (status = 401, body = ErrorBody),
    ),
)]
async fn list_batches(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Query(query): Query<ListQuery>,
) -> Result<Json<Vec<BatchSummary>>, AppError> {
    let filter = BatchFilter {
        status: query.status,
        container_id: query.container_id,
    };
    Ok(Json(batches::list(&state.pool, user.id, filter).await?))
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct CreateBatch {
    plant_slug: Slug,
    /// The jar or tray to grow in. It must not be archived or hold another active batch.
    container_id: Uuid,
    /// Seed weight in grams. Defaults to the plant's `seed_g`.
    seed_g: Option<u32>,
    /// When the first step started. Defaults to now. Can't be in the future.
    #[serde(default, with = "time::serde::rfc3339::option")]
    started_at: Option<OffsetDateTime>,
    #[serde(default)]
    notes: String,
}

/// Start a batch. The server copies the plant's current definition into the batch and
/// schedules the first step's tasks.
#[utoipa::path(
    post,
    path = "/batches",
    tag = "batches",
    security(("session" = [])),
    request_body = CreateBatch,
    responses(
        (status = 201, body = BatchDetail),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 409, description = "The jar or tray holds another active batch (`container_in_use`)", body = ErrorBody),
        (status = 422, body = ErrorBody),
    ),
)]
async fn create_batch(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Json(request): Json<CreateBatch>,
) -> Result<(StatusCode, Json<BatchDetail>), AppError> {
    let now = OffsetDateTime::now_utc();
    let mut problems = Vec::new();
    let mut report = |path: &str, message: &str| {
        problems.push(Problem {
            path: path.to_owned(),
            message: message.to_owned(),
        });
    };

    let plant = plants::find(&state.pool, &request.plant_slug).await?;
    if plant.is_none() {
        report("plant_slug", "no plant has this slug");
    }

    let seed_g = request
        .seed_g
        .or_else(|| plant.as_ref().and_then(|entry| entry.plant.seed_g));
    match seed_g {
        Some(0) => report("seed_g", "must be more than zero"),
        None if plant.is_some() => {
            report("seed_g", "is required, because the plant has no default")
        }
        _ => {}
    }

    let started_at = request.started_at.unwrap_or(now);
    // A little slack for clocks that run slightly ahead of the server's.
    if started_at > now + Duration::minutes(5) {
        report("started_at", "can't be in the future");
    }

    let (Some(entry), Some(seed_g), true) = (plant, seed_g, problems.is_empty()) else {
        return Err(AppError::Invalid(problems));
    };

    let id = batches::create(
        &state.pool,
        user.id,
        NewBatch {
            plant_slug: entry.slug,
            plant: entry.plant,
            container_id: request.container_id,
            seed_g,
            started_at,
            notes: request.notes,
        },
    )
    .await?;

    let detail = batches::find(&state.pool, user.id, id).await?;
    Ok((StatusCode::CREATED, Json(detail)))
}

#[utoipa::path(
    get,
    path = "/batches/{id}",
    tag = "batches",
    security(("session" = [])),
    params(("id" = Uuid, Path)),
    responses(
        (status = 200, body = BatchDetail),
        (status = 401, body = ErrorBody),
        (status = 404, body = ErrorBody),
    ),
)]
async fn get_batch(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<BatchDetail>, AppError> {
    Ok(Json(batches::find(&state.pool, user.id, id).await?))
}

/// Stop an active batch early, for example because it molded.
#[utoipa::path(
    post,
    path = "/batches/{id}/discard",
    tag = "batches",
    security(("session" = [])),
    params(("id" = Uuid, Path)),
    responses(
        (status = 204, description = "Discarded"),
        (status = 401, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, description = "The batch isn't active", body = ErrorBody),
    ),
)]
async fn discard_batch(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    batches::discard(&state.pool, user.id, id, OffsetDateTime::now_utc()).await?;
    Ok(StatusCode::NO_CONTENT)
}
