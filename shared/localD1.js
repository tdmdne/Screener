// shared/localD1.js — D1-compatible SQLite adapter over Node 22+ built-in node:sqlite.
// Server-side only (used by server.js for full local/Node parity with Cloudflare D1).

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const MIGRATION_FILES = [
  "0001_auth_and_user_data.sql",
  "0002_waitlist.sql",
  "0003_verification_and_consent.sql",
  "0004_user_avatar.sql",
];

function applyMigrations(sqlite, migrationsDir) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS _vt_migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);
  const seenStmt = sqlite.prepare("SELECT 1 FROM _vt_migrations WHERE name = ?");
  const markStmt = sqlite.prepare("INSERT OR IGNORE INTO _vt_migrations (name, applied_at) VALUES (?, ?)");

  for (const file of MIGRATION_FILES) {
    if (seenStmt.get(file)) continue;
    const full = path.join(migrationsDir, file);
    if (!fs.existsSync(full)) continue;
    const sql = fs.readFileSync(full, "utf8");
    try {
      sqlite.exec(sql);
      markStmt.run(file, Date.now());
    } catch (err) {
      // Ignore idempotent duplicate-column errors on pre-existing local SQLite files
      if (err && /duplicate column name/i.test(String(err.message || ""))) {
        markStmt.run(file, Date.now());
      } else {
        throw err;
      }
    }
  }
}

export function createLocalD1(rootDir) {
  const migrationsDir = path.join(rootDir, "migrations");
  let sqlite;
  try {
    const dbDir = path.join(rootDir, ".vektor-data");
    fs.mkdirSync(dbDir, { recursive: true });
    sqlite = new DatabaseSync(path.join(dbDir, "local-d1.sqlite"));
  } catch (_e) {
    sqlite = new DatabaseSync(":memory:");
  }

  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec("PRAGMA journal_mode = WAL;");
  applyMigrations(sqlite, migrationsDir);

  return {
    _sqlite: sqlite,
    prepare(sql) {
      let boundArgs = [];
      const stmt = sqlite.prepare(sql);
      const handle = {
        bind(...args) {
          boundArgs = args.map((v) => (v === undefined ? null : v));
          return handle;
        },
        async first() {
          const row = stmt.get(...boundArgs);
          return row === undefined ? null : row;
        },
        async all() {
          const rows = stmt.all(...boundArgs);
          return { results: rows, success: true };
        },
        async run() {
          const info = stmt.run(...boundArgs);
          return { success: true, meta: { changes: info.changes } };
        },
      };
      return handle;
    },
  };
}
