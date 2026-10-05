//! Browsers' push subscriptions. A subscription belongs to whoever saved it last, so a shared
//! device follows whoever signed in on it.

use sqlx::PgPool;
use uuid::Uuid;

use crate::notify::Subscription;

pub struct NewSubscription<'a> {
    pub endpoint: &'a str,
    pub p256dh: &'a str,
    pub auth: &'a str,
    pub user_agent: Option<&'a str>,
}

pub async fn save(
    pool: &PgPool,
    user_id: Uuid,
    subscription: &NewSubscription<'_>,
) -> sqlx::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (endpoint) DO UPDATE
            SET user_id = EXCLUDED.user_id,
                p256dh = EXCLUDED.p256dh,
                auth = EXCLUDED.auth,
                user_agent = EXCLUDED.user_agent
        "#,
        user_id,
        subscription.endpoint,
        subscription.p256dh,
        subscription.auth,
        subscription.user_agent,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Removes one of the user's subscriptions. Returns whether it existed.
pub async fn remove(pool: &PgPool, user_id: Uuid, endpoint: &str) -> sqlx::Result<bool> {
    let result = sqlx::query!(
        "DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2",
        user_id,
        endpoint,
    )
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Removes a subscription the push service no longer knows.
pub async fn remove_by_id(pool: &PgPool, id: Uuid) -> sqlx::Result<()> {
    sqlx::query!("DELETE FROM push_subscriptions WHERE id = $1", id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn for_user(pool: &PgPool, user_id: Uuid) -> sqlx::Result<Vec<Subscription>> {
    sqlx::query_as!(
        Subscription,
        "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1",
        user_id,
    )
    .fetch_all(pool)
    .await
}
