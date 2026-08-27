import { DatabaseSync } from 'node:sqlite';

// ─── Types ───────────────────────────────────────────────────────

export interface TeamboardEinstellungen {
  reihenfolge: string[] | null;
  ausgeblendet: string[];
}

interface TeamboardEinstellungenRow {
  user_id: string;
  reihenfolge: string | null;
  ausgeblendet: string | null;
  updated_at: string;
}

const DEFAULT_EINSTELLUNGEN: TeamboardEinstellungen = { reihenfolge: null, ausgeblendet: [] };

/** Parst ein JSON-Array; bei fehlender/kaputter Zeile liefert sie den übergebenen Default. */
function parseArray<T>(json: string | null, fallback: T): string[] | T {
  if (json === null) return fallback;
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as string[]) : fallback;
  } catch {
    return fallback;
  }
}

function toEinstellungen(row: TeamboardEinstellungenRow): TeamboardEinstellungen {
  return {
    reihenfolge: parseArray(row.reihenfolge, null),
    ausgeblendet: parseArray(row.ausgeblendet, []),
  };
}

// ─── Store ───────────────────────────────────────────────────────

export class TeamboardEinstellungenStore {
  constructor(private db: DatabaseSync) {}

  get(userId: string): TeamboardEinstellungen {
    const row = this.db.prepare(
      'SELECT * FROM teamboard_einstellungen WHERE user_id = ?',
    ).get(userId) as TeamboardEinstellungenRow | undefined;
    return row ? toEinstellungen(row) : { ...DEFAULT_EINSTELLUNGEN };
  }

  set(userId: string, e: TeamboardEinstellungen): void {
    this.db.prepare(
      `INSERT INTO teamboard_einstellungen (user_id, reihenfolge, ausgeblendet, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         reihenfolge = excluded.reihenfolge,
         ausgeblendet = excluded.ausgeblendet,
         updated_at = excluded.updated_at`,
    ).run(
      userId,
      e.reihenfolge === null ? null : JSON.stringify(e.reihenfolge),
      JSON.stringify(e.ausgeblendet),
      new Date().toISOString(),
    );
  }
}
