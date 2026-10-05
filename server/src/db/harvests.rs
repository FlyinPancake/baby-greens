//! Harvests: what a batch yielded. A batch can have several, like pea shoots cut twice.

use serde::Serialize;
use sqlx::PgPool;
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::batches::BatchStatus;
use crate::error::AppError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct Harvest {
    pub id: Uuid,
    pub batch_id: Uuid,
    #[serde(with = "time::serde::rfc3339")]
    pub harvested_at: OffsetDateTime,
    pub yield_g: i32,
    /// 1 to 5.
    pub rating: Option<i16>,
    pub notes: String,
}

pub struct NewHarvest {
    pub harvested_at: OffsetDateTime,
    pub yield_g: i32,
    pub rating: Option<i16>,
    pub notes: String,
}

/// Logs a harvest for one of the user's harvested batches.
pub async fn create(
    pool: &PgPool,
    user_id: Uuid,
    batch_id: Uuid,
    harvest: NewHarvest,
    now: OffsetDateTime,
) -> Result<Harvest, AppError> {
    if !(0..=100_000).contains(&harvest.yield_g) {
        return Err(AppError::invalid(
            "yield_g",
            "must be between 0 and 100000 grams",
        ));
    }
    if harvest
        .rating
        .is_some_and(|rating| !(1..=5).contains(&rating))
    {
        return Err(AppError::invalid("rating", "must be 1 to 5"));
    }
    if harvest.harvested_at > now + time::Duration::minutes(5) {
        return Err(AppError::invalid("harvested_at", "can't be in the future"));
    }

    let mut tx = pool.begin().await?;
    let batch = sqlx::query!(
        r#"
        SELECT status AS "status: BatchStatus", started_at
        FROM batches WHERE id = $1 AND user_id = $2
        FOR SHARE
        "#,
        batch_id,
        user_id,
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(AppError::NotFound)?;

    if batch.status != BatchStatus::Harvested {
        return Err(AppError::Conflict("batch_not_harvested"));
    }
    if harvest.harvested_at < batch.started_at {
        return Err(AppError::invalid(
            "harvested_at",
            "can't be before the batch started",
        ));
    }

    let harvest = sqlx::query_as!(
        Harvest,
        r#"
        INSERT INTO harvests (batch_id, harvested_at, yield_g, rating, notes)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, batch_id, harvested_at, yield_g, rating, notes
        "#,
        batch_id,
        harvest.harvested_at,
        harvest.yield_g,
        harvest.rating,
        harvest.notes.trim(),
    )
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(harvest)
}

pub async fn for_batch(pool: &PgPool, batch_id: Uuid) -> sqlx::Result<Vec<Harvest>> {
    sqlx::query_as!(
        Harvest,
        r#"
        SELECT id, batch_id, harvested_at, yield_g, rating, notes
        FROM harvests WHERE batch_id = $1
        ORDER BY harvested_at, id
        "#,
        batch_id,
    )
    .fetch_all(pool)
    .await
}

/// Deletes one of the user's harvests, for example one logged by mistake.
pub async fn delete(pool: &PgPool, user_id: Uuid, id: Uuid) -> Result<(), AppError> {
    let result = sqlx::query!(
        r#"
        DELETE FROM harvests h
        USING batches b
        WHERE h.id = $1 AND b.id = h.batch_id AND b.user_id = $2
        "#,
        id,
        user_id,
    )
    .execute(pool)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// How one plant has done for a user, over harvested batches with at least one harvest logged.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct PlantStats {
    pub plant_slug: String,
    pub plant_name: String,
    pub batches: i64,
    pub seed_g: i64,
    pub yield_g: i64,
    /// Grams harvested per gram of seed.
    pub yield_ratio: f64,
    /// Over harvests that have a rating.
    pub average_rating: Option<f64>,
    /// From the batch's start to its first harvest.
    pub average_days: f64,
}

pub async fn plant_stats(pool: &PgPool, user_id: Uuid) -> sqlx::Result<Vec<PlantStats>> {
    sqlx::query_as!(
        PlantStats,
        r#"
        WITH per_batch AS (
            SELECT b.plant_slug, b.plant ->> 'name' AS plant_name, b.seed_g, b.started_at,
                   sum(h.yield_g) AS yield_g, avg(h.rating) AS rating, min(h.harvested_at) AS first_cut
            FROM batches b
            JOIN harvests h ON h.batch_id = b.id
            WHERE b.user_id = $1 AND b.status = 'harvested'
            GROUP BY b.id
        )
        SELECT plant_slug,
               -- The newest batch's name, in case the plant was renamed.
               (array_agg(plant_name ORDER BY started_at DESC))[1] AS "plant_name!",
               count(*) AS "batches!",
               sum(seed_g)::bigint AS "seed_g!",
               sum(yield_g)::bigint AS "yield_g!",
               (sum(yield_g)::float8 / sum(seed_g)) AS "yield_ratio!",
               avg(rating)::float8 AS average_rating,
               avg(extract(epoch FROM first_cut - started_at) / 86400)::float8 AS "average_days!"
        FROM per_batch
        GROUP BY plant_slug
        ORDER BY plant_slug
        "#,
        user_id,
    )
    .fetch_all(pool)
    .await
}

#[cfg(test)]
mod tests {
    use time::macros::datetime;

    use super::*;
    use crate::{
        db::{
            batches::{self, NewBatch},
            containers::{self, ContainerKind},
            users::{self, Identity},
        },
        domain::{library, plant::Slug},
    };

    const START: OffsetDateTime = datetime!(2026-10-01 08:00 UTC);
    const NOW: OffsetDateTime = datetime!(2026-10-08 12:00 UTC);

    async fn user(pool: &PgPool, subject: &str) -> Uuid {
        let identity = Identity {
            issuer: "http://localhost:5556/dex",
            subject,
            display_name: subject,
            email: None,
        };
        users::upsert_from_identity(pool, &identity).await.unwrap()
    }

    /// Starts a batch of `slug` with `seed_g` grams, and returns it. Active, not harvested.
    async fn batch(pool: &PgPool, user_id: Uuid, jar: &str, slug: &str, seed_g: u32) -> Uuid {
        let container_id = containers::create(pool, user_id, jar, ContainerKind::Jar, None, "")
            .await
            .unwrap();
        let slug: Slug = slug.parse().unwrap();
        let new = NewBatch {
            plant: library::builtin()[&slug].clone(),
            plant_slug: slug,
            container_id,
            seed_g,
            started_at: START,
            notes: String::new(),
        };
        batches::create(pool, user_id, new).await.unwrap()
    }

    /// Completes tasks until the batch reaches harvest.
    async fn harvest_batch(pool: &PgPool, user_id: Uuid, id: Uuid) {
        let mut at = START;
        loop {
            let tasks = batches::open_tasks(pool, user_id, None, Some(id))
                .await
                .unwrap();
            let Some(advance) = tasks.iter().find(|task| {
                matches!(task.action, crate::domain::schedule::TaskAction::Advance(_))
            }) else {
                break;
            };
            at = at.max(advance.due_at);
            batches::complete_task(pool, user_id, advance.id, at)
                .await
                .unwrap();
        }
    }

    fn cut(yield_g: i32, rating: Option<i16>, harvested_at: OffsetDateTime) -> NewHarvest {
        NewHarvest {
            harvested_at,
            yield_g,
            rating,
            notes: " crunchy ".into(),
        }
    }

    #[sqlx::test]
    async fn harvests_need_a_harvested_batch(pool: PgPool) {
        let user_id = user(&pool, "grower").await;
        let id = batch(&pool, user_id, "jar 1", "alfalfa", 15).await;

        let early = create(&pool, user_id, id, cut(100, Some(4), NOW), NOW).await;
        assert!(matches!(
            early,
            Err(AppError::Conflict("batch_not_harvested"))
        ));

        harvest_batch(&pool, user_id, id).await;
        let logged = create(&pool, user_id, id, cut(120, Some(4), NOW), NOW)
            .await
            .unwrap();
        assert_eq!(logged.yield_g, 120);
        assert_eq!(logged.notes, "crunchy");

        // A second cut is fine.
        create(&pool, user_id, id, cut(40, None, NOW), NOW)
            .await
            .unwrap();
        assert_eq!(for_batch(&pool, id).await.unwrap().len(), 2);
    }

    #[sqlx::test]
    async fn harvest_values_are_checked(pool: PgPool) {
        let user_id = user(&pool, "grower").await;
        let id = batch(&pool, user_id, "jar 1", "alfalfa", 15).await;
        harvest_batch(&pool, user_id, id).await;

        for bad in [
            cut(-1, None, NOW),
            cut(100_001, None, NOW),
            cut(10, Some(0), NOW),
            cut(10, Some(6), NOW),
            cut(10, None, NOW + time::Duration::hours(1)),
            cut(10, None, START - time::Duration::hours(1)),
        ] {
            assert!(matches!(
                create(&pool, user_id, id, bad, NOW).await,
                Err(AppError::Invalid(_))
            ));
        }
    }

    #[sqlx::test]
    async fn only_the_owner_logs_and_deletes(pool: PgPool) {
        let owner = user(&pool, "grower").await;
        let other = user(&pool, "neighbour").await;
        let id = batch(&pool, owner, "jar 1", "alfalfa", 15).await;
        harvest_batch(&pool, owner, id).await;

        assert!(matches!(
            create(&pool, other, id, cut(10, None, NOW), NOW).await,
            Err(AppError::NotFound)
        ));
        let logged = create(&pool, owner, id, cut(10, None, NOW), NOW)
            .await
            .unwrap();
        assert!(matches!(
            delete(&pool, other, logged.id).await,
            Err(AppError::NotFound)
        ));
        delete(&pool, owner, logged.id).await.unwrap();
        assert!(for_batch(&pool, id).await.unwrap().is_empty());
    }

    #[sqlx::test]
    async fn stats_add_up_per_plant(pool: PgPool) {
        let user_id = user(&pool, "grower").await;
        let first = batch(&pool, user_id, "jar 1", "alfalfa", 10).await;
        let second = batch(&pool, user_id, "jar 2", "alfalfa", 20).await;
        let unlogged = batch(&pool, user_id, "jar 3", "alfalfa", 50).await;
        for id in [first, second, unlogged] {
            harvest_batch(&pool, user_id, id).await;
        }
        // 4 days after the start, then 6 days after.
        let day = |days: i64| START + time::Duration::days(days);
        create(&pool, user_id, first, cut(80, Some(4), day(4)), NOW)
            .await
            .unwrap();
        create(&pool, user_id, first, cut(20, Some(2), day(5)), NOW)
            .await
            .unwrap();
        create(&pool, user_id, second, cut(200, None, day(6)), NOW)
            .await
            .unwrap();

        let stats = plant_stats(&pool, user_id).await.unwrap();
        assert_eq!(stats.len(), 1);
        let alfalfa = &stats[0];
        assert_eq!(alfalfa.plant_slug, "alfalfa");
        // The batch without a logged harvest doesn't count.
        assert_eq!(alfalfa.batches, 2);
        assert_eq!(alfalfa.seed_g, 30);
        assert_eq!(alfalfa.yield_g, 300);
        assert!((alfalfa.yield_ratio - 10.0).abs() < 1e-9);
        // The first batch averages 3 over its two cuts. The second has no rating.
        assert_eq!(alfalfa.average_rating, Some(3.0));
        assert!((alfalfa.average_days - 5.0).abs() < 1e-9);

        let other = user(&pool, "neighbour").await;
        assert!(plant_stats(&pool, other).await.unwrap().is_empty());
    }
}
