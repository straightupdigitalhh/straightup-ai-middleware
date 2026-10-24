import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

// ─── SQLite-Fundament ────────────────────────────────────────────
//
// Eine Datei auf dem vorhandenen data-Volume, kein eigener DB-Server.
// Migrationen laufen über PRAGMA user_version – jede Migration genau einmal.

const MIGRATIONS: string[] = [
  // v1: Nutzer, Sessions, Automationen
  `
  CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin', 'member')),
    password_hash TEXT NOT NULL,
    disabled_at   TEXT,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);

  CREATE TABLE automation_config (
    id         TEXT PRIMARY KEY,
    enabled    INTEGER NOT NULL DEFAULT 0,
    cron       TEXT,
    settings   TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE automation_runs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    automation_id TEXT NOT NULL,
    trigger       TEXT NOT NULL CHECK (trigger IN ('schedule', 'manual')),
    status        TEXT NOT NULL CHECK (status IN ('running', 'ok', 'error')),
    started_at    TEXT NOT NULL,
    finished_at   TEXT,
    summary       TEXT,
    error         TEXT,
    log           TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_runs_automation ON automation_runs(automation_id, started_at DESC);
  `,
  // v2: awork-Mapping + Teamboard-Einstellungen
  `
  ALTER TABLE users ADD COLUMN awork_user_id TEXT;
  CREATE UNIQUE INDEX idx_users_awork ON users(awork_user_id) WHERE awork_user_id IS NOT NULL;

  CREATE TABLE teamboard_einstellungen (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    reihenfolge TEXT, ausgeblendet TEXT, updated_at TEXT NOT NULL
  );
  `,
  // v3: Erledigungen (Undo-Zustand, Kommentar-Warteschlange, Protokoll)
  `
  CREATE TABLE teamboard_erledigungen (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    task_name TEXT NOT NULL,
    project_id TEXT NOT NULL,
    alter_status_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id),
    awork_user_id TEXT NOT NULL,
    erledigt_am TEXT NOT NULL,
    rueckgaengig_am TEXT,
    kommentar_am TEXT,
    fehlversuche INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_erledigungen_offen ON teamboard_erledigungen (kommentar_am, rueckgaengig_am, erledigt_am);
  CREATE INDEX idx_erledigungen_task ON teamboard_erledigungen (task_id, rueckgaengig_am, kommentar_am);
  `,
  // v4: Filterleiste — gespeicherter Filter-Zustand je Nutzer.
  // Bestehende Zeilen bekommen filter NULL; der Store liest das als "kein
  // Filter aktiv" (s. core/teamboard-einstellungen.ts, parseFilter).
  `
  ALTER TABLE teamboard_einstellungen ADD COLUMN filter TEXT;
  `,
  // v5: Sicherheitsplattform Teil 1. Nur neue Tabellen, nichts Bestehendes
  // wird angefasst. sicherheit_stand hat genau eine Zeile (der letzte Stand
  // des Wachdienstes), sicherheit_kennzahlen je Berliner Tag eine,
  // sicherheit_auftraege jeden Auftrag aus dem Dashboard samt Quittung
  // (services/sicherheit/speicher.ts). Auftrags-IDs sind UUIDs und werden nie
  // wieder vergeben: der Kern behält jede bekannte ID für immer.
  `
  CREATE TABLE sicherheit_stand (
    id        INTEGER PRIMARY KEY CHECK (id = 1),
    stand     TEXT NOT NULL,
    empfangen TEXT NOT NULL
  );

  CREATE TABLE sicherheit_kennzahlen (
    tag        TEXT PRIMARY KEY,
    kennzahlen TEXT NOT NULL,
    empfangen  TEXT NOT NULL
  );

  CREATE TABLE sicherheit_auftraege (
    id            TEXT PRIMARY KEY,
    art           TEXT NOT NULL,
    site          TEXT NOT NULL,
    typ           TEXT,
    werte         TEXT NOT NULL,
    durch         TEXT NOT NULL,
    erstellt      TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen', 'angewandt', 'fehler')),
    quittung_text TEXT,
    quittiert     TEXT
  );
  `,
  // v6: Zweiter Faktor (TOTP) für /sicherheit (core/zweiter-faktor.ts). Je
  // Konto das eingerichtete Geheimnis, der Entwurf, den die Einrichtung gerade
  // zeigt, die Session, der dieser Entwurf gehört (ihr Token-Hash: nur sie darf
  // ihn zum Geheimnis machen), und der Zeitschritt des zuletzt angenommenen
  // Codes (ein Code gilt nur einmal). Je Session der Zeitpunkt, bis zu dem sie
  // als bestätigt gilt. Nur neue Spalten ohne Vorgabe: bestehende Zeilen bleiben
  // gültig und haben NULL, also nichts eingerichtet und nichts bestätigt.
  // totp_entwurf_session verweist bewusst nicht per FOREIGN KEY auf sessions:
  // Abmelden darf nicht an einem offenen Entwurf scheitern, und der Hash einer
  // gelöschten Session passt zu keiner lebenden.
  `
  ALTER TABLE users ADD COLUMN totp_geheimnis TEXT;
  ALTER TABLE users ADD COLUMN totp_entwurf TEXT;
  ALTER TABLE users ADD COLUMN totp_entwurf_session TEXT;
  ALTER TABLE users ADD COLUMN totp_letzter_schritt INTEGER;
  ALTER TABLE sessions ADD COLUMN zweiter_faktor_bis TEXT;
  `,
];

export function openDb(filePath: string): DatabaseSync {
  if (filePath !== ':memory:') {
    mkdirSync(dirname(filePath), { recursive: true });
  }
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  let version = row.user_version;
  while (version < MIGRATIONS.length) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version]);
      version++;
      db.exec(`PRAGMA user_version = ${version}`);
      db.exec('COMMIT');
      console.log(`🗄️  DB-Migration auf Version ${version} angewendet`);
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}
