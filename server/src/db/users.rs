use serde::Serialize;
use sqlx::PgPool;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::domain::quiet::QuietHours;

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct User {
    pub id: Uuid,
    pub display_name: String,
    pub email: Option<String>,
    /// An IANA timezone, like `Europe/Budapest`. Quiet hours and "today" follow it.
    pub timezone: String,
    /// When reminders wait, in local time. None means they can arrive any time.
    pub quiet_hours: Option<QuietHours>,
}

/// Who the OIDC provider says signed in.
#[derive(Debug)]
pub struct Identity<'a> {
    pub issuer: &'a str,
    pub subject: &'a str,
    pub display_name: &'a str,
    pub email: Option<&'a str>,
}

/// Creates the user on first login. On later logins, refreshes the name and email from the
/// provider. Returns the user's id.
pub async fn upsert_from_identity(pool: &PgPool, identity: &Identity<'_>) -> sqlx::Result<Uuid> {
    sqlx::query_scalar!(
        r#"
        INSERT INTO users (oidc_issuer, oidc_subject, display_name, email)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (oidc_issuer, oidc_subject) DO UPDATE
            SET display_name = EXCLUDED.display_name,
                email = EXCLUDED.email
        RETURNING id
        "#,
        identity.issuer,
        identity.subject,
        identity.display_name,
        identity.email,
    )
    .fetch_one(pool)
    .await
}

pub async fn find(pool: &PgPool, id: Uuid) -> sqlx::Result<Option<User>> {
    let row = sqlx::query!(
        "SELECT id, display_name, email, timezone, quiet_start, quiet_end FROM users WHERE id = $1",
        id,
    )
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|row| User {
        id: row.id,
        display_name: row.display_name,
        email: row.email,
        timezone: row.timezone,
        quiet_hours: row
            .quiet_start
            .zip(row.quiet_end)
            .map(|(start, end)| QuietHours { start, end }),
    }))
}

/// Changes the user's settings. `None` leaves a setting as it is. The caller checks that the
/// timezone exists.
pub async fn update_settings(
    pool: &PgPool,
    id: Uuid,
    timezone: Option<&str>,
    quiet_hours: Option<Option<QuietHours>>,
) -> sqlx::Result<()> {
    let clear_quiet_hours = matches!(quiet_hours, Some(None));
    let quiet_hours = quiet_hours.flatten();
    sqlx::query!(
        r#"
        UPDATE users SET
            timezone = coalesce($2, timezone),
            quiet_start = CASE WHEN $3 THEN NULL ELSE coalesce($4, quiet_start) END,
            quiet_end = CASE WHEN $3 THEN NULL ELSE coalesce($5, quiet_end) END
        WHERE id = $1
        "#,
        id,
        timezone,
        clear_quiet_hours,
        quiet_hours.map(|hours| hours.start),
        quiet_hours.map(|hours| hours.end),
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity<'a>(subject: &'a str, email: Option<&'a str>) -> Identity<'a> {
        Identity {
            issuer: "http://localhost:5556/dex",
            subject,
            display_name: "Grower",
            email,
        }
    }

    #[sqlx::test]
    async fn second_login_updates_the_same_user(pool: PgPool) -> sqlx::Result<()> {
        let first = upsert_from_identity(&pool, &identity("abc", Some("old@example.com"))).await?;
        let second = upsert_from_identity(&pool, &identity("abc", Some("new@example.com"))).await?;
        assert_eq!(first, second);

        let user = find(&pool, first).await?.expect("user exists");
        assert_eq!(user.email.as_deref(), Some("new@example.com"));
        Ok(())
    }

    #[sqlx::test]
    async fn different_subjects_get_different_users(pool: PgPool) -> sqlx::Result<()> {
        let first = upsert_from_identity(&pool, &identity("abc", None)).await?;
        let second = upsert_from_identity(&pool, &identity("xyz", None)).await?;
        assert_ne!(first, second);
        Ok(())
    }

    #[sqlx::test]
    async fn settings_change_and_clear(pool: PgPool) -> sqlx::Result<()> {
        use time::macros::time;

        let id = upsert_from_identity(&pool, &identity("abc", None)).await?;
        let night = QuietHours {
            start: time!(22:00),
            end: time!(07:00),
        };
        update_settings(&pool, id, Some("Europe/Budapest"), Some(Some(night))).await?;
        let user = find(&pool, id).await?.unwrap();
        assert_eq!(user.timezone, "Europe/Budapest");
        assert_eq!(user.quiet_hours, Some(night));

        // Leaving both out keeps them.
        update_settings(&pool, id, None, None).await?;
        assert_eq!(find(&pool, id).await?.unwrap().quiet_hours, Some(night));

        update_settings(&pool, id, None, Some(None)).await?;
        let user = find(&pool, id).await?.unwrap();
        assert_eq!(user.quiet_hours, None);
        assert_eq!(user.timezone, "Europe/Budapest");
        Ok(())
    }
}
