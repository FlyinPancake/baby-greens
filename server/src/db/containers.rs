//! Jars and trays, shared by every account on the server.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::error::AppError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, sqlx::Type)]
#[sqlx(type_name = "container_kind", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum ContainerKind {
    Jar,
    Tray,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct Container {
    pub id: Uuid,
    pub name: String,
    pub kind: ContainerKind,
    pub notes: String,
    #[serde(with = "time::serde::rfc3339::option")]
    pub archived_at: Option<OffsetDateTime>,
    /// How many batches this container has held, across the household.
    pub batch_count: i64,
    /// The batch growing in it right now, if any.
    pub occupant: Option<Occupant>,
}

/// The active batch in a container. Another household member's batch shows who grows it, but
/// not its id, because batches are private to their owner.
#[derive(Debug, Serialize, ToSchema)]
pub struct Occupant {
    pub plant_name: String,
    pub grower: String,
    /// Set when the batch is yours, so you can link to it.
    pub batch_id: Option<Uuid>,
}

const NAME_TAKEN: &str = "another jar or tray already has this name";

/// Turns the unique name index's error into a field problem.
fn name_conflict(error: sqlx::Error) -> AppError {
    match &error {
        sqlx::Error::Database(db) if db.constraint() == Some("containers_name_unique") => {
            AppError::invalid("name", NAME_TAKEN)
        }
        _ => error.into(),
    }
}

fn clean_name(name: &str) -> Result<String, AppError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::invalid("name", "must not be empty"));
    }
    if name.chars().count() > 60 {
        return Err(AppError::invalid("name", "must be 60 characters or fewer"));
    }
    Ok(name.to_owned())
}

/// Every container, unarchived ones first, then by name. `viewer` decides which occupants link
/// to their batch.
pub async fn list(pool: &PgPool, viewer: Uuid) -> Result<Vec<Container>, AppError> {
    let rows = sqlx::query!(
        r#"
        SELECT c.id, c.name, c.kind AS "kind: ContainerKind", c.notes, c.archived_at,
               (SELECT count(*) FROM batches b WHERE b.container_id = c.id) AS "batch_count!",
               a.id AS "active_id?", a.user_id AS "active_user?",
               a.plant ->> 'name' AS "active_plant?", u.display_name AS "active_grower?"
        FROM containers c
        LEFT JOIN batches a ON a.container_id = c.id AND a.status = 'active'
        LEFT JOIN users u ON u.id = a.user_id
        ORDER BY c.archived_at IS NOT NULL, lower(c.name)
        "#,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| Container {
            id: row.id,
            name: row.name,
            kind: row.kind,
            notes: row.notes,
            archived_at: row.archived_at,
            batch_count: row.batch_count,
            occupant: row.active_plant.map(|plant_name| Occupant {
                plant_name,
                grower: row.active_grower.unwrap_or_default(),
                batch_id: row.active_id.filter(|_| row.active_user == Some(viewer)),
            }),
        })
        .collect())
}

pub async fn find(pool: &PgPool, viewer: Uuid, id: Uuid) -> Result<Container, AppError> {
    list(pool, viewer)
        .await?
        .into_iter()
        .find(|container| container.id == id)
        .ok_or(AppError::NotFound)
}

pub async fn create(
    pool: &PgPool,
    user_id: Uuid,
    name: &str,
    kind: ContainerKind,
    notes: &str,
) -> Result<Uuid, AppError> {
    let name = clean_name(name)?;
    sqlx::query_scalar!(
        r#"
        INSERT INTO containers (name, kind, notes, created_by)
        VALUES ($1, $2, $3, $4)
        RETURNING id
        "#,
        name,
        kind as ContainerKind,
        notes.trim(),
        user_id,
    )
    .fetch_one(pool)
    .await
    .map_err(name_conflict)
}

/// Fields to change. `None` leaves a field as it is.
#[derive(Debug, Default)]
pub struct ContainerChanges {
    pub name: Option<String>,
    pub kind: Option<ContainerKind>,
    pub notes: Option<String>,
    pub archived: Option<bool>,
}

