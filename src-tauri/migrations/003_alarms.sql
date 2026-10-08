-- Alarms: the things that happen at a time of day, as opposed to reminders,
-- which happen at an interval. Kept in their own table rather than as a flag on
-- `reminders` because almost nothing is shared — an alarm has a wall-clock
-- time, an optional warning before it, and no interval at all.
--
-- `at_minutes` is minutes since local midnight, so an alarm stays at the time
-- the user set it to across daylight saving changes; `next_trigger` is the
-- epoch millisecond that resolves to, recomputed whenever it fires.
CREATE TABLE IF NOT EXISTS alarms (
  id            TEXT    PRIMARY KEY,
  label         TEXT    NOT NULL,
  message       TEXT    NOT NULL DEFAULT '',
  enabled       INTEGER NOT NULL DEFAULT 1,
  at_minutes    INTEGER NOT NULL,
  repeat_daily  INTEGER NOT NULL DEFAULT 0,
  lead_minutes  INTEGER NOT NULL DEFAULT 5,
  avatar_id     TEXT,
  next_trigger  INTEGER NOT NULL,
  lead_done     INTEGER NOT NULL DEFAULT 0,
  last_triggered INTEGER,
  sort_order    INTEGER NOT NULL DEFAULT 0
);
