-- Tell Me accounts, end-to-end encrypted sync, friends and challenges.
--
-- What the server can read: your display name and emoji, the habits you chose to share with
-- friends (name, emoji, days, this week's Yes/No), friendships, reactions, nudges and challenges.
-- What it can't: everything else. Private habits and every answer are encrypted on your devices
-- with a key the server never sees (sync_records.data is ciphertext).

CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,           -- random, server-generated
  auth_hash    TEXT NOT NULL UNIQUE,       -- SHA-256 of the auth secret derived from the account key
  name         TEXT NOT NULL,
  emoji        TEXT NOT NULL,
  friend_code  TEXT NOT NULL UNIQUE,       -- 8 characters, shared to add friends; can be rotated
  time_zone    TEXT NOT NULL DEFAULT 'UTC',
  sync_seq     INTEGER NOT NULL DEFAULT 0, -- last sequence number handed out to this user's records
  share_hash   TEXT,                       -- fingerprint of the last shared-habits snapshot
  quota_day    TEXT NOT NULL DEFAULT '',   -- UTC day of the write budget below
  quota_used   INTEGER NOT NULL DEFAULT 0, -- rows written today (sync + sharing), capped per day
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  last_seen_at INTEGER
);

-- One row per record (habit or check-in). Ids are HMACs, payloads are AES-GCM ciphertext.
CREATE TABLE IF NOT EXISTS sync_records (
  user_id    TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('h', 'c')),
  id         TEXT NOT NULL,
  seq        INTEGER NOT NULL,             -- per-user change counter, used to pull "what's new since N"
  updated_at INTEGER NOT NULL,             -- client timestamp: last writer wins
  deleted    INTEGER NOT NULL DEFAULT 0,
  data       TEXT NOT NULL,
  PRIMARY KEY (user_id, kind, id)
);
CREATE INDEX IF NOT EXISTS idx_sync_records_seq ON sync_records (user_id, seq);

-- The latest published state of each habit a user shares with friends.
CREATE TABLE IF NOT EXISTS shared_habits (
  user_id    TEXT NOT NULL,
  habit_id   TEXT NOT NULL,
  name       TEXT NOT NULL,
  emoji      TEXT NOT NULL,
  color      TEXT NOT NULL,
  days       INTEGER NOT NULL,             -- bitmask: bit 0 = Sunday ... bit 6 = Saturday
  time       TEXT,                         -- planned "HH:MM", or NULL for any time
  ask_min    INTEGER NOT NULL,             -- minutes after midnight when the check-in is due
  date       TEXT NOT NULL,                -- owner's local date when this snapshot was made
  week_start TEXT NOT NULL,                -- first day of that week
  week       TEXT NOT NULL,                -- 7 chars: Y yes, N no, M missed, P due today, F later, . rest
  streak     INTEGER NOT NULL DEFAULT 0,
  best       INTEGER NOT NULL DEFAULT 0,
  position   INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, habit_id)
);

-- Friendships are mutual and stored in both directions.
CREATE TABLE IF NOT EXISTS friendships (
  user_id    TEXT NOT NULL,
  friend_id  TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, friend_id)
);

CREATE TABLE IF NOT EXISTS reactions (
  from_id    TEXT NOT NULL,
  to_id      TEXT NOT NULL,
  habit_id   TEXT NOT NULL,
  date       TEXT NOT NULL,                -- the check-in's local date
  emoji      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (from_id, to_id, habit_id, date)
);
CREATE INDEX IF NOT EXISTS idx_reactions_to ON reactions (to_id, date);

-- One nudge per friend, habit and day.
CREATE TABLE IF NOT EXISTS nudges (
  from_id    TEXT NOT NULL,
  to_id      TEXT NOT NULL,
  habit_id   TEXT NOT NULL,
  date       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (from_id, to_id, habit_id, date)
);
CREATE INDEX IF NOT EXISTS idx_nudges_to ON nudges (to_id, date);

CREATE TABLE IF NOT EXISTS challenges (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL,
  name       TEXT NOT NULL,
  emoji      TEXT NOT NULL,
  target     INTEGER NOT NULL,             -- Yes answers per week
  created_at INTEGER NOT NULL
);

-- habit_id NULL = invited but not joined yet.
CREATE TABLE IF NOT EXISTS challenge_members (
  challenge_id TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  habit_id     TEXT,
  invited_by   TEXT,
  joined_at    INTEGER,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (challenge_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_challenge_members_user ON challenge_members (user_id);

-- Small fixed-window counters (e.g. sign-ups per IP per hour).
CREATE TABLE IF NOT EXISTS rate_limits (
  key   TEXT PRIMARY KEY,
  win   TEXT NOT NULL,                     -- the window, e.g. "2026-10-06T14" for an hourly limit
  count INTEGER NOT NULL
);

-- Devices with push turned on can be linked to an account, so friends' nudges reach them.
ALTER TABLE devices ADD COLUMN user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices (user_id);