pub async fn update(
    pool: &PgPool,
    id: Uuid,
    changes: ContainerChanges,
    now: OffsetDateTime,
) -> Result<(), AppError> {
    let name = changes.name.as_deref().map(clean_name).transpose()?;
    let mut tx = pool.begin().await?;

    let current = sqlx::query!(
        r#"
        SELECT EXISTS (
            SELECT 1 FROM batches WHERE container_id = c.id AND status = 'active'
        ) AS "in_use!"
        FROM containers c WHERE c.id = $1
        FOR UPDATE
        "#,
        id,
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(AppError::NotFound)?;

    if changes.archived == Some(true) && current.in_use {
        return Err(AppError::Conflict("container_in_use"));
    }

    sqlx::query!(
        r#"
        UPDATE containers SET
            name = coalesce($2, name),
            kind = coalesce($3, kind),
            notes = coalesce($4, notes),
            archived_at = CASE
                WHEN $5::boolean IS NULL THEN archived_at
                WHEN $5 THEN coalesce(archived_at, $6)
                ELSE NULL
            END
        WHERE id = $1
        "#,
        id,
        name,
        changes.kind as Option<ContainerKind>,
        changes.notes.as_deref().map(str::trim),
        changes.archived,
        now,
    )
    .execute(&mut *tx)
    .await
    .map_err(name_conflict)?;

    tx.commit().await?;
    Ok(())
}

/// Deletes a container that has never held a batch. Ones with history get archived instead.
pub async fn delete(pool: &PgPool, id: Uuid) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;

    let has_history = sqlx::query_scalar!(
        r#"
        SELECT EXISTS (SELECT 1 FROM batches WHERE container_id = c.id) AS "has_history!"
        FROM containers c WHERE c.id = $1
        FOR UPDATE
        "#,
        id,
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(AppError::NotFound)?;

    if has_history {
        return Err(AppError::Conflict("container_has_history"));
    }

    sqlx::query!("DELETE FROM containers WHERE id = $1", id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use time::macros::datetime;

    use super::*;
    use crate::db::users::{self, Identity};

    const NOW: OffsetDateTime = datetime!(2026-10-05 12:00 UTC);

    async fn user(pool: &PgPool, subject: &str) -> Uuid {
        let identity = Identity {
            issuer: "http://localhost:5556/dex",
            subject,
            display_name: subject,
            email: None,
        };
        users::upsert_from_identity(pool, &identity).await.unwrap()
    }

    #[sqlx::test]
    async fn names_are_unique_ignoring_case(pool: PgPool) {
        let user_id = user(&pool, "grower").await;
        create(&pool, user_id, "Jar 2", ContainerKind::Jar, "")
            .await
            .unwrap();

        let duplicate = create(&pool, user_id, "  jar 2 ", ContainerKind::Jar, "").await;
        assert!(
            matches!(duplicate, Err(AppError::Invalid(problems)) if problems[0].path == "name")
        );

        let other = create(&pool, user_id, "jar 3", ContainerKind::Jar, "")
            .await
            .unwrap();
        let rename = ContainerChanges {
            name: Some("JAR 2".into()),
            ..Default::default()
        };
        assert!(matches!(
            update(&pool, other, rename, NOW).await,
            Err(AppError::Invalid(_))
        ));
    }

    #[sqlx::test]
    async fn blank_names_are_rejected(pool: PgPool) {
        let user_id = user(&pool, "grower").await;
        let blank = create(&pool, user_id, "   ", ContainerKind::Tray, "").await;
        assert!(matches!(blank, Err(AppError::Invalid(_))));
    }

    #[sqlx::test]
    async fn archive_restore_and_delete(pool: PgPool) {
        let user_id = user(&pool, "grower").await;
        let id = create(&pool, user_id, "tray A", ContainerKind::Tray, "")
            .await
            .unwrap();

        let archive = ContainerChanges {
            archived: Some(true),
            notes: Some(" cracked corner ".into()),
            ..Default::default()
        };
        update(&pool, id, archive, NOW).await.unwrap();
        let container = find(&pool, user_id, id).await.unwrap();
        assert_eq!(container.archived_at, Some(NOW));
        assert_eq!(container.notes, "cracked corner");

        let restore = ContainerChanges {
            archived: Some(false),
            ..Default::default()
        };
        update(&pool, id, restore, NOW).await.unwrap();
        assert_eq!(find(&pool, user_id, id).await.unwrap().archived_at, None);

        delete(&pool, id).await.unwrap();
        assert!(matches!(
            find(&pool, user_id, id).await,
            Err(AppError::NotFound)
        ));
    }
}
