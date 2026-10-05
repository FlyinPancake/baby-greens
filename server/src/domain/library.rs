//! The plant library: built-in plants compiled into the binary, plus custom plants from the
//! database. A custom plant with a built-in slug overrides the built-in one.

use std::{
    collections::{BTreeMap, btree_map::Entry as MapEntry},
    sync::LazyLock,
};

use serde::Serialize;

use super::plant::{Plant, Slug};

const BUILTIN_JSON: &str = include_str!("../../plants/builtin.json");

static BUILTIN: LazyLock<BTreeMap<Slug, Plant>> = LazyLock::new(|| {
    parse_library(BUILTIN_JSON).unwrap_or_else(|error| panic!("plants/builtin.json: {error}"))
});

/// The built-in plants, keyed by slug. A test checks that the file parses.
pub fn builtin() -> &'static BTreeMap<Slug, Plant> {
    &BUILTIN
}

fn parse_library(json: &str) -> Result<BTreeMap<Slug, Plant>, String> {
    let plants: BTreeMap<Slug, Plant> =
        serde_json::from_str(json).map_err(|error| error.to_string())?;

    for (slug, plant) in &plants {
        plant.validate().map_err(|problems| {
            let problems: Vec<_> = problems.iter().map(ToString::to_string).collect();
            format!("{slug}: {}", problems.join("; "))
        })?;
    }

    Ok(plants)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    Builtin,
    Custom,
    /// A custom plant that replaces a built-in one. Deleting it brings the built-in one back.
    Override,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LibraryEntry {
    pub slug: Slug,
    pub source: Source,
    pub plant: Plant,
}

/// Combines built-in and custom plants, sorted by slug.
pub fn merge(
    builtin: &BTreeMap<Slug, Plant>,
    custom: impl IntoIterator<Item = (Slug, Plant)>,
) -> Vec<LibraryEntry> {
    let mut entries: BTreeMap<Slug, (Source, Plant)> = builtin
        .iter()
        .map(|(slug, plant)| (slug.clone(), (Source::Builtin, plant.clone())))
        .collect();

    for (slug, plant) in custom {
        match entries.entry(slug) {
            MapEntry::Occupied(mut entry) => *entry.get_mut() = (Source::Override, plant),
            MapEntry::Vacant(entry) => {
                entry.insert((Source::Custom, plant));
            }
        }
    }

    entries
        .into_iter()
        .map(|(slug, (source, plant))| LibraryEntry {
            slug,
            source,
            plant,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::plant::PlantKind;

    #[test]
    fn builtin_library_is_valid() {
        let library = parse_library(BUILTIN_JSON).unwrap();
        assert!(
            library.len() >= 15,
            "only {} built-in plants",
            library.len()
        );
        assert!(
            library
                .values()
                .any(|plant| plant.kind == PlantKind::Sprout)
        );
        assert!(
            library
                .values()
                .any(|plant| plant.kind == PlantKind::Microgreen)
        );
    }

    #[test]
    fn library_errors_name_the_plant() {
        let json = r#"{ "broken": { "name": "Broken", "kind": "sprout", "steps": [] } }"#;
        let error = parse_library(json).unwrap_err();
        assert!(error.starts_with("broken: steps:"), "{error}");
    }

    #[test]
    fn custom_plants_add_to_and_override_builtin_ones() {
        let builtin = builtin();
        let mung: Slug = "mung-bean".parse().unwrap();
        let mine: Slug = "my-mix".parse().unwrap();

        let mut faster_mung = builtin[&mung].clone();
        faster_mung.name = "Quick mung".into();
        let my_mix = Plant {
            name: "My mix".into(),
            ..builtin[&mung].clone()
        };

        let entries = merge(
            builtin,
            [(mung.clone(), faster_mung), (mine.clone(), my_mix)],
        );
        let find = |slug: &Slug| entries.iter().find(|entry| &entry.slug == slug).unwrap();

        assert_eq!(entries.len(), builtin.len() + 1);
        assert_eq!(find(&mung).source, Source::Override);
        assert_eq!(find(&mung).plant.name, "Quick mung");
        assert_eq!(find(&mine).source, Source::Custom);
        assert_eq!(find(&"alfalfa".parse().unwrap()).source, Source::Builtin);
    }
}
