-- Migration 0001: Accounts, Profiles, OAuth2/OIDC, Sessions, Rate-Limiting & Per-User Data Isolation
-- Target: Cloudflare D1 (SQLite). All user-scoped tables enforce ON DELETE CASCADE.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  canonical_email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  full_name TEXT,
  username TEXT,
  username_lower TEXT UNIQUE,
  dob TEXT,
  phone TEXT,
  profile_completed INTEGER NOT NULL DEFAULT 1 CHECK (profile_completed IN (0, 1)),
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'elite')),
  trial_used_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  disabled_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  ip_hash TEXT,
  ua TEXT
);

CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL,
  locked_until INTEGER
);

CREATE TABLE IF NOT EXISTS user_data (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  namespace TEXT NOT NULL CHECK (namespace IN ('watchlists', 'alerts', 'drawings', 'scripts', 'journal', 'layouts')),
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, namespace)
);

CREATE TABLE IF NOT EXISTS oauth_accounts (
  provider TEXT NOT NULL CHECK (provider IN ('google', 'apple')),
  provider_user_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'apple')),
  pkce_verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  return_to TEXT,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_users_canonical_email ON users(canonical_email);
CREATE INDEX IF NOT EXISTS idx_users_username_lower ON users(username_lower);
CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user_id ON oauth_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at ON oauth_states(expires_at);
