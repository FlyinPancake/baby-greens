use axum::{extract::State, http::StatusCode};
use serde::Deserialize;
use time::OffsetDateTime;
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::extract::{Json, Path, present};
use crate::{
    AppState,
    auth::AuthUser,
    db::containers::{self, Container, ContainerChanges, ContainerKind},
    error::{AppError, ErrorBody},
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_containers, create_container))
        .routes(routes!(get_container, update_container, delete_container))
}

/// List every jar and tray in the household, unarchived ones first.
#[utoipa::path(
    get,
    path = "/containers",
    tag = "containers",
    security(("session" = [])),
    responses(
        (status = 200, body = Vec<Container>),
        (status = 401, body = ErrorBody),
    ),
)]
async fn list_containers(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
) -> Result<Json<Vec<Container>>, AppError> {
    Ok(Json(containers::list(&state.pool, user.id).await?))
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct CreateContainer {
    /// Unique in the household, ignoring case.
    name: String,
    kind: ContainerKind,
    /// A colour like `#3b82f6`. Leave it out for clear glass.
    color: Option<String>,
    #[serde(default)]
    notes: String,
}

/// Add a jar or tray for the whole household.
#[utoipa::path(
    post,
    path = "/containers",
    tag = "containers",
    security(("session" = [])),
    request_body = CreateContainer,
    responses(
        (status = 201, body = Container),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 422, description = "The name is empty, too long, or taken", body = ErrorBody),
    ),
)]
async fn create_container(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Json(request): Json<CreateContainer>,
) -> Result<(StatusCode, Json<Container>), AppError> {
    let id = containers::create(
        &state.pool,
        user.id,
        &request.name,
        request.kind,
        request.color.as_deref(),
        &request.notes,
    )
    .await?;
    let container = containers::find(&state.pool, user.id, id).await?;
    Ok((StatusCode::CREATED, Json(container)))
}

#[utoipa::path(
    get,
    path = "/containers/{id}",
    tag = "containers",
    security(("session" = [])),
    params(("id" = Uuid, Path)),
    responses(
        (status = 200, body = Container),
        (status = 401, body = ErrorBody),
        (status = 404, body = ErrorBody),
    ),
)]
async fn get_container(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Container>, AppError> {
    Ok(Json(containers::find(&state.pool, user.id, id).await?))
}

/// Fields to change. Leave a field out to keep it.
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct UpdateContainer {
    name: Option<String>,
    kind: Option<ContainerKind>,
    /// A colour like `#3b82f6`, or null to remove it.
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<String>)]
    color: Option<Option<String>>,
    notes: Option<String>,
    /// Archive or restore. Archived containers can't take new batches.
    archived: Option<bool>,
}

/// Rename, edit, archive, or restore a jar or tray.
#[utoipa::path(
    patch,
    path = "/containers/{id}",
    tag = "containers",
    security(("session" = [])),
    params(("id" = Uuid, Path)),
    request_body = UpdateContainer,
    responses(
        (status = 200, body = Container),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, description = "Archiving a container with an active batch (`container_in_use`)", body = ErrorBody),
        (status = 422, body = ErrorBody),
    ),
)]
async fn update_container(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<Uuid>,
    Json(request): Json<UpdateContainer>,
) -> Result<Json<Container>, AppError> {
    let changes = ContainerChanges {
        name: request.name,
        kind: request.kind,
        color: request.color,
        notes: request.notes,
        archived: request.archived,
    };
    containers::update(&state.pool, id, changes, OffsetDateTime::now_utc()).await?;
    Ok(Json(containers::find(&state.pool, user.id, id).await?))
}

/// Delete a jar or tray that has never held a batch. Archive one with history instead.
#[utoipa::path(
    delete,
    path = "/containers/{id}",
    tag = "containers",
    security(("session" = [])),
    params(("id" = Uuid, Path)),
    responses(
        (status = 204, description = "Deleted"),
        (status = 401, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, description = "It has held batches (`container_has_history`)", body = ErrorBody),
    ),
)]
async fn delete_container(
    State(state): State<AppState>,
    _user: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    containers::delete(&state.pool, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
