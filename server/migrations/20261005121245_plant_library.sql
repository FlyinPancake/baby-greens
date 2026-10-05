-- Replace the varieties table with plant definitions written in the JSON format from
-- src/domain/plant.rs. Built-in plants ship in the binary. Custom plants live here.
--
-- No batches exist yet, so the batch and task tables are reshaped without carrying data over.

DROP TABLE stages;
DROP TABLE tasks;
ALTER TABLE batches DROP COLUMN variety_id;
DROP TABLE varieties;
DROP TYPE stage_kind;
DROP TYPE task_kind;
DROP TYPE crop_kind;

-- Shared by every account on the server. A slug that matches a built-in plant overrides it.
CREATE TABLE custom_plants (
    slug text PRIMARY KEY CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 64),
    definition jsonb NOT NULL,
    created_by uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- A batch keeps a copy of its plant from when it started, so later edits to the plant only
-- affect new batches.
ALTER TABLE batches
    ADD COLUMN plant_slug text NOT NULL,
    ADD COLUMN plant jsonb NOT NULL,
    ADD COLUMN current_step integer NOT NULL DEFAULT 0 CHECK (current_step >= 0);

-- When the batch actually entered and left each step.
CREATE TABLE batch_steps (
    batch_id uuid NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
    step_index integer NOT NULL CHECK (step_index >= 0),
    started_at timestamptz NOT NULL,
    ended_at timestamptz,
    PRIMARY KEY (batch_id, step_index),
    CHECK (ended_at >= started_at)
);

CREATE TYPE task_kind AS ENUM ('advance', 'care');

-- `action` holds a step action for advance tasks (the step to move into) or a care action.
-- Both come from the plant format, so they're text rather than Postgres enums.
CREATE TABLE tasks (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    batch_id uuid NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
    step_index integer NOT NULL CHECK (step_index >= 0),
    kind task_kind NOT NULL,
    action text NOT NULL,
    due_at timestamptz NOT NULL,
    overdue_at timestamptz,
    snoozed_until timestamptz,
    done_at timestamptz,
    notified_at timestamptz,
    CHECK (overdue_at >= due_at)
);

CREATE INDEX tasks_batch_id_idx ON tasks (batch_id);

-- The scheduler looks up open tasks by the time they're next due.
CREATE INDEX tasks_open_due_idx ON tasks ((coalesce(snoozed_until, due_at)))
    WHERE done_at IS NULL;
