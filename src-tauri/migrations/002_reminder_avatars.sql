-- A reminder may arrive wearing a different avatar than the one that normally
-- lives on the desktop: a cheerful character to drink water, a stern one to
-- stand up. NULL means "whichever avatar is currently showing", which is what
-- every reminder created before this column did.
ALTER TABLE reminders ADD COLUMN avatar_id TEXT;
