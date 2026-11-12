import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { env } from './env.js';

export const db = new DatabaseSync(process.env.DB_PATH ?? path.join(env.dataDir, 'nmt.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    src_path    TEXT NOT NULL UNIQUE,
    dest_path   TEXT,
    folder_id   TEXT,
    status      TEXT NOT NULL,            -- pending | success | failed | skipped
    media_type  TEXT,                     -- movie | tv
    tmdb_id     INTEGER,
    title       TEXT,
    year        TEXT,
    season      INTEGER,
    episode     INTEGER,
    category    TEXT,
    poster      TEXT,
    message     TEXT,
    size        INTEGER,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_history_status ON history(status);
  CREATE INDEX IF NOT EXISTS idx_history_updated ON history(updated_at);
`);

export function kvGet<T>(key: string): T | undefined {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : undefined;
}

export function kvSet(key: string, value: unknown) {
  db.prepare('INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(value),
  );
}
