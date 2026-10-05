-- Initial schema for the MVP data model in docs/plan.md.
-- Requires Postgres 18 for uuidv7().

CREATE TYPE crop_kind AS ENUM ('sprout', 'microgreen');
CREATE TYPE batch_status AS ENUM ('active', 'harvested', 'discarded');
CREATE TYPE stage_kind AS ENUM ('soak', 'blackout', 'light', 'growing');
CREATE TYPE task_kind AS ENUM ('rinse', 'water', 'move', 'harvest');

CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    oidc_issuer text NOT NULL,
    oidc_subject text NOT NULL,
    display_name text NOT NULL,
    email text,
    timezone text NOT NULL DEFAULT 'UTC',
    quiet_start time,
    quiet_end time,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (oidc_issuer, oidc_subject),
    CHECK ((quiet_start IS NULL) = (quiet_end IS NULL))
);

CREATE TABLE push_subscriptions (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    endpoint text NOT NULL UNIQUE,
    p256dh text NOT NULL,
    auth text NOT NULL,
    user_agent text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX push_subscriptions_user_id_idx ON push_subscriptions (user_id);

-- user_id is NULL for built-in varieties.
CREATE TABLE varieties (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    user_id uuid REFERENCES users (id) ON DELETE CASCADE,
    name text NOT NULL,
    kind crop_kind NOT NULL,
    soak_hours integer NOT NULL DEFAULT 0 CHECK (soak_hours >= 0),
    rinses_per_day integer NOT NULL DEFAULT 0 CHECK (rinses_per_day >= 0),
    blackout_days integer NOT NULL DEFAULT 0 CHECK (blackout_days >= 0),
    harvest_day_min integer NOT NULL CHECK (harvest_day_min > 0),
    harvest_day_max integer NOT NULL,
    seed_g_per_tray integer CHECK (seed_g_per_tray > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (harvest_day_max >= harvest_day_min),
    UNIQUE NULLS NOT DISTINCT (user_id, name)
);

CREATE TABLE batches (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    variety_id uuid NOT NULL REFERENCES varieties (id) ON DELETE RESTRICT,
    container text NOT NULL,
    seed_g integer NOT NULL CHECK (seed_g > 0),
    started_at timestamptz NOT NULL,
    status batch_status NOT NULL DEFAULT 'active',
    notes text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX batches_user_id_status_idx ON batches (user_id, status);

CREATE TABLE stages (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    batch_id uuid NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
    kind stage_kind NOT NULL,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    CHECK (ends_at > starts_at)
);

CREATE INDEX stages_batch_id_idx ON stages (batch_id);

CREATE TABLE tasks (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    batch_id uuid NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
    kind task_kind NOT NULL,
    due_at timestamptz NOT NULL,
    snoozed_until timestamptz,
    done_at timestamptz,
    notified_at timestamptz
);

CREATE INDEX tasks_batch_id_idx ON tasks (batch_id);

-- The scheduler looks up open tasks by the time they're next due.
CREATE INDEX tasks_open_due_idx ON tasks ((coalesce(snoozed_until, due_at)))
    WHERE done_at IS NULL;

-- A batch can have several harvests, for example pea shoots cut twice.
CREATE TABLE harvests (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    batch_id uuid NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
    harvested_at timestamptz NOT NULL,
    yield_g integer NOT NULL CHECK (yield_g >= 0),
    rating smallint CHECK (rating BETWEEN 1 AND 5),
    notes text NOT NULL DEFAULT ''
);

CREATE INDEX harvests_batch_id_idx ON harvests (batch_id);
