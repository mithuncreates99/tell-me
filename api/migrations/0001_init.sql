-- Tell Me: the server only knows WHEN to remind you, never what you answered.

CREATE TABLE IF NOT EXISTS devices (
  id           TEXT PRIMARY KEY,          -- random id generated on the device
  token_hash   TEXT NOT NULL,             -- SHA-256 of the device's secret token
  endpoint     TEXT NOT NULL,             -- Web Push subscription endpoint
  p256dh       TEXT NOT NULL,             -- subscription public key (base64url)
  auth         TEXT NOT NULL,             -- subscription auth secret (base64url)
  time_zone    TEXT NOT NULL,             -- IANA zone, e.g. Europe/Paris
  created_at   INTEGER NOT NULL,          -- unix ms
  updated_at   INTEGER NOT NULL,          -- unix ms
  last_push_at INTEGER,                   -- unix ms of last successful push
  failures     INTEGER NOT NULL DEFAULT 0 -- consecutive failed pushes
);

CREATE TABLE IF NOT EXISTS reminders (
  device_id    TEXT NOT NULL,
  id           TEXT NOT NULL,             -- habit id, or "weekly-report"
  kind         TEXT NOT NULL CHECK (kind IN ('checkin', 'weekly')),
  title        TEXT NOT NULL,
  emoji        TEXT NOT NULL DEFAULT '',
  days         INTEGER NOT NULL,          -- bitmask: bit 0 = Sunday ... bit 6 = Saturday
  time         TEXT NOT NULL,             -- planned local time "HH:MM"
  offset_min   INTEGER NOT NULL DEFAULT 0,-- ask this many minutes after the planned time
  skip_dates   TEXT NOT NULL DEFAULT '',  -- comma-separated local dates already answered
  next_fire_at INTEGER,                   -- unix ms of the next push (NULL = none)
  next_date    TEXT,                      -- local date (YYYY-MM-DD) that push is about
  PRIMARY KEY (device_id, id)
);

-- The cron tick only ever reads rows that are due, via this index.
CREATE INDEX IF NOT EXISTS idx_reminders_next_fire ON reminders (next_fire_at);
