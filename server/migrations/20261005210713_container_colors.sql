-- An optional colour per jar or tray, as lowercase #rrggbb. Null means clear or uncoloured.
ALTER TABLE containers
    ADD COLUMN color text CHECK (color ~ '^#[0-9a-f]{6}$');
