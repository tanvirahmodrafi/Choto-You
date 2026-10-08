-- Settings are a key/value store rather than a wide table: the shape of the
-- settings changes often during development, and a column-per-setting schema
-- would mean a migration for every new toggle. Values are JSON.
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminders (
    id                  TEXT PRIMARY KEY NOT NULL,
    kind                TEXT NOT NULL,
    title               TEXT NOT NULL,
    message             TEXT NOT NULL,
    enabled             INTEGER NOT NULL DEFAULT 1,
    interval_minutes    REAL NOT NULL,
    animation           TEXT NOT NULL,
    follow_up_animation TEXT,
    bubble_seconds      REAL NOT NULL DEFAULT 8,
    sound               TEXT,
    -- Epoch milliseconds. Stored so a reminder's cycle survives a restart
    -- instead of starting over every time the companion launches.
    last_triggered      INTEGER,
    next_trigger        INTEGER NOT NULL,
    sort_order          INTEGER NOT NULL DEFAULT 0
);

-- Installed character packs. Only the bundled one exists today; the table is
-- here so importing a pack later does not need a migration.
CREATE TABLE IF NOT EXISTS characters (
    id          TEXT PRIMARY KEY NOT NULL,
    name        TEXT NOT NULL,
    version     TEXT NOT NULL,
    source_path TEXT,
    installed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS character_preferences (
    character_id TEXT PRIMARY KEY NOT NULL,
    scale        REAL NOT NULL DEFAULT 1,
    walk_speed   REAL,
    FOREIGN KEY (character_id) REFERENCES characters (id) ON DELETE CASCADE
);

-- A short local log of what the companion did, for the debug view. Never
-- leaves the machine.
CREATE TABLE IF NOT EXISTS activity_history (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    at        INTEGER NOT NULL,
    kind      TEXT NOT NULL,
    detail    TEXT
);

CREATE INDEX IF NOT EXISTS idx_activity_at ON activity_history (at);
