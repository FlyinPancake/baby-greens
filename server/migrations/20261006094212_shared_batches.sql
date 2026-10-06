-- Everyone on the server sees and tends every batch, so everyone gets its reminders. Each person
-- gets one per task, and someone in quiet hours still gets theirs once those end.
CREATE TABLE task_notifications (
    task_id uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    notified_at timestamptz NOT NULL,
    PRIMARY KEY (task_id, user_id)
);

-- Tasks that already went out count as sent to everyone, so nobody gets a burst of old reminders.
INSERT INTO task_notifications (task_id, user_id, notified_at)
SELECT t.id, u.id, t.notified_at
FROM tasks t
CROSS JOIN users u
WHERE t.notified_at IS NOT NULL;

ALTER TABLE tasks DROP COLUMN notified_at;
