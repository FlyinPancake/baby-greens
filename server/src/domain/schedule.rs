//! Turns a plant definition into tasks.
//!
//! A batch moves through its plant's steps one at a time, and the user advances it by hand. When
//! the batch enters a step, it gets an advance task that's due at `duration_min` and overdue at
//! `duration_max`, plus the first of each care chore. Each finished chore schedules the next one,
//! counted from when it was actually done. Advancing into the final harvest step ends the batch.

use serde::Serialize;
use time::OffsetDateTime;
use utoipa::ToSchema;

use super::plant::{CareAction, Plant, StepAction};

/// Serializes as `{ "kind": "advance", "action": "light" }` or `{ "kind": "care", "action": "rinse" }`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(tag = "kind", content = "action", rename_all = "snake_case")]
pub enum TaskAction {
    /// Move the batch into the next step, whose action this is.
    Advance(StepAction),
    Care(CareAction),
}

impl TaskAction {
    pub fn kind(self) -> &'static str {
        match self {
            Self::Advance(_) => "advance",
            Self::Care(_) => "care",
        }
    }

    pub fn action(self) -> &'static str {
        match self {
            Self::Advance(action) => action.as_str(),
            Self::Care(action) => action.as_str(),
        }
    }

    /// The inverse of [`kind`](Self::kind) and [`action`](Self::action).
    pub fn from_parts(kind: &str, action: &str) -> Option<Self> {
        match kind {
            "advance" => StepAction::parse(action).map(Self::Advance),
            "care" => CareAction::parse(action).map(Self::Care),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedTask {
    /// The step the batch is in while this task is open.
    pub step_index: usize,
    pub action: TaskAction,
    pub due_at: OffsetDateTime,
    pub overdue_at: Option<OffsetDateTime>,
}

/// The tasks to create when a batch enters `step_index` at `entered_at`. Returns nothing for the
/// harvest step, or for an index past the end.
pub fn tasks_on_entering(
    plant: &Plant,
    step_index: usize,
    entered_at: OffsetDateTime,
) -> Vec<PlannedTask> {
    let (Some(step), Some(next)) = (plant.steps.get(step_index), plant.steps.get(step_index + 1))
    else {
        return Vec::new();
    };

    let mut tasks = Vec::with_capacity(1 + step.care.len());

    if let Some(min) = step.duration_min {
        tasks.push(PlannedTask {
            step_index,
            action: TaskAction::Advance(next.action),
            due_at: entered_at + min.as_duration(),
            overdue_at: step.duration_max.map(|max| entered_at + max.as_duration()),
        });
    }

    tasks.extend(step.care.iter().map(|care| PlannedTask {
        step_index,
        action: TaskAction::Care(care.action),
        due_at: entered_at + care.every.as_duration(),
        overdue_at: None,
    }));

    tasks
}

/// The chore that follows one done at `done_at`. Returns `None` if the step has no such chore.
pub fn next_care(
    plant: &Plant,
    step_index: usize,
    action: CareAction,
    done_at: OffsetDateTime,
) -> Option<PlannedTask> {
    let care = plant
        .steps
        .get(step_index)?
        .care
        .iter()
        .find(|care| care.action == action)?;

    Some(PlannedTask {
        step_index,
        action: TaskAction::Care(action),
        due_at: done_at + care.every.as_duration(),
        overdue_at: None,
    })
}

/// When a step should start if every step before it takes its shortest or longest time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct StepWindow {
    pub step_index: usize,
    pub action: StepAction,
    #[serde(with = "time::serde::rfc3339")]
    pub earliest_start: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub latest_start: OffsetDateTime,
}

/// The planned windows from `step_index`, which the batch entered at `entered_at`, to the end.
/// The last entry is the harvest window.
pub fn timeline(plant: &Plant, step_index: usize, entered_at: OffsetDateTime) -> Vec<StepWindow> {
    let mut earliest = entered_at;
    let mut latest = entered_at;

    plant
        .steps
        .iter()
        .enumerate()
        .skip(step_index)
        .map(|(step_index, step)| {
            let window = StepWindow {
                step_index,
                action: step.action,
                earliest_start: earliest,
                latest_start: latest,
            };

            if let Some(min) = step.duration_min {
                earliest += min.as_duration();
                latest += step.duration_max.unwrap_or(min).as_duration();
            }

            window
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use time::macros::datetime;

    use super::*;

    fn pea_shoots() -> Plant {
        Plant::from_json(
            r#"{
                "name": "Pea shoots",
                "kind": "microgreen",
                "steps": [
                    { "action": "soak", "duration_min": "8h" },
                    {
                        "action": "blackout",
                        "duration_min": "3d",
                        "duration_max": "4d",
                        "care": [{ "action": "mist", "every": "12h" }]
                    },
                    {
                        "action": "light",
                        "duration_min": "6d",
                        "duration_max": "10d",
                        "care": [{ "action": "water", "every": "1d" }]
                    },
                    { "action": "harvest" }
                ]
            }"#,
        )
        .unwrap()
    }

    const START: OffsetDateTime = datetime!(2026-10-05 20:00 UTC);

    #[test]
    fn fixed_step_has_no_overdue_time() {
        assert_eq!(
            tasks_on_entering(&pea_shoots(), 0, START),
            [PlannedTask {
                step_index: 0,
                action: TaskAction::Advance(StepAction::Blackout),
                due_at: datetime!(2026-10-06 04:00 UTC),
                overdue_at: None,
            }]
        );
    }

    #[test]
    fn entering_a_step_schedules_advance_and_first_care() {
        let entered = datetime!(2026-10-06 04:00 UTC);
        assert_eq!(
            tasks_on_entering(&pea_shoots(), 1, entered),
            [
                PlannedTask {
                    step_index: 1,
                    action: TaskAction::Advance(StepAction::Light),
                    due_at: datetime!(2026-10-09 04:00 UTC),
                    overdue_at: Some(datetime!(2026-10-10 04:00 UTC)),
                },
                PlannedTask {
                    step_index: 1,
                    action: TaskAction::Care(CareAction::Mist),
                    due_at: datetime!(2026-10-06 16:00 UTC),
                    overdue_at: None,
                },
            ]
        );
    }

    #[test]
    fn harvest_step_has_no_tasks() {
        assert!(tasks_on_entering(&pea_shoots(), 3, START).is_empty());
        assert!(tasks_on_entering(&pea_shoots(), 9, START).is_empty());
    }

    #[test]
    fn next_care_counts_from_when_it_was_done() {
        let late_watering = datetime!(2026-10-11 09:30 UTC);
        let next = next_care(&pea_shoots(), 2, CareAction::Water, late_watering).unwrap();
        assert_eq!(next.due_at, datetime!(2026-10-12 09:30 UTC));
        assert_eq!(next.action, TaskAction::Care(CareAction::Water));
    }

    #[test]
    fn next_care_ignores_chores_the_step_doesnt_have() {
        assert_eq!(next_care(&pea_shoots(), 1, CareAction::Water, START), None);
        assert_eq!(next_care(&pea_shoots(), 9, CareAction::Mist, START), None);
    }

    #[test]
    fn task_actions_round_trip_through_their_parts() {
        for action in [
            TaskAction::Advance(StepAction::Light),
            TaskAction::Care(CareAction::Rinse),
        ] {
            assert_eq!(
                TaskAction::from_parts(action.kind(), action.action()),
                Some(action)
            );
        }
        assert_eq!(TaskAction::from_parts("care", "light"), None);
        assert_eq!(
            serde_json::to_value(TaskAction::Advance(StepAction::Light)).unwrap(),
            serde_json::json!({ "kind": "advance", "action": "light" })
        );
    }

    #[test]
    fn timeline_from_a_later_step() {
        let entered_light = datetime!(2026-10-10 12:00 UTC);
        let timeline = timeline(&pea_shoots(), 2, entered_light);

        assert_eq!(timeline.len(), 2);
        assert_eq!(timeline[0].action, StepAction::Light);
        assert_eq!(timeline[0].earliest_start, entered_light);
        assert_eq!(timeline[1].earliest_start, datetime!(2026-10-16 12:00 UTC));
        assert_eq!(timeline[1].latest_start, datetime!(2026-10-20 12:00 UTC));
    }

    #[test]
    fn timeline_gives_the_harvest_window() {
        let timeline = timeline(&pea_shoots(), 0, START);
        let starts: Vec<_> = timeline
            .iter()
            .map(|window| (window.action, window.earliest_start, window.latest_start))
            .collect();

        assert_eq!(
            starts,
            [
                (StepAction::Soak, START, START),
                (
                    StepAction::Blackout,
                    datetime!(2026-10-06 04:00 UTC),
                    datetime!(2026-10-06 04:00 UTC)
                ),
                (
                    StepAction::Light,
                    datetime!(2026-10-09 04:00 UTC),
                    datetime!(2026-10-10 04:00 UTC)
                ),
                (
                    StepAction::Harvest,
                    datetime!(2026-10-15 04:00 UTC),
                    datetime!(2026-10-20 04:00 UTC)
                ),
            ]
        );
    }
}
