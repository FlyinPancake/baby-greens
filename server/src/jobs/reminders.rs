//! The reminder job. Every minute it finds tasks that came due, holds back people inside their
//! quiet hours, and sends everyone else one notification covering the due tasks. Everyone gets
//! reminders for every batch, since anyone on the server can tend it.

use std::{collections::BTreeMap, sync::Arc, time::Duration};

use anyhow::{Context, Result};
use sqlx::PgPool;
use time::OffsetDateTime;
use tokio::time::MissedTickBehavior;
use uuid::Uuid;

use crate::{
    db::push,
    domain::{
        quiet::{QuietHours, local_time},
        schedule::TaskAction,
    },
    notify::{Notifier, PushMessage, SendOutcome},
};

pub const INTERVAL: Duration = Duration::from_secs(60);

/// Runs forever, checking for due tasks every [`INTERVAL`].
pub async fn run<N: Notifier>(pool: PgPool, notifier: Arc<N>) {
    let mut ticker = tokio::time::interval(INTERVAL);
    ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        ticker.tick().await;
        match send_due(&pool, notifier.as_ref(), OffsetDateTime::now_utc()).await {
            Ok(report) if report.tasks > 0 || report.held > 0 => {
                tracing::info!(?report, "sent reminders");
            }
            Ok(_) => {}
            Err(error) => tracing::error!(error = format!("{error:#}"), "reminder run failed"),
        }
    }
}

/// What one run did.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Report {
    /// Reminders marked as sent, one per task and person.
    pub tasks: usize,
    /// Reminders left for later because the person is in quiet hours.
    pub held: usize,
    /// Messages the push service accepted.
    pub sent: usize,
    /// Subscriptions removed because the push service no longer knows them.
    pub removed: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DueTask {
    pub id: Uuid,
    pub batch_id: Uuid,
    pub action: TaskAction,
    pub plant_name: String,
    pub container: String,
}

