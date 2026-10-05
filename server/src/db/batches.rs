//! Batches and their tasks. The functions that change a batch run in a transaction and apply the
//! rules from `domain::schedule`.

use anyhow::{Context, anyhow};
use serde::{Deserialize, Serialize};
use sqlx::{PgConnection, PgPool, types::Json};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    domain::{
        plant::{Plant, PlantKind, Slug, StepAction},
        schedule::{self, PlannedTask, StepWindow, TaskAction},
    },
    error::AppError,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, sqlx::Type)]
#[sqlx(type_name = "batch_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum BatchStatus {
    Active,
    Harvested,
    Discarded,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BatchSummary {
    pub id: Uuid,
    pub plant_slug: String,
    pub plant_name: String,
    pub plant_kind: PlantKind,
    pub container_id: Uuid,
    /// The container's current name.
    pub container: String,
    /// The container's colour, as `#rrggbb`.
    pub container_color: Option<String>,
    pub seed_g: i32,
    #[serde(with = "time::serde::rfc3339")]
    pub started_at: OffsetDateTime,
    pub status: BatchStatus,
    pub current_step: usize,
    pub current_action: StepAction,
    #[serde(with = "time::serde::rfc3339")]
    pub step_started_at: OffsetDateTime,
    /// When the batch should be ready, counted from when the current step actually started. Only
    /// set for active batches.
    pub harvest_window: Option<HarvestWindow>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct HarvestWindow {
    #[serde(with = "time::serde::rfc3339")]
    pub earliest: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub latest: OffsetDateTime,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BatchDetail {
    pub batch: BatchSummary,
    pub notes: String,
    /// The plant definition as it was when the batch started.
    pub plant: Plant,
    /// The steps the batch has been in, with actual times.
    pub steps: Vec<StepRecord>,
    /// Planned windows from the current step to harvest. Empty unless the batch is active.
    pub upcoming: Vec<StepWindow>,
    pub open_tasks: Vec<TaskView>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct StepRecord {
    pub step_index: usize,
    pub action: StepAction,
    #[serde(with = "time::serde::rfc3339")]
    pub started_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub ended_at: Option<OffsetDateTime>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TaskView {
    pub id: Uuid,
    pub batch_id: Uuid,
    pub step_index: usize,
    #[serde(flatten)]
    pub action: TaskAction,
    #[serde(with = "time::serde::rfc3339")]
    pub due_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub overdue_at: Option<OffsetDateTime>,
    /// Set while the task is snoozed. `due_at` already counts the snooze.
    #[serde(with = "time::serde::rfc3339::option")]
    pub snoozed_until: Option<OffsetDateTime>,
    pub container: String,
    pub container_color: Option<String>,
    pub plant_name: String,
}

/// A validated request to start a batch.
pub struct NewBatch {
    pub plant_slug: Slug,
    pub plant: Plant,
    pub container_id: Uuid,
    pub seed_g: u32,
    pub started_at: OffsetDateTime,
    pub notes: String,
}

struct BatchRow {
    id: Uuid,
    plant_slug: String,
    plant: Json<Plant>,
    container_id: Uuid,
    container: String,
    container_color: Option<String>,
    seed_g: i32,
    started_at: OffsetDateTime,
    status: BatchStatus,
    current_step: i32,
    notes: String,
    step_started_at: OffsetDateTime,
}

impl BatchRow {
    fn summary(&self) -> Result<BatchSummary, AppError> {
        let plant = &self.plant.0;
        let current_step = index(self.current_step)?;
        let current_action = plant
            .steps
            .get(current_step)
            .with_context(|| format!("batch {} is past the end of its plant", self.id))?
            .action;

        let harvest_window = (self.status == BatchStatus::Active)
            .then(|| schedule::timeline(plant, current_step, self.step_started_at))
            .and_then(|timeline| timeline.last().cloned())
            .map(|window| HarvestWindow {
                earliest: window.earliest_start,
                latest: window.latest_start,
            });

        Ok(BatchSummary {
            id: self.id,
            plant_slug: self.plant_slug.clone(),
            plant_name: plant.name.clone(),
            plant_kind: plant.kind,
            container_id: self.container_id,
            container: self.container.clone(),
            container_color: self.container_color.clone(),
            seed_g: self.seed_g,
            started_at: self.started_at,
            status: self.status,
            current_step,
            current_action,
            step_started_at: self.step_started_at,
            harvest_window,
        })
    }
}

fn index(value: i32) -> Result<usize, AppError> {
    usize::try_from(value).map_err(|_| anyhow!("negative step index {value}").into())
}

fn db_index(value: usize) -> Result<i32, AppError> {
    i32::try_from(value).map_err(|_| anyhow!("step index {value} is too large").into())
}

/// Which of the user's batches to list. Empty filters list them all.
#[derive(Debug, Default)]
pub struct BatchFilter {
    pub status: Option<BatchStatus>,
    pub container_id: Option<Uuid>,
}

pub async fn list(
    pool: &PgPool,
    user_id: Uuid,
    filter: BatchFilter,
) -> Result<Vec<BatchSummary>, AppError> {
    let rows = sqlx::query_as!(
        BatchRow,
        r#"
        SELECT b.id, b.plant_slug, b.plant AS "plant: Json<Plant>", b.container_id,
               c.name AS container, c.color AS container_color, b.seed_g, b.started_at, b.status AS "status: BatchStatus",
               b.current_step, b.notes, s.started_at AS step_started_at
        FROM batches b
        JOIN containers c ON c.id = b.container_id
        JOIN batch_steps s ON s.batch_id = b.id AND s.step_index = b.current_step
        WHERE b.user_id = $1
          AND ($2::batch_status IS NULL OR b.status = $2)
          AND ($3::uuid IS NULL OR b.container_id = $3)
        ORDER BY b.started_at DESC
        "#,
        user_id,
        filter.status as Option<BatchStatus>,
        filter.container_id,
    )
    .fetch_all(pool)
    .await?;

    rows.iter().map(BatchRow::summary).collect()
}

pub async fn find(pool: &PgPool, user_id: Uuid, id: Uuid) -> Result<BatchDetail, AppError> {
    let row = sqlx::query_as!(
        BatchRow,
        r#"
        SELECT b.id, b.plant_slug, b.plant AS "plant: Json<Plant>", b.container_id,
               c.name AS container, c.color AS container_color, b.seed_g, b.started_at, b.status AS "status: BatchStatus",
               b.current_step, b.notes, s.started_at AS step_started_at
        FROM batches b
        JOIN containers c ON c.id = b.container_id
        JOIN batch_steps s ON s.batch_id = b.id AND s.step_index = b.current_step
        WHERE b.id = $1 AND b.user_id = $2
        "#,
        id,
        user_id,
    )
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let summary = row.summary()?;
    let plant = row.plant.0;

    let steps = sqlx::query!(
        "SELECT step_index, started_at, ended_at FROM batch_steps WHERE batch_id = $1 ORDER BY step_index",
        id,
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|step| {
        let step_index = index(step.step_index)?;
        let action = plant
            .steps
            .get(step_index)
            .with_context(|| format!("batch {id} has an unknown step {step_index}"))?
            .action;
        Ok(StepRecord {
            step_index,
            action,
            started_at: step.started_at,
            ended_at: step.ended_at,
        })
    })
    .collect::<Result<Vec<_>, AppError>>()?;

    let upcoming = if summary.status == BatchStatus::Active {
        schedule::timeline(&plant, summary.current_step, summary.step_started_at)
    } else {
        Vec::new()
    };

    let open_tasks = open_tasks(pool, user_id, None, Some(id)).await?;

    Ok(BatchDetail {
        batch: summary,
        notes: row.notes,
        plant,
        steps,
        upcoming,
        open_tasks,
    })
}

/// Open tasks on the user's active batches, soonest first. `due_before` limits them by when
/// they're due, counting snoozes. `batch_id` limits them to one batch.
pub async fn open_tasks(
    pool: &PgPool,
    user_id: Uuid,
    due_before: Option<OffsetDateTime>,
    batch_id: Option<Uuid>,
) -> Result<Vec<TaskView>, AppError> {
    let rows = sqlx::query!(
        r#"
        SELECT t.id, t.batch_id, t.step_index, t.kind::text AS "kind!", t.action,
               coalesce(t.snoozed_until, t.due_at) AS "due_at!", t.overdue_at, t.snoozed_until,
               c.name AS container, c.color AS container_color,
               b.plant ->> 'name' AS "plant_name!"
        FROM tasks t
        JOIN batches b ON b.id = t.batch_id
        JOIN containers c ON c.id = b.container_id
        WHERE b.user_id = $1
          AND b.status = 'active'
          AND t.done_at IS NULL
          AND ($2::timestamptz IS NULL OR coalesce(t.snoozed_until, t.due_at) <= $2)
          AND ($3::uuid IS NULL OR t.batch_id = $3)
        ORDER BY coalesce(t.snoozed_until, t.due_at), t.id
        "#,
        user_id,
        due_before,
        batch_id,
    )
    .fetch_all(pool)
    .await?;

    rows.into_iter()
        .map(|row| {
            let action = TaskAction::from_parts(&row.kind, &row.action).with_context(|| {
                format!(
                    "task {} has an unknown action {}/{}",
                    row.id, row.kind, row.action
                )
            })?;
            Ok(TaskView {
                id: row.id,
                batch_id: row.batch_id,
                step_index: index(row.step_index)?,
                action,
                due_at: row.due_at,
                overdue_at: row.overdue_at,
                snoozed_until: row.snoozed_until,
                container: row.container,
                container_color: row.container_color,
                plant_name: row.plant_name,
            })
        })
        .collect()
}

/// Starts a batch in its first step and schedules that step's tasks. Returns the batch id.
pub async fn create(pool: &PgPool, user_id: Uuid, batch: NewBatch) -> Result<Uuid, AppError> {
    let mut tx = pool.begin().await?;

    let seed_g =
        i32::try_from(batch.seed_g).map_err(|_| AppError::invalid("seed_g", "is too large"))?;

    // Lock the container so it can't be archived while the batch goes in.
    let archived = sqlx::query_scalar!(
        "SELECT archived_at IS NOT NULL AS \"archived!\" FROM containers WHERE id = $1 FOR SHARE",
        batch.container_id,
    )
    .fetch_optional(&mut *tx)
    .await?;
    match archived {
        None => {
            return Err(AppError::invalid(
                "container_id",
                "no jar or tray has this id",
            ));
        }
        Some(true) => return Err(AppError::invalid("container_id", "is archived")),
        Some(false) => {}
    }

    let id = sqlx::query_scalar!(
        r#"
        INSERT INTO batches (user_id, plant_slug, plant, container_id, seed_g, started_at, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
        "#,
        user_id,
        batch.plant_slug.as_str(),
        Json(&batch.plant) as _,
        batch.container_id,
        seed_g,
        batch.started_at,
        batch.notes,
    )
    .fetch_one(&mut *tx)
    .await
    .map_err(|error| match &error {
        sqlx::Error::Database(db)
            if db.constraint() == Some("batches_one_active_per_container") =>
        {
            AppError::Conflict("container_in_use")
        }
        _ => error.into(),
    })?;

    enter_step(&mut tx, id, &batch.plant, 0, batch.started_at).await?;

    tx.commit().await?;
    Ok(id)
}

/// Marks a task done. A care task schedules its next occurrence. An advance task moves the
/// batch into its next step.
pub async fn complete_task(
    pool: &PgPool,
    user_id: Uuid,
    task_id: Uuid,
    now: OffsetDateTime,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;

    let task = sqlx::query!(
        r#"
        SELECT t.batch_id, t.step_index, t.kind::text AS "kind!", t.action, t.done_at,
               b.current_step, b.status AS "status: BatchStatus", b.plant AS "plant: Json<Plant>"
        FROM tasks t
        JOIN batches b ON b.id = t.batch_id
        WHERE t.id = $1 AND b.user_id = $2
        FOR UPDATE OF t, b
        "#,
        task_id,
        user_id,
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(AppError::NotFound)?;

    if task.done_at.is_some() {
        return Err(AppError::Conflict("task_done"));
    }
    if task.status != BatchStatus::Active {
        return Err(AppError::Conflict("batch_not_active"));
    }
    if task.step_index != task.current_step {
        return Err(AppError::Conflict("stale_task"));
    }

    let action = TaskAction::from_parts(&task.kind, &task.action)
        .with_context(|| format!("task {task_id} has an unknown action"))?;
    let plant = task.plant.0;
    let step_index = index(task.step_index)?;

    sqlx::query!("UPDATE tasks SET done_at = $2 WHERE id = $1", task_id, now)
        .execute(&mut *tx)
        .await?;

    match action {
        TaskAction::Care(care) => {
            if let Some(next) = schedule::next_care(&plant, step_index, care, now) {
                insert_tasks(&mut tx, task.batch_id, &[next]).await?;
            }
        }
        TaskAction::Advance(_) => advance(&mut tx, task.batch_id, &plant, step_index, now).await?,
    }

    tx.commit().await?;
    Ok(())
}

/// Pushes a task back to `until`. It counts as not notified again, so a reminder goes out when
/// the snooze ends.
pub async fn snooze_task(
    pool: &PgPool,
    user_id: Uuid,
    task_id: Uuid,
    until: OffsetDateTime,
    now: OffsetDateTime,
) -> Result<(), AppError> {
    if until <= now {
        return Err(AppError::invalid("until", "must be in the future"));
    }
    if until > now + time::Duration::days(7) {
        return Err(AppError::invalid("until", "must be within a week"));
    }

    let mut tx = pool.begin().await?;
    let task = sqlx::query!(
        r#"
        SELECT t.done_at, b.status AS "status: BatchStatus"
        FROM tasks t
        JOIN batches b ON b.id = t.batch_id
        WHERE t.id = $1 AND b.user_id = $2
        FOR UPDATE OF t
        "#,
        task_id,
        user_id,
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(AppError::NotFound)?;

    if task.done_at.is_some() {
        return Err(AppError::Conflict("task_done"));
    }
    if task.status != BatchStatus::Active {
        return Err(AppError::Conflict("batch_not_active"));
    }

    sqlx::query!(
        "UPDATE tasks SET snoozed_until = $2, notified_at = NULL WHERE id = $1",
        task_id,
        until,
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Stops an active batch early.
pub async fn discard(
    pool: &PgPool,
    user_id: Uuid,
    id: Uuid,
    now: OffsetDateTime,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;

    let batch = sqlx::query!(
        r#"
        SELECT current_step, status AS "status: BatchStatus"
        FROM batches WHERE id = $1 AND user_id = $2
        FOR UPDATE
        "#,
        id,
        user_id,
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(AppError::NotFound)?;

    if batch.status != BatchStatus::Active {
        return Err(AppError::Conflict("batch_not_active"));
    }

    end_step(&mut tx, id, batch.current_step, now).await?;
    sqlx::query!("UPDATE batches SET status = 'discarded' WHERE id = $1", id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(())
}

/// Leaves `current` for the next step. Entering the final harvest step ends the batch.
async fn advance(
    conn: &mut PgConnection,
    batch_id: Uuid,
    plant: &Plant,
    current: usize,
    now: OffsetDateTime,
) -> Result<(), AppError> {
    let next = current + 1;
    let is_harvest = next + 1 == plant.steps.len();

    end_step(conn, batch_id, db_index(current)?, now).await?;

    let status = if is_harvest {
        BatchStatus::Harvested
    } else {
        BatchStatus::Active
    };
    sqlx::query!(
        "UPDATE batches SET current_step = $2, status = $3 WHERE id = $1",
        batch_id,
        db_index(next)?,
        status as BatchStatus,
    )
    .execute(&mut *conn)
    .await?;

    enter_step(conn, batch_id, plant, next, now).await
}

/// Records the step's start and schedules its tasks.
async fn enter_step(
    conn: &mut PgConnection,
    batch_id: Uuid,
    plant: &Plant,
    step_index: usize,
    at: OffsetDateTime,
) -> Result<(), AppError> {
    sqlx::query!(
        "INSERT INTO batch_steps (batch_id, step_index, started_at) VALUES ($1, $2, $3)",
        batch_id,
        db_index(step_index)?,
        at,
    )
    .execute(&mut *conn)
    .await?;

    insert_tasks(
        conn,
        batch_id,
        &schedule::tasks_on_entering(plant, step_index, at),
    )
    .await
}

/// Records the step's end and drops its open tasks.
async fn end_step(
    conn: &mut PgConnection,
    batch_id: Uuid,
    step_index: i32,
    at: OffsetDateTime,
) -> Result<(), AppError> {
    sqlx::query!(
        r#"
        UPDATE batch_steps SET ended_at = greatest(started_at, $3)
        WHERE batch_id = $1 AND step_index = $2
        "#,
        batch_id,
        step_index,
        at,
    )
    .execute(&mut *conn)
    .await?;

    sqlx::query!(
        "DELETE FROM tasks WHERE batch_id = $1 AND done_at IS NULL",
        batch_id
    )
    .execute(&mut *conn)
    .await?;

    Ok(())
}

async fn insert_tasks(
    conn: &mut PgConnection,
    batch_id: Uuid,
    tasks: &[PlannedTask],
) -> Result<(), AppError> {
    for task in tasks {
        sqlx::query!(
            r#"
            INSERT INTO tasks (batch_id, step_index, kind, action, due_at, overdue_at)
            VALUES ($1, $2, $3::text::task_kind, $4, $5, $6)
            "#,
            batch_id,
            db_index(task.step_index)?,
            task.action.kind(),
            task.action.action(),
            task.due_at,
            task.overdue_at,
        )
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use time::macros::datetime;

    use super::*;
    use crate::{
        db::{
            containers::{self, ContainerChanges, ContainerKind},
            users::{self, Identity},
        },
        domain::{library, plant::CareAction},
    };

    const START: OffsetDateTime = datetime!(2026-10-05 08:00 UTC);

    async fn user(pool: &PgPool, subject: &str) -> Uuid {
        let identity = Identity {
            issuer: "http://localhost:5556/dex",
            subject,
            display_name: subject,
            email: None,
        };
        users::upsert_from_identity(pool, &identity).await.unwrap()
    }

    async fn jar(pool: &PgPool, user_id: Uuid, name: &str) -> Uuid {
        containers::create(pool, user_id, name, ContainerKind::Jar, None, "")
            .await
            .unwrap()
    }

    fn alfalfa(container_id: Uuid) -> NewBatch {
        let slug: Slug = "alfalfa".parse().unwrap();
        let plant = library::builtin()[&slug].clone();
        NewBatch {
            plant_slug: slug,
            plant,
            container_id,
            seed_g: 15,
            started_at: START,
            notes: String::new(),
        }
    }

    /// Alfalfa in a new jar: soak 8h to 12h, sprout 4d to 6d with a rinse every 12h, then
    /// harvest.
    async fn alfalfa_batch(pool: &PgPool, user_id: Uuid) -> Uuid {
        static JARS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let n = JARS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let container_id = jar(pool, user_id, &format!("jar {n}")).await;
        create(pool, user_id, alfalfa(container_id)).await.unwrap()
    }

    async fn tasks(pool: &PgPool, user_id: Uuid, batch_id: Uuid) -> Vec<TaskView> {
        open_tasks(pool, user_id, None, Some(batch_id))
            .await
            .unwrap()
    }

    #[sqlx::test]
    async fn a_batch_runs_from_soak_to_harvest(pool: PgPool) {
        let user_id = user(&pool, "grower").await;
        let id = alfalfa_batch(&pool, user_id).await;

        // Soaking: only the advance task, due after the shortest soak.
        let soak = tasks(&pool, user_id, id).await;
        assert_eq!(soak.len(), 1);
        assert_eq!(soak[0].action, TaskAction::Advance(StepAction::Sprout));
        assert_eq!(soak[0].due_at, datetime!(2026-10-05 16:00 UTC));
        assert_eq!(soak[0].overdue_at, Some(datetime!(2026-10-05 20:00 UTC)));

        // Drain late, at 18:00. The sprout step counts from then.
        let drained = datetime!(2026-10-05 18:00 UTC);
        complete_task(&pool, user_id, soak[0].id, drained)
            .await
            .unwrap();

        let sprouting = tasks(&pool, user_id, id).await;
        let actions: Vec<_> = sprouting
            .iter()
            .map(|task| (task.action, task.due_at))
            .collect();
        assert_eq!(
            actions,
            [
                (
                    TaskAction::Care(CareAction::Rinse),
                    datetime!(2026-10-06 06:00 UTC)
                ),
                (
                    TaskAction::Advance(StepAction::Harvest),
                    datetime!(2026-10-09 18:00 UTC)
                ),
            ]
        );

        let detail = find(&pool, user_id, id).await.unwrap();
        assert_eq!(detail.batch.current_action, StepAction::Sprout);
        assert_eq!(detail.steps[0].ended_at, Some(drained));
        let window = detail.batch.harvest_window.unwrap();
        assert_eq!(window.earliest, datetime!(2026-10-09 18:00 UTC));
        assert_eq!(window.latest, datetime!(2026-10-11 18:00 UTC));

        // Rinsing schedules the next rinse from when it was done.
        let rinsed = datetime!(2026-10-06 07:30 UTC);
        complete_task(&pool, user_id, sprouting[0].id, rinsed)
            .await
            .unwrap();
        let next_rinse = &tasks(&pool, user_id, id).await[0];
        assert_eq!(next_rinse.action, TaskAction::Care(CareAction::Rinse));
        assert_eq!(next_rinse.due_at, datetime!(2026-10-06 19:30 UTC));

        // Doing it twice is a conflict.
        let again = complete_task(&pool, user_id, sprouting[0].id, rinsed).await;
        assert!(matches!(again, Err(AppError::Conflict("task_done"))));

        // Harvesting ends the batch and drops the leftover rinse.
        let harvested = datetime!(2026-10-10 09:00 UTC);
        complete_task(&pool, user_id, sprouting[1].id, harvested)
            .await
            .unwrap();

        let detail = find(&pool, user_id, id).await.unwrap();
        assert_eq!(detail.batch.status, BatchStatus::Harvested);
        assert_eq!(detail.batch.current_action, StepAction::Harvest);
        assert!(detail.batch.harvest_window.is_none());
        assert!(detail.upcoming.is_empty());
        assert!(detail.open_tasks.is_empty());
        assert_eq!(detail.steps.len(), 3);
        assert_eq!(detail.steps[1].ended_at, Some(harvested));
    }

    #[sqlx::test]
    async fn due_before_limits_the_list(pool: PgPool) {
        let user_id = user(&pool, "grower").await;
        alfalfa_batch(&pool, user_id).await;

        let before_due = open_tasks(&pool, user_id, Some(datetime!(2026-10-05 15:59 UTC)), None);
        assert!(before_due.await.unwrap().is_empty());

        let at_due = open_tasks(&pool, user_id, Some(datetime!(2026-10-05 16:00 UTC)), None);
        assert_eq!(at_due.await.unwrap().len(), 1);
    }

    #[sqlx::test]
    async fn other_users_batches_are_invisible(pool: PgPool) {
        let owner = user(&pool, "grower").await;
        let other = user(&pool, "neighbour").await;
        let id = alfalfa_batch(&pool, owner).await;
        let task_id = tasks(&pool, owner, id).await[0].id;

        assert!(
            list(&pool, other, BatchFilter::default())
                .await
                .unwrap()
                .is_empty()
        );
        assert!(matches!(
            find(&pool, other, id).await,
            Err(AppError::NotFound)
        ));
        assert!(matches!(
            complete_task(&pool, other, task_id, START).await,
            Err(AppError::NotFound)
        ));
        assert!(matches!(
            discard(&pool, other, id, START).await,
            Err(AppError::NotFound)
        ));
        assert!(tasks(&pool, other, id).await.is_empty());
    }

    #[sqlx::test]
    async fn discarding_stops_the_batch(pool: PgPool) {
        let user_id = user(&pool, "grower").await;
        let id = alfalfa_batch(&pool, user_id).await;
        let task_id = tasks(&pool, user_id, id).await[0].id;

        discard(&pool, user_id, id, datetime!(2026-10-05 10:00 UTC))
            .await
            .unwrap();

        let detail = find(&pool, user_id, id).await.unwrap();
        assert_eq!(detail.batch.status, BatchStatus::Discarded);
        assert!(detail.open_tasks.is_empty());
        assert!(matches!(
            discard(&pool, user_id, id, START).await,
            Err(AppError::Conflict("batch_not_active"))
        ));
        // The deleted task is gone, so completing it finds nothing.
        assert!(matches!(
            complete_task(&pool, user_id, task_id, START).await,
            Err(AppError::NotFound)
        ));

        let active = BatchFilter {
            status: Some(BatchStatus::Active),
            ..Default::default()
        };
        assert!(list(&pool, user_id, active).await.unwrap().is_empty());
        let discarded = BatchFilter {
            status: Some(BatchStatus::Discarded),
            ..Default::default()
        };
        assert_eq!(list(&pool, user_id, discarded).await.unwrap().len(), 1);
    }

    #[sqlx::test]
    async fn one_active_batch_per_container(pool: PgPool) {
        let grower = user(&pool, "grower").await;
        let neighbour = user(&pool, "neighbour").await;
        let jar_1 = jar(&pool, grower, "jar 1").await;

        let first = create(&pool, grower, alfalfa(jar_1)).await.unwrap();
        // Containers are shared, so the jar is busy for everyone.
        let second = create(&pool, neighbour, alfalfa(jar_1)).await;
        assert!(matches!(
            second,
            Err(AppError::Conflict("container_in_use"))
        ));

        // The jar can't be archived while something grows in it.
        let archive = ContainerChanges {
            archived: Some(true),
            ..Default::default()
        };
        assert!(matches!(
            containers::update(&pool, jar_1, archive, START).await,
            Err(AppError::Conflict("container_in_use"))
        ));

        // Discarding frees it.
        discard(&pool, grower, first, START).await.unwrap();
        create(&pool, neighbour, alfalfa(jar_1)).await.unwrap();
    }

    #[sqlx::test]
    async fn archived_containers_take_no_new_batches(pool: PgPool) {
        let user_id = user(&pool, "grower").await;
        let jar_1 = jar(&pool, user_id, "jar 1").await;
        let archive = ContainerChanges {
            archived: Some(true),
            ..Default::default()
        };
        containers::update(&pool, jar_1, archive, START)
            .await
            .unwrap();

        let result = create(&pool, user_id, alfalfa(jar_1)).await;
        assert!(
            matches!(result, Err(AppError::Invalid(problems)) if problems[0].message == "is archived")
        );
        let missing = create(&pool, user_id, alfalfa(Uuid::nil())).await;
        assert!(matches!(missing, Err(AppError::Invalid(_))));
    }

    #[sqlx::test]
    async fn container_history_and_occupants(pool: PgPool) {
        let grower = user(&pool, "grower").await;
        let neighbour = user(&pool, "neighbour").await;
        let jar_1 = jar(&pool, grower, "jar 1").await;
        let jar_2 = jar(&pool, grower, "jar 2").await;

        let old = create(&pool, grower, alfalfa(jar_1)).await.unwrap();
        discard(&pool, grower, old, START).await.unwrap();
        let current = create(&pool, grower, alfalfa(jar_1)).await.unwrap();
        create(&pool, neighbour, alfalfa(jar_2)).await.unwrap();

        let in_jar_1 = BatchFilter {
            container_id: Some(jar_1),
            ..Default::default()
        };
        let history = list(&pool, grower, in_jar_1).await.unwrap();
        assert_eq!(history.len(), 2);
        assert!(history.iter().all(|batch| batch.container == "jar 1"));

        let all = containers::list(&pool, grower).await.unwrap();
        let mine = all.iter().find(|container| container.id == jar_1).unwrap();
        assert_eq!(mine.batch_count, 2);
        assert_eq!(mine.occupant.as_ref().unwrap().batch_id, Some(current));

        // The neighbour's batch shows who grows it, but not its id.
        let theirs = all.iter().find(|container| container.id == jar_2).unwrap();
        let occupant = theirs.occupant.as_ref().unwrap();
        assert_eq!(occupant.grower, "neighbour");
        assert_eq!(occupant.batch_id, None);

        // Containers with history can't be deleted.
        assert!(matches!(
            containers::delete(&pool, jar_1).await,
            Err(AppError::Conflict("container_has_history"))
        ));
    }

    #[sqlx::test]
    async fn snoozing_moves_a_task_and_resets_its_reminder(pool: PgPool) {
        let user_id = user(&pool, "grower").await;
        let id = alfalfa_batch(&pool, user_id).await;
        let task = &tasks(&pool, user_id, id).await[0];
        sqlx::query!(
            "UPDATE tasks SET notified_at = $2 WHERE id = $1",
            task.id,
            START
        )
        .execute(&pool)
        .await
        .unwrap();

        let now = datetime!(2026-10-05 16:30 UTC);
        let until = datetime!(2026-10-05 18:00 UTC);
        snooze_task(&pool, user_id, task.id, until, now)
            .await
            .unwrap();

        let snoozed = &tasks(&pool, user_id, id).await[0];
        assert_eq!(snoozed.due_at, until);
        assert_eq!(snoozed.snoozed_until, Some(until));
        let notified = sqlx::query_scalar!("SELECT notified_at FROM tasks WHERE id = $1", task.id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(notified, None);

        let past = snooze_task(&pool, user_id, task.id, now, now).await;
        assert!(matches!(past, Err(AppError::Invalid(_))));
        let too_far =
            snooze_task(&pool, user_id, task.id, now + time::Duration::days(8), now).await;
        assert!(matches!(too_far, Err(AppError::Invalid(_))));
        let other = user(&pool, "neighbour").await;
        assert!(matches!(
            snooze_task(&pool, other, task.id, until, now).await,
            Err(AppError::NotFound)
        ));
    }
}
