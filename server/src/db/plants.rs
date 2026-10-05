use anyhow::{Context, Result};
use sqlx::{PgPool, types::Json};
use uuid::Uuid;

use crate::domain::{
    library::{self, LibraryEntry, Source},
    plant::{Plant, Slug},
};

/// Every plant in the library, with custom plants applied over the built-in ones.
pub async fn list(pool: &PgPool) -> Result<Vec<LibraryEntry>> {
    let rows =
        sqlx::query!(r#"SELECT slug, definition AS "definition: Json<Plant>" FROM custom_plants"#)
            .fetch_all(pool)
            .await?;

    let custom = rows
        .into_iter()
        .map(|row| {
            let slug = row
                .slug
                .parse()
                .with_context(|| format!("custom plant has an invalid slug {:?}", row.slug))?;
            Ok((slug, row.definition.0))
        })
        .collect::<Result<Vec<_>>>()?;

    Ok(library::merge(library::builtin(), custom))
}

/// One plant by slug, checking custom plants before built-in ones.
pub async fn find(pool: &PgPool, slug: &Slug) -> Result<Option<LibraryEntry>> {
    let custom = sqlx::query_scalar!(
        r#"SELECT definition AS "definition: Json<Plant>" FROM custom_plants WHERE slug = $1"#,
        slug.as_str(),
    )
    .fetch_optional(pool)
    .await?;

    let builtin = library::builtin().get(slug);

    let entry = match (custom, builtin) {
        (Some(Json(plant)), Some(_)) => Some((Source::Override, plant)),
        (Some(Json(plant)), None) => Some((Source::Custom, plant)),
        (None, Some(plant)) => Some((Source::Builtin, plant.clone())),
        (None, None) => None,
    };

    Ok(entry.map(|(source, plant)| LibraryEntry {
        slug: slug.clone(),
        source,
        plant,
    }))
}

/// Creates or replaces a custom plant. The caller must validate `plant` first.
pub async fn save_custom(
    pool: &PgPool,
    slug: &Slug,
    plant: &Plant,
    user_id: Uuid,
) -> sqlx::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO custom_plants (slug, definition, created_by)
        VALUES ($1, $2, $3)
        ON CONFLICT (slug) DO UPDATE
            SET definition = EXCLUDED.definition,
                updated_at = now()
        "#,
        slug.as_str(),
        Json(plant) as _,
        user_id,
    )
    .execute(pool)
    .await?;

    Ok(())
}

/// Deletes a custom plant. For an override, the built-in plant comes back. Returns whether a
/// row was deleted.
pub async fn delete_custom(pool: &PgPool, slug: &Slug) -> sqlx::Result<bool> {
    let result = sqlx::query!("DELETE FROM custom_plants WHERE slug = $1", slug.as_str())
        .execute(pool)
        .await?;

    Ok(result.rows_affected() > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::users::{self, Identity};

    async fn user(pool: &PgPool) -> Uuid {
        let identity = Identity {
            issuer: "http://localhost:5556/dex",
            subject: "grower",
            display_name: "Grower",
            email: None,
        };
        users::upsert_from_identity(pool, &identity).await.unwrap()
    }

    fn slug(text: &str) -> Slug {
        text.parse().unwrap()
    }

    #[sqlx::test]
    async fn override_and_restore_a_builtin_plant(pool: PgPool) -> Result<()> {
        let user_id = user(&pool).await;
        let mung = slug("mung-bean");

        let mut quick = library::builtin()[&mung].clone();
        quick.name = "Quick mung".into();
        save_custom(&pool, &mung, &quick, user_id).await?;

        let entry = find(&pool, &mung).await?.unwrap();
        assert_eq!(entry.source, Source::Override);
        assert_eq!(entry.plant.name, "Quick mung");

        assert!(delete_custom(&pool, &mung).await?);
        let entry = find(&pool, &mung).await?.unwrap();
        assert_eq!(entry.source, Source::Builtin);
        assert!(!delete_custom(&pool, &mung).await?);
        Ok(())
    }

    #[sqlx::test]
    async fn custom_plants_join_the_library(pool: PgPool) -> Result<()> {
        let user_id = user(&pool).await;
        let mix = slug("my-salad-mix");
        let plant = Plant {
            name: "My salad mix".into(),
            ..library::builtin()[&slug("arugula")].clone()
        };

        save_custom(&pool, &mix, &plant, user_id).await?;
        // Saving again replaces the definition instead of failing.
        save_custom(&pool, &mix, &plant, user_id).await?;

        let entries = list(&pool).await?;
        assert_eq!(entries.len(), library::builtin().len() + 1);
        let entry = entries.iter().find(|entry| entry.slug == mix).unwrap();
        assert_eq!(entry.source, Source::Custom);
        assert_eq!(entry.plant, plant);

        assert_eq!(find(&pool, &slug("no-such-plant")).await?, None);
        Ok(())
    }
}
