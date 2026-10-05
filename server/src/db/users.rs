use serde::Serialize;
use sqlx::PgPool;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct User {
    pub id: Uuid,
    pub display_name: String,
    pub email: Option<String>,
    pub timezone: String,
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
    sqlx::query_as!(
        User,
        "SELECT id, display_name, email, timezone FROM users WHERE id = $1",
        id,
    )
    .fetch_optional(pool)
    .await
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
}
