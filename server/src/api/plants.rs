use axum::{extract::State, http::StatusCode};
use utoipa_axum::{router::OpenApiRouter, routes};

use super::extract::{Json, Path};
use crate::{
    AppState,
    auth::AuthUser,
    db::plants,
    domain::{
        library::LibraryEntry,
        plant::{Plant, Slug},
    },
    error::{AppError, ErrorBody},
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_plants))
        .routes(routes!(get_plant, put_plant, delete_plant))
}

/// List every plant: built-in ones, custom ones, and custom overrides of built-in ones.
#[utoipa::path(
    get,
    path = "/plants",
    tag = "plants",
    security(("session" = [])),
    responses(
        (status = 200, body = Vec<LibraryEntry>),
        (status = 401, body = ErrorBody),
    ),
)]
async fn list_plants(
    State(state): State<AppState>,
    _user: AuthUser,
) -> Result<Json<Vec<LibraryEntry>>, AppError> {
    Ok(Json(plants::list(&state.pool).await?))
}

#[utoipa::path(
    get,
    path = "/plants/{slug}",
    tag = "plants",
    security(("session" = [])),
    params(("slug" = Slug, Path)),
    responses(
        (status = 200, body = LibraryEntry),
        (status = 401, body = ErrorBody),
        (status = 404, body = ErrorBody),
    ),
)]
async fn get_plant(
    State(state): State<AppState>,
    _user: AuthUser,
    Path(slug): Path<Slug>,
) -> Result<Json<LibraryEntry>, AppError> {
    plants::find(&state.pool, &slug)
        .await?
        .map(Json)
        .ok_or(AppError::NotFound)
}

/// Create or replace a custom plant. Using a built-in slug overrides the built-in plant for
/// everyone on the server.
#[utoipa::path(
    put,
    path = "/plants/{slug}",
    tag = "plants",
    security(("session" = [])),
    params(("slug" = Slug, Path)),
    request_body = Plant,
    responses(
        (status = 200, body = LibraryEntry),
        (status = 400, description = "The body isn't a plant definition", body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 422, description = "The definition breaks a rule", body = ErrorBody),
    ),
)]
async fn put_plant(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(slug): Path<Slug>,
    Json(plant): Json<Plant>,
) -> Result<Json<LibraryEntry>, AppError> {
    plant.validate().map_err(AppError::Invalid)?;
    plants::save_custom(&state.pool, &slug, &plant, user.id).await?;

    let entry = plants::find(&state.pool, &slug)
        .await?
        .ok_or_else(|| anyhow::anyhow!("plant {slug} vanished after saving"))?;
    Ok(Json(entry))
}

/// Delete a custom plant. For an override, the built-in plant comes back. Running batches keep
/// their copy of the definition.
#[utoipa::path(
    delete,
    path = "/plants/{slug}",
    tag = "plants",
    security(("session" = [])),
    params(("slug" = Slug, Path)),
    responses(
        (status = 204, description = "Deleted"),
        (status = 401, body = ErrorBody),
        (status = 404, description = "No custom plant has this slug", body = ErrorBody),
    ),
)]
async fn delete_plant(
    State(state): State<AppState>,
    _user: AuthUser,
    Path(slug): Path<Slug>,
) -> Result<StatusCode, AppError> {
    if plants::delete_custom(&state.pool, &slug).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(AppError::NotFound)
    }
}
