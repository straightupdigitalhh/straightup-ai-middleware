import { DatabaseSync } from 'node:sqlite';

// ─── Types ───────────────────────────────────────────────────────

/**
 * Zustand der Filterleiste (Stufe 3, Filterleiste F2). Innerhalb einer
 * Dimension gilt ODER, zwischen den Dimensionen UND — die Auswertung selbst
 * steht als reine Funktion in services/teamboard/seite.ts (wendeFilterAn).
 *
 * Die Werte sind Fremddaten aus awork (Projekt-Art- und Arbeitsart-Namen,
 * Projekt-ID) bzw. feste Schlüssel (Fälligkeit, Status) — der Store
 * behandelt sie durchweg als undurchsichtige Zeichenketten.
 */
export interface TeamboardFilter {
  /** awork-Projekttypen, z. B. "Website-Support". */
  projektArten: string[];
  /** Der bestehende Einzelprojekt-Filter (awork-Projekt-ID) — null = alle. */
  projekt: string | null;
  /** ueberfaellig | heute | woche | ohneTermin */
  faelligkeit: string[];
  /** Aufgaben-statusTyp: todo | progress | review | stuck */
  status: string[];
  /** awork-Arbeitsarten, z. B. "Projektarbeit". */
  arbeitsarten: string[];
  nurPrio: boolean;
  /** Nur Aufgaben aus Projekten mit Projekt-Status-Typ "progress". */
  nurLaufendeProjekte: boolean;
}

export interface TeamboardEinstellungen {
  reihenfolge: string[] | null;
  ausgeblendet: string[];
  filter: TeamboardFilter;
}

interface TeamboardEinstellungenRow {
  user_id: string;
  reihenfolge: string | null;
  ausgeblendet: string | null;
  filter: string | null;
  updated_at: string;
}

/**
 * "Kein Filter aktiv" — zugleich die Migration für Einstellungen aus der
 * Zeit vor der Filterleiste (Spalte filter NULL) und der Default für neue
 * Nutzer. Eingefroren, damit dieser Vergleichswert nicht versehentlich zur
 * geteilten Arbeitskopie wird; ausgeliefert werden ausschließlich frische
 * Objekte aus leererFilter().
 */
export const LEERER_FILTER: TeamboardFilter = Object.freeze({
  projektArten: Object.freeze([]) as unknown as string[],
  projekt: null,
  faelligkeit: Object.freeze([]) as unknown as string[],
  status: Object.freeze([]) as unknown as string[],
  arbeitsarten: Object.freeze([]) as unknown as string[],
  nurPrio: false,
  nurLaufendeProjekte: false,
});

export function leererFilter(): TeamboardFilter {
  return {
    projektArten: [],
    projekt: null,
    faelligkeit: [],
    status: [],
    arbeitsarten: [],
    nurPrio: false,
    nurLaufendeProjekte: false,
  };
}

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

function stringListe(wert: unknown): string[] | null {
  if (!Array.isArray(wert)) return null;
  return wert.every((v) => typeof v === 'string') ? (wert as string[]) : null;
}

/**
 * Parst das gespeicherte Filter-JSON feldweise gegen den leeren Filter.
 * Feldweise statt als Ganzes, damit drei Fälle ohne Sonderweg zusammenfallen:
 * die Spalte fehlt noch (alte Zeile ⇒ null), das JSON ist kaputt, und ein
 * später dazugekommenes Feld steht in einer älteren Zeile noch nicht drin.
 * In allen dreien bleibt der Rest der Einstellungen erhalten — ein Nutzer
 * darf seine Lane-Reihenfolge nicht verlieren, weil ein Filter-Feld hakt.
 */
function parseFilter(json: string | null): TeamboardFilter {
  const filter = leererFilter();
  if (json === null) return filter;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return filter;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return filter;
  const f = parsed as Record<string, unknown>;
  filter.projektArten = stringListe(f.projektArten) ?? filter.projektArten;
  filter.projekt = typeof f.projekt === 'string' ? f.projekt : null;
  filter.faelligkeit = stringListe(f.faelligkeit) ?? filter.faelligkeit;
  filter.status = stringListe(f.status) ?? filter.status;
  filter.arbeitsarten = stringListe(f.arbeitsarten) ?? filter.arbeitsarten;
  filter.nurPrio = f.nurPrio === true;
  filter.nurLaufendeProjekte = f.nurLaufendeProjekte === true;
  return filter;
}

function toEinstellungen(row: TeamboardEinstellungenRow): TeamboardEinstellungen {
  return {
    reihenfolge: parseArray(row.reihenfolge, null),
    ausgeblendet: parseArray(row.ausgeblendet, []),
    filter: parseFilter(row.filter ?? null),
  };
}

// ─── Store ───────────────────────────────────────────────────────

export class TeamboardEinstellungenStore {
  constructor(private db: DatabaseSync) {}

  get(userId: string): TeamboardEinstellungen {
    const row = this.db.prepare(
      'SELECT * FROM teamboard_einstellungen WHERE user_id = ?',
    ).get(userId) as TeamboardEinstellungenRow | undefined;
    return row ? toEinstellungen(row) : { reihenfolge: null, ausgeblendet: [], filter: leererFilter() };
  }

  set(userId: string, e: TeamboardEinstellungen): void {
    this.db.prepare(
      `INSERT INTO teamboard_einstellungen (user_id, reihenfolge, ausgeblendet, filter, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         reihenfolge = excluded.reihenfolge,
         ausgeblendet = excluded.ausgeblendet,
         filter = excluded.filter,
         updated_at = excluded.updated_at`,
    ).run(
      userId,
      e.reihenfolge === null ? null : JSON.stringify(e.reihenfolge),
      JSON.stringify(e.ausgeblendet),
      JSON.stringify(e.filter),
      new Date().toISOString(),
    );
  }
}
