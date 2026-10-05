//! The plant definition format. Built-in plants and custom plants use the same JSON shape:
//!
//! ```json
//! {
//!   "name": "Mung Beans",
//!   "name_lat": "Vigna radiata",
//!   "kind": "sprout",
//!   "seed_g": 60,
//!   "steps": [
//!     { "action": "soak", "duration_min": "8h", "duration_max": "12h" },
//!     {
//!       "action": "sprout",
//!       "duration_min": "2d",
//!       "duration_max": "5d",
//!       "care": [{ "action": "rinse", "every": "12h" }]
//!     },
//!     { "action": "harvest" }
//!   ]
//! }
//! ```

use std::{collections::HashSet, fmt, str::FromStr};

use serde::{Deserialize, Serialize};

use super::span::Span;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Plant {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name_lat: Option<String>,
    pub kind: PlantKind,
    /// Suggested seed weight for one jar or tray, in grams.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seed_g: Option<u32>,
    pub steps: Vec<Step>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlantKind {
    Sprout,
    Microgreen,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Step {
    pub action: StepAction,
    /// When the step can end at the earliest. Required for every step except harvest.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_min: Option<Span>,
    /// When the step is overdue. Leave it out for a step with a fixed length.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_max: Option<Span>,
    /// Chores that repeat while the batch is in this step.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub care: Vec<Care>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StepAction {
    Soak,
    Sprout,
    Blackout,
    Light,
    Harvest,
}

impl StepAction {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Soak => "soak",
            Self::Sprout => "sprout",
            Self::Blackout => "blackout",
            Self::Light => "light",
            Self::Harvest => "harvest",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Care {
    pub action: CareAction,
    pub every: Span,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CareAction {
    Rinse,
    Water,
    Mist,
}

impl CareAction {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Rinse => "rinse",
            Self::Water => "water",
            Self::Mist => "mist",
        }
    }
}

/// One thing wrong with a plant definition. `path` points at the field, like `steps[1].care[0]`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("{path}: {message}")]
pub struct Problem {
    pub path: String,
    pub message: String,
}

#[derive(Debug, thiserror::Error)]
pub enum PlantError {
    #[error("invalid plant JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid plant: {}", join_problems(.0))]
    Invalid(Vec<Problem>),
}

fn join_problems(problems: &[Problem]) -> String {
    problems
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join("; ")
}

impl Plant {
    /// Parses and validates a definition.
    pub fn from_json(json: &str) -> Result<Self, PlantError> {
        let plant: Self = serde_json::from_str(json)?;
        plant.validate().map_err(PlantError::Invalid)?;
        Ok(plant)
    }

    /// Checks the rules that the JSON shape alone can't express. Reports every problem, not just
    /// the first.
    pub fn validate(&self) -> Result<(), Vec<Problem>> {
        let mut problems = Vec::new();
        let mut report = |path: String, message: &str| {
            problems.push(Problem {
                path,
                message: message.to_owned(),
            });
        };

        if self.name.trim().is_empty() {
            report("name".into(), "must not be empty");
        }
        if self
            .name_lat
            .as_deref()
            .is_some_and(|name| name.trim().is_empty())
        {
            report("name_lat".into(), "must not be empty when present");
        }
        if self.seed_g == Some(0) {
            report("seed_g".into(), "must be more than zero");
        }

        let Some((last, growing)) = self.steps.split_last() else {
            report(
                "steps".into(),
                "needs at least one growing step and a final harvest step",
            );
            return Err(problems);
        };

        if growing.is_empty() {
            report("steps".into(), "needs at least one step before harvest");
        }

        for (index, step) in growing.iter().enumerate() {
            let path = format!("steps[{index}]");

            if step.action == StepAction::Harvest {
                report(
                    format!("{path}.action"),
                    "harvest can only be the last step",
                );
            }

            match (step.duration_min, step.duration_max) {
                (None, _) => report(format!("{path}.duration_min"), "is required"),
                (Some(min), Some(max)) if max < min => report(
                    format!("{path}.duration_max"),
                    "must not be shorter than duration_min",
                ),
                _ => {}
            }

            let mut seen = HashSet::new();
            for (care_index, care) in step.care.iter().enumerate() {
                if !seen.insert(care.action) {
                    report(
                        format!("{path}.care[{care_index}].action"),
                        "appears more than once in this step",
                    );
                }
            }
        }

        let last_path = format!("steps[{}]", self.steps.len() - 1);
        if last.action != StepAction::Harvest {
            report(
                format!("{last_path}.action"),
                "the last step must be harvest",
            );
        }
        if last.action == StepAction::Harvest
            && (last.duration_min.is_some() || last.duration_max.is_some() || !last.care.is_empty())
        {
            report(last_path, "the harvest step can't have durations or care");
        }

        if problems.is_empty() {
            Ok(())
        } else {
            Err(problems)
        }
    }
}

/// A plant's id, like `mung-bean`. Lowercase letters, digits, and single hyphens, at most 64
/// characters.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct Slug(String);

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error(
    "a slug must be 1 to 64 lowercase letters, digits, and single hyphens, without a hyphen at either end"
)]
pub struct SlugError;

impl Slug {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for Slug {
    type Error = SlugError;

    fn try_from(text: String) -> Result<Self, SlugError> {
        let valid = (1..=64).contains(&text.len())
            && text
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
            && !text.starts_with('-')
            && !text.ends_with('-')
            && !text.contains("--");

        if valid {
            Ok(Self(text))
        } else {
            Err(SlugError)
        }
    }
}

impl FromStr for Slug {
    type Err = SlugError;

    fn from_str(text: &str) -> Result<Self, SlugError> {
        text.to_owned().try_into()
    }
}

impl From<Slug> for String {
    fn from(slug: Slug) -> Self {
        slug.0
    }
}

impl fmt::Display for Slug {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MUNG_BEAN: &str = r#"{
        "name": "Mung Beans",
        "name_lat": "Vigna radiata",
        "kind": "sprout",
        "seed_g": 60,
        "steps": [
            { "action": "soak", "duration_min": "8h", "duration_max": "12h" },
            {
                "action": "sprout",
                "duration_min": "2d",
                "duration_max": "5d",
                "care": [{ "action": "rinse", "every": "12h" }]
            },
            { "action": "harvest" }
        ]
    }"#;

    fn problems(json: &str) -> Vec<String> {
        match Plant::from_json(json) {
            Err(PlantError::Invalid(problems)) => problems.iter().map(|p| p.to_string()).collect(),
            other => panic!("expected validation problems, got {other:?}"),
        }
    }

    #[test]
    fn parses_a_valid_plant() {
        let plant = Plant::from_json(MUNG_BEAN).unwrap();
        assert_eq!(plant.kind, PlantKind::Sprout);
        assert_eq!(plant.steps.len(), 3);
        assert_eq!(plant.steps[1].care[0].every, Span::hours(12));
    }

    #[test]
    fn rejects_unknown_fields() {
        let json = MUNG_BEAN.replace("duration_min\": \"8h\"", "duraton_min\": \"8h\"");
        let error = Plant::from_json(&json).unwrap_err();
        assert!(
            error.to_string().contains("unknown field `duraton_min`"),
            "{error}"
        );
    }

    #[test]
    fn rejects_unknown_actions() {
        let json = MUNG_BEAN.replace("\"rinse\"", "\"sing\"");
        assert!(matches!(Plant::from_json(&json), Err(PlantError::Json(_))));
    }

    #[test]
    fn reports_every_problem() {
        let json = r#"{
            "name": " ",
            "kind": "microgreen",
            "seed_g": 0,
            "steps": [
                { "action": "harvest" },
                { "action": "blackout", "duration_min": "4d", "duration_max": "3d" },
                {
                    "action": "light",
                    "care": [{ "action": "water", "every": "1d" }, { "action": "water", "every": "12h" }]
                }
            ]
        }"#;

        assert_eq!(
            problems(json),
            [
                "name: must not be empty",
                "seed_g: must be more than zero",
                "steps[0].action: harvest can only be the last step",
                "steps[0].duration_min: is required",
                "steps[1].duration_max: must not be shorter than duration_min",
                "steps[2].action: the last step must be harvest",
            ]
        );
    }

    #[test]
    fn checks_care_and_the_harvest_step() {
        let json = r#"{
            "name": "Pea shoots",
            "kind": "microgreen",
            "steps": [
                {
                    "action": "light",
                    "duration_min": "6d",
                    "care": [{ "action": "water", "every": "1d" }, { "action": "water", "every": "12h" }]
                },
                { "action": "harvest", "duration_min": "1d" }
            ]
        }"#;

        assert_eq!(
            problems(json),
            [
                "steps[0].care[1].action: appears more than once in this step",
                "steps[1]: the harvest step can't have durations or care",
            ]
        );
    }

    #[test]
    fn needs_steps() {
        let json = r#"{ "name": "Nothing", "kind": "sprout", "steps": [] }"#;
        assert_eq!(
            problems(json),
            ["steps: needs at least one growing step and a final harvest step"]
        );

        let json = r#"{ "name": "Instant", "kind": "sprout", "steps": [{ "action": "harvest" }] }"#;
        assert_eq!(
            problems(json),
            ["steps: needs at least one step before harvest"]
        );
    }

    #[test]
    fn round_trips_through_json() {
        let plant = Plant::from_json(MUNG_BEAN).unwrap();
        let json = serde_json::to_string(&plant).unwrap();
        assert_eq!(Plant::from_json(&json).unwrap(), plant);
    }

    #[test]
    fn slugs() {
        for valid in ["mung-bean", "pea-shoots-2", "a", &"x".repeat(64)] {
            assert!(valid.parse::<Slug>().is_ok(), "{valid:?}");
        }
        for invalid in [
            "",
            "Mung",
            "mung bean",
            "-mung",
            "mung-",
            "mung--bean",
            "müng",
            &"x".repeat(65),
        ] {
            assert_eq!(invalid.parse::<Slug>(), Err(SlugError), "{invalid:?}");
        }
    }
}
