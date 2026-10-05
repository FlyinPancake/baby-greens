use axum::{extract::State, http::StatusCode};
use serde::Deserialize;
use time::OffsetDateTime;
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::extract::{Json, Path};
use crate::{
    AppState,
    auth::AuthUser,
    db::harvests::{self, Harvest, NewHarvest, PlantStats},
    error::{AppError, ErrorBody},
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(log_harvest))
        .routes(routes!(delete_harvest))
        .routes(routes!(plant_stats))
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct LogHarvest {
    /// Defaults to now.
    #[serde(default, with = "time::serde::rfc3339::option")]
    harvested_at: Option<OffsetDateTime>,
    /// Grams harvested.
    yield_g: i32,
    /// 1 to 5.
    rating: Option<i16>,
    #[serde(default)]
    notes: String,
}

/// Log what a harvested batch yielded. Log again for a second cut.
#[utoipa::path(
    post,
    path = "/batches/{id}/harvests",
    tag = "batches",
    security(("session" = [])),
    params(("id" = Uuid, Path)),
    request_body = LogHarvest,
    responses(
        (status = 201, body = Harvest),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, description = "The batch isn't harvested yet (`batch_not_harvested`)", body = ErrorBody),
        (status = 422, body = ErrorBody),
    ),
)]
async fn log_harvest(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<Uuid>,
    Json(request): Json<LogHarvest>,
) -> Result<(StatusCode, Json<Harvest>), AppError> {
    let now = OffsetDateTime::now_utc();
    let harvest = NewHarvest {
        harvested_at: request.harvested_at.unwrap_or(now),
        yield_g: request.yield_g,
        rating: request.rating,
        notes: request.notes,
    };
    let harvest = harvests::create(&state.pool, user.id, id, harvest, now).await?;
    Ok((StatusCode::CREATED, Json(harvest)))
}

/// Delete a harvest logged by mistake.
#[utoipa::path(
    delete,
    path = "/harvests/{id}",
    tag = "batches",
    security(("session" = [])),
    params(("id" = Uuid, Path)),
    responses(
        (status = 204, description = "Deleted"),
        (status = 401, body = ErrorBody),
        (status = 404, body = ErrorBody),
    ),
)]
async fn delete_harvest(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    harvests::delete(&state.pool, user.id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Your results per plant: yield per gram of seed, ratings, and days to harvest.
#[utoipa::path(
    get,
    path = "/stats/plants",
    tag = "batches",
    security(("session" = [])),
    responses(
        (status = 200, body = Vec<PlantStats>),
        (status = 401, body = ErrorBody),
    ),
)]
async fn plant_stats(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
) -> Result<Json<Vec<PlantStats>>, AppError> {
    Ok(Json(harvests::plant_stats(&state.pool, user.id).await?))
}
