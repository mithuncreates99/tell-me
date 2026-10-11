-- Stronger reminders: ask a second time when a check-in is still unanswered.

-- Minutes after the first push to ask again (0 = never).
ALTER TABLE reminders ADD COLUMN follow_up_min INTEGER NOT NULL DEFAULT 0;
-- 1 when the next push (next_fire_at) is that second ask.
ALTER TABLE reminders ADD COLUMN next_follow_up INTEGER NOT NULL DEFAULT 0;
