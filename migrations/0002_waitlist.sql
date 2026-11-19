-- Migration 0002: Pre-Launch Waitlist
-- Target: Cloudflare D1 (SQLite).

CREATE TABLE IF NOT EXISTS waitlist (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  canonical_email TEXT NOT NULL UNIQUE,
  source TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_waitlist_created_at ON waitlist(created_at);
