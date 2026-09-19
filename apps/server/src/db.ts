import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.ts";

/**
 * Persistance SQLite via le module natif de Node, sans dependance externe.
 * Les traces d'activite (potentiellement des milliers de points) sont stockees
 * en JSON compresse dans une colonne dediee plutot qu'en lignes, car elles ne
 * sont jamais interrogees point par point.
 */

mkdirSync(dirname(config.databasePath), { recursive: true });

export const db = new DatabaseSync(config.databasePath);

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  birth_date TEXT,
  weight_kg REAL,
  max_hr INTEGER,
  rest_hr INTEGER,
  vma REAL,
  weekly_sessions INTEGER NOT NULL DEFAULT 3,
  level TEXT NOT NULL DEFAULT 'debutant'
);

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sport TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  start_time INTEGER NOT NULL,
  elapsed_time INTEGER NOT NULL,
  moving_time INTEGER NOT NULL,
  distance INTEGER NOT NULL,
  elevation_gain INTEGER NOT NULL DEFAULT 0,
  elevation_loss INTEGER NOT NULL DEFAULT 0,
  avg_hr INTEGER,
  max_hr INTEGER,
  avg_cadence INTEGER,
  avg_power INTEGER,
  calories INTEGER,
  source TEXT NOT NULL,
  source_id TEXT,
  points TEXT NOT NULL,
  laps TEXT NOT NULL,
  metrics TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS activities_user_start
  ON activities(user_id, start_time DESC);

-- Empeche d'importer deux fois la meme activite depuis une meme source.
CREATE UNIQUE INDEX IF NOT EXISTS activities_source_unique
  ON activities(user_id, source, source_id)
  WHERE source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal TEXT NOT NULL,
  target_date TEXT NOT NULL,
  target_time INTEGER,
  created_at INTEGER NOT NULL,
  sessions TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS plans_user ON plans(user_id, created_at DESC);

-- Jetons anti-CSRF a usage unique pour le flux OAuth Strava.
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS strava_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  athlete_id TEXT NOT NULL,
  athlete_name TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  last_sync_at INTEGER
);

-- Etat d'appairage de la montre, pour retrouver l'appareil d'une session a l'autre.
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  model TEXT,
  firmware TEXT,
  serial TEXT,
  last_seen_at INTEGER,
  last_battery INTEGER,
  transport TEXT NOT NULL DEFAULT 'ble'
);

CREATE INDEX IF NOT EXISTS devices_user ON devices(user_id);

CREATE TABLE IF NOT EXISTS kudos (
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (activity_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS comments_activity ON comments(activity_id, created_at);

CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);
`);

export type Row = Record<string, unknown>;

/** Identifiant court, trie chronologiquement, suffisant pour un usage local. */
export function newId(prefix = ""): string {
  const time = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}${time}${random}`;
}
