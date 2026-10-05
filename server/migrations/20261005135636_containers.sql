-- Jars and trays as shared records instead of free text on each batch. Every account on the
-- server sees the same containers, like custom plants.

CREATE TYPE container_kind AS ENUM ('jar', 'tray');

CREATE TABLE containers (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    name text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 60),
    kind container_kind NOT NULL,
    notes text NOT NULL DEFAULT '',
    created_by uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    -- Containers with past batches get archived instead of deleted, so history keeps its jar.
    archived_at timestamptz
);

-- "Jar 2" and "jar 2" are the same jar.
CREATE UNIQUE INDEX containers_name_unique ON containers (lower(name));

-- Turn each distinct name in existing batches into a container. Sprouts suggest a jar and
-- microgreens a tray. The earliest batch decides when a name was used both ways.
INSERT INTO containers (name, kind, created_by)
SELECT DISTINCT ON (lower(btrim(container)))
    btrim(container),
    CASE WHEN plant ->> 'kind' = 'microgreen' THEN 'tray' ELSE 'jar' END::container_kind,
    user_id
FROM batches
ORDER BY lower(btrim(container)), started_at;

ALTER TABLE batches ADD COLUMN container_id uuid REFERENCES containers (id) ON DELETE RESTRICT;

UPDATE batches b
SET container_id = c.id
FROM containers c
WHERE lower(c.name) = lower(btrim(b.container));

ALTER TABLE batches
    ALTER COLUMN container_id SET NOT NULL,
    DROP COLUMN container;

CREATE INDEX batches_container_id_idx ON batches (container_id);

-- One growing batch per jar or tray at a time.
CREATE UNIQUE INDEX batches_one_active_per_container ON batches (container_id)
    WHERE status = 'active';