/// Claims and sends the reminders due at `now`.
///
/// Claiming happens in one transaction, which records who was notified about which task before
/// anything is sent. A failed send is not retried, so nobody gets the same reminder twice.
pub async fn send_due<N: Notifier>(
    pool: &PgPool,
    notifier: &N,
    now: OffsetDateTime,
) -> Result<Report> {
    let mut report = Report::default();
    let mut tx = pool.begin().await?;

    let rows = sqlx::query!(
        r#"
        SELECT t.id, t.kind::text AS "kind!", t.action, b.id AS batch_id,
               b.plant ->> 'name' AS "plant_name!", c.name AS container,
               u.id AS user_id, u.timezone, u.quiet_start, u.quiet_end
        FROM tasks t
        JOIN batches b ON b.id = t.batch_id
        JOIN containers c ON c.id = b.container_id
        CROSS JOIN users u
        WHERE t.done_at IS NULL
          AND b.status = 'active'
          AND coalesce(t.snoozed_until, t.due_at) <= $1
          AND NOT EXISTS (
              SELECT 1 FROM task_notifications n WHERE n.task_id = t.id AND n.user_id = u.id
          )
        ORDER BY coalesce(t.snoozed_until, t.due_at), t.id
        FOR UPDATE OF t SKIP LOCKED
        "#,
        now,
    )
    .fetch_all(&mut *tx)
    .await?;

    let mut by_user: BTreeMap<Uuid, Vec<DueTask>> = BTreeMap::new();
    for row in rows {
        let quiet = row
            .quiet_start
            .zip(row.quiet_end)
            .map(|(start, end)| QuietHours { start, end });
        if quiet.is_some_and(|quiet| quiet.contains(local_time(now, &row.timezone))) {
            report.held += 1;
            continue;
        }
        let action = TaskAction::from_parts(&row.kind, &row.action)
            .with_context(|| format!("task {} has an unknown action", row.id))?;
        by_user.entry(row.user_id).or_default().push(DueTask {
            id: row.id,
            batch_id: row.batch_id,
            action,
            plant_name: row.plant_name,
            container: row.container,
        });
    }

    let (task_ids, user_ids): (Vec<Uuid>, Vec<Uuid>) = by_user
        .iter()
        .flat_map(|(user_id, tasks)| tasks.iter().map(|task| (task.id, *user_id)))
        .unzip();
    report.tasks = task_ids.len();
    if !task_ids.is_empty() {
        sqlx::query!(
            r#"
            INSERT INTO task_notifications (task_id, user_id, notified_at)
            SELECT task_id, user_id, $3 FROM unnest($1::uuid[], $2::uuid[]) AS p (task_id, user_id)
            "#,
            &task_ids,
            &user_ids,
            now,
        )
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    for (user_id, tasks) in by_user {
        let message = message_for(&tasks);
        let outcome = send_to_user(pool, notifier, user_id, &message).await?;
        report.sent += outcome.sent;
        report.removed += outcome.removed;
    }

    Ok(report)
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Delivery {
    pub sent: usize,
    pub removed: usize,
}

/// Sends `message` to every device the user subscribed, dropping subscriptions that are gone.
pub async fn send_to_user<N: Notifier>(
    pool: &PgPool,
    notifier: &N,
    user_id: Uuid,
    message: &PushMessage,
) -> Result<Delivery> {
    let mut delivery = Delivery::default();
    for subscription in push::for_user(pool, user_id).await? {
        match notifier.send(&subscription, message).await {
            Ok(SendOutcome::Sent) => delivery.sent += 1,
            Ok(SendOutcome::Gone) => {
                push::remove_by_id(pool, subscription.id).await?;
                delivery.removed += 1;
            }
            Err(error) => tracing::warn!(
                subscription = %subscription.id,
                error = format!("{error:#}"),
                "could not send a reminder"
            ),
        }
    }
    Ok(delivery)
}

/// The most tasks one notification lists before saying "and N more".
const LISTED: usize = 4;

/// One task gets a notification that opens its batch. Several get a list that opens today.
pub fn message_for(tasks: &[DueTask]) -> PushMessage {
    if let [task] = tasks {
        return PushMessage {
            title: task.action.label().to_owned(),
            body: format!("{} in {}", task.plant_name, task.container),
            url: format!("/batches/{}", task.batch_id),
            tag: format!("task-{}", task.id),
        };
    }

    let mut lines: Vec<String> = tasks
        .iter()
        .take(LISTED)
        .map(|task| {
            format!(
                "{}: {} ({})",
                task.action.label(),
                task.plant_name,
                task.container
            )
        })
        .collect();
    if tasks.len() > LISTED {
        lines.push(format!("and {} more", tasks.len() - LISTED));
    }

    PushMessage {
        title: format!("{} things to do", tasks.len()),
        body: lines.join("\n"),
        url: "/".to_owned(),
        tag: "due".to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use time::macros::{datetime, time};

    use super::*;
    use crate::{
        db::{
            batches::{self, NewBatch},
            containers::{self, ContainerKind},
            push::NewSubscription,
            users::{self, Identity},
        },
        domain::{
            library,
            plant::{CareAction, Slug, StepAction},
        },
        notify::Subscription,
    };

    /// Records messages instead of sending them. Endpoints containing "gone" act deleted.
    #[derive(Default)]
    struct FakeNotifier {
        sent: Mutex<Vec<(String, PushMessage)>>,
    }

    impl FakeNotifier {
        fn sent(&self) -> Vec<(String, PushMessage)> {
            self.sent.lock().unwrap().clone()
        }
    }

    impl Notifier for FakeNotifier {
        async fn send(
            &self,
            subscription: &Subscription,
            message: &PushMessage,
        ) -> Result<SendOutcome> {
            if subscription.endpoint.contains("gone") {
                return Ok(SendOutcome::Gone);
            }
            self.sent
                .lock()
                .unwrap()
                .push((subscription.endpoint.clone(), message.clone()));
            Ok(SendOutcome::Sent)
        }
    }

    const START: OffsetDateTime = datetime!(2026-10-05 08:00 UTC);
    /// Alfalfa started at 08:00 is due to be drained at 16:00.
    const DUE: OffsetDateTime = datetime!(2026-10-05 16:00 UTC);

    async fn grower(pool: &PgPool, subject: &str) -> Uuid {
        let identity = Identity {
            issuer: "http://localhost:5556/dex",
            subject,
            display_name: subject,
            email: None,
        };
        users::upsert_from_identity(pool, &identity).await.unwrap()
    }

    async fn subscribe(pool: &PgPool, user_id: Uuid, endpoint: &str) {
        let subscription = NewSubscription {
            endpoint,
            p256dh: "key",
            auth: "auth",
            user_agent: None,
        };
        push::save(pool, user_id, &subscription).await.unwrap();
    }

    async fn alfalfa(pool: &PgPool, user_id: Uuid, jar: &str) -> Uuid {
        let container_id = containers::create(pool, user_id, jar, ContainerKind::Jar, None, "")
            .await
            .unwrap();
        let slug: Slug = "alfalfa".parse().unwrap();
        let batch = NewBatch {
            plant: library::builtin()[&slug].clone(),
            plant_slug: slug,
            container_id,
            seed_g: 15,
            started_at: START,
            notes: String::new(),
        };
        batches::create(pool, user_id, batch).await.unwrap()
    }

    #[sqlx::test]
    async fn due_tasks_are_sent_once(pool: PgPool) {
        let user_id = grower(&pool, "grower").await;
        let batch_id = alfalfa(&pool, user_id, "jar 1").await;
        subscribe(&pool, user_id, "https://push.example/phone").await;
        subscribe(&pool, user_id, "https://push.example/laptop").await;
        let notifier = FakeNotifier::default();

        // Not due yet.
        let early = send_due(&pool, &notifier, DUE - time::Duration::minutes(1))
            .await
            .unwrap();
        assert_eq!(early, Report::default());

        let report = send_due(&pool, &notifier, DUE).await.unwrap();
        assert_eq!(
            report,
            Report {
                tasks: 1,
                held: 0,
                sent: 2,
                removed: 0
            }
        );
        let sent = notifier.sent();
        assert_eq!(sent.len(), 2);
        assert_eq!(sent[0].1.title, "Drain the soak water");
        assert_eq!(sent[0].1.body, "Alfalfa sprouts in jar 1");
        assert_eq!(sent[0].1.url, format!("/batches/{batch_id}"));

        // The next minute has nothing new.
        let again = send_due(&pool, &notifier, DUE + time::Duration::minutes(1))
            .await
            .unwrap();
        assert_eq!(again, Report::default());
    }

    #[sqlx::test]
    async fn quiet_hours_hold_reminders(pool: PgPool) {
        let user_id = grower(&pool, "grower").await;
        alfalfa(&pool, user_id, "jar 1").await;
        subscribe(&pool, user_id, "https://push.example/phone").await;
        // 16:00 UTC is 18:00 in Budapest. Quiet from 17:00 to 19:00 there.
        let quiet = QuietHours {
            start: time!(17:00),
            end: time!(19:00),
        };
        users::update_settings(&pool, user_id, Some("Europe/Budapest"), Some(Some(quiet)))
            .await
            .unwrap();
        let notifier = FakeNotifier::default();

        let held = send_due(&pool, &notifier, DUE).await.unwrap();
        assert_eq!(
            held,
            Report {
                held: 1,
                ..Default::default()
            }
        );
        assert!(notifier.sent().is_empty());

        // 17:00 UTC is 19:00 in Budapest, when the quiet hours end.
        let after = send_due(&pool, &notifier, datetime!(2026-10-05 17:00 UTC))
            .await
            .unwrap();
        assert_eq!(after.tasks, 1);
        assert_eq!(notifier.sent().len(), 1);
    }

    #[sqlx::test]
    async fn snoozed_tasks_wait_for_the_snooze(pool: PgPool) {
        let user_id = grower(&pool, "grower").await;
        let batch_id = alfalfa(&pool, user_id, "jar 1").await;
        subscribe(&pool, user_id, "https://push.example/phone").await;
        let notifier = FakeNotifier::default();
        send_due(&pool, &notifier, DUE).await.unwrap();

        let task = batches::open_tasks(&pool, None, Some(batch_id))
            .await
            .unwrap()[0]
            .id;
        let until = DUE + time::Duration::hours(1);
        batches::snooze_task(&pool, task, until, DUE).await.unwrap();

        let during = send_due(&pool, &notifier, until - time::Duration::minutes(1))
            .await
            .unwrap();
        assert_eq!(during.tasks, 0);
        let after = send_due(&pool, &notifier, until).await.unwrap();
        assert_eq!(after.tasks, 1);
        assert_eq!(notifier.sent().len(), 2);
    }

    #[sqlx::test]
    async fn several_tasks_become_one_message(pool: PgPool) {
        let user_id = grower(&pool, "grower").await;
        alfalfa(&pool, user_id, "jar 1").await;
        alfalfa(&pool, user_id, "jar 2").await;
        subscribe(&pool, user_id, "https://push.example/phone").await;
        let notifier = FakeNotifier::default();

        let report = send_due(&pool, &notifier, DUE).await.unwrap();
        assert_eq!(report.tasks, 2);
        let sent = notifier.sent();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].1.title, "2 things to do");
        assert_eq!(sent[0].1.url, "/");
        assert!(sent[0].1.body.contains("(jar 2)"));
    }

    #[sqlx::test]
    async fn gone_subscriptions_are_removed(pool: PgPool) {
        let user_id = grower(&pool, "grower").await;
        alfalfa(&pool, user_id, "jar 1").await;
        subscribe(&pool, user_id, "https://push.example/gone").await;
        subscribe(&pool, user_id, "https://push.example/phone").await;

        let report = send_due(&pool, &FakeNotifier::default(), DUE)
            .await
            .unwrap();
        assert_eq!(
            report,
            Report {
                tasks: 1,
                held: 0,
                sent: 1,
                removed: 1
            }
        );
        let left = push::for_user(&pool, user_id).await.unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].endpoint, "https://push.example/phone");
    }

    #[sqlx::test]
    async fn without_devices_tasks_still_count_as_notified(pool: PgPool) {
        // Otherwise subscribing later would replay every old reminder at once.
        let user_id = grower(&pool, "grower").await;
        alfalfa(&pool, user_id, "jar 1").await;
        let notifier = FakeNotifier::default();

        let report = send_due(&pool, &notifier, DUE).await.unwrap();
        assert_eq!(
            report,
            Report {
                tasks: 1,
                ..Default::default()
            }
        );
        subscribe(&pool, user_id, "https://push.example/phone").await;
        let later = send_due(&pool, &notifier, DUE + time::Duration::minutes(1))
            .await
            .unwrap();
        assert_eq!(later.tasks, 0);
    }

    /// Quiet from 17:00 to 19:00 in Budapest, which is 15:00 to 17:00 UTC.
    async fn quiet_evening(pool: &PgPool, user_id: Uuid) {
        let quiet = QuietHours {
            start: time!(17:00),
            end: time!(19:00),
        };
        users::update_settings(pool, user_id, Some("Europe/Budapest"), Some(Some(quiet)))
            .await
            .unwrap();
    }

    #[sqlx::test]
    async fn everyone_gets_reminders_in_their_own_time(pool: PgPool) {
        let owner = grower(&pool, "grower").await;
        let neighbour = grower(&pool, "neighbour").await;
        alfalfa(&pool, owner, "jar 1").await;
        subscribe(&pool, owner, "https://push.example/owner").await;
        subscribe(&pool, neighbour, "https://push.example/neighbour").await;
        quiet_evening(&pool, neighbour).await;
        let notifier = FakeNotifier::default();

        let report = send_due(&pool, &notifier, DUE).await.unwrap();
        assert_eq!(
            report,
            Report {
                tasks: 1,
                held: 1,
                sent: 1,
                removed: 0
            }
        );
        assert_eq!(notifier.sent()[0].0, "https://push.example/owner");

        // The neighbour's quiet hours end. The owner already has this one.
        let after = send_due(&pool, &notifier, datetime!(2026-10-05 17:00 UTC))
            .await
            .unwrap();
        assert_eq!(after.tasks, 1);
        let sent = notifier.sent();
        assert_eq!(sent.len(), 2);
        assert_eq!(sent[1].0, "https://push.example/neighbour");
    }

    #[sqlx::test]
    async fn done_tasks_skip_people_still_in_quiet_hours(pool: PgPool) {
        let owner = grower(&pool, "grower").await;
        let neighbour = grower(&pool, "neighbour").await;
        let batch_id = alfalfa(&pool, owner, "jar 1").await;
        subscribe(&pool, neighbour, "https://push.example/neighbour").await;
        quiet_evening(&pool, neighbour).await;
        let notifier = FakeNotifier::default();
        send_due(&pool, &notifier, DUE).await.unwrap();

        let task = batches::open_tasks(&pool, None, Some(batch_id))
            .await
            .unwrap()[0]
            .id;
        batches::complete_task(&pool, task, DUE).await.unwrap();

        let after = send_due(&pool, &notifier, datetime!(2026-10-05 17:00 UTC))
            .await
            .unwrap();
        assert_eq!(after, Report::default());
        assert!(notifier.sent().is_empty());
    }

    #[test]
    fn long_lists_are_cut_short() {
        let task = |n: usize| DueTask {
            id: Uuid::nil(),
            batch_id: Uuid::nil(),
            action: if n.is_multiple_of(2) {
                TaskAction::Care(CareAction::Rinse)
            } else {
                TaskAction::Advance(StepAction::Light)
            },
            plant_name: "Radish microgreens".into(),
            container: format!("tray {n}"),
        };
        let tasks: Vec<_> = (0..6).map(task).collect();
        let message = message_for(&tasks);
        assert_eq!(message.title, "6 things to do");
        let lines: Vec<_> = message.body.lines().collect();
        assert_eq!(lines.len(), 5);
        assert_eq!(lines[0], "Rinse and drain: Radish microgreens (tray 0)");
        assert_eq!(
            lines[1],
            "Uncover and move into light: Radish microgreens (tray 1)"
        );
        assert_eq!(lines[4], "and 2 more");
    }
}
