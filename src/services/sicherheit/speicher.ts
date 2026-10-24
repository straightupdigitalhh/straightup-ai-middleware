import { randomUUID } from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import { todayInBerlin } from '../workdays.js';

// ─── Speicher der Sicherheitsplattform (Teil 1) ──────────────────
//
// Drei Tabellen (Migration v5 in core/db.ts):
//  - sicherheit_stand: eine Zeile, der letzte Stand, den der Wachdienst
//    geschickt hat. Die Middleware reicht ihn unverändert weiter; der Inhalt
//    gehört dem Kern (Format: wachdienst/stand.ts im Repo agents).
//  - sicherheit_kennzahlen: je Berliner Tag die Kennzahlen des letzten Stands
//    dieses Tages, 30 Tage zurück (für Verläufe in späteren Teilen).
//  - sicherheit_auftraege: Aufträge aus dem Dashboard. Der Kern holt die
//    offenen ab, wendet sie an und quittiert; die Quittung setzt den Status.

/** Die Auftragsarten, die der Kern kennt (wachdienst/typen.ts, Auftrag). */
export const AUFTRAG_ARTEN = [
  'erledigt', 'stumm', 'stimmt', 'kein-hack', 'stufe', 'merker', 'nicht-ueberwacht', 'ueberwachen', 'durchgesehen',
] as const;
export type AuftragArt = (typeof AUFTRAG_ARTEN)[number];
export type AuftragStatus = 'offen' | 'angewandt' | 'fehler';

/** Ein Auftrag genau in der Form, die der Kern erwartet. `typ` fehlt, wo die Art keinen braucht. */
export interface Auftrag {
  id: string;
  art: AuftragArt;
  site: string;
  typ?: string;
  werte: Record<string, unknown>;
  durch: string;
  erstelltIso: string;
}

/** Der Auftrag im Verlauf des Dashboards: dazu Status und, wenn der Kern quittiert hat, sein Text und die Zeit. */
export interface AuftragImVerlauf extends Auftrag {
  status: AuftragStatus;
  quittungText: string | null;
  quittiertIso: string | null;
}

export interface NeuerAuftrag {
  art: AuftragArt;
  site: string;
  typ?: string;
  werte: Record<string, unknown>;
  durch: string;
}

/** Heute und so viele Tage davor bleiben die Kennzahlen; ältere werden beim Speichern gelöscht. */
const KENNZAHLEN_TAGE = 30;
/** So viele Aufträge liefert der Verlauf höchstens (die jüngsten). */
const VERLAUF_MAX = 200;
/** Längere Quittungstexte werden gekürzt, nicht abgelehnt: Der Kern hat den Auftrag schon angewandt und gemerkt. */
const QUITTUNG_TEXT_MAX = 4000;

interface AuftragRow {
  id: string;
  art: AuftragArt;
  site: string;
  typ: string | null;
  werte: string;
  durch: string;
  erstellt: string;
  status: AuftragStatus;
  quittung_text: string | null;
  quittiert: string | null;
}

const istObjekt = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Der Kalendertag `tage` Tage vor `tag` (beide JJJJ-MM-TT); über den Mittag gerechnet, damit keine Zeitumstellung stört. */
function tagVor(tag: string, tage: number): string {
  const d = new Date(`${tag}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - tage);
  return d.toISOString().slice(0, 10);
}

function toAuftrag(row: AuftragRow): Auftrag {
  return {
    id: row.id,
    art: row.art,
    site: row.site,
    ...(row.typ === null ? {} : { typ: row.typ }),
    werte: JSON.parse(row.werte) as Record<string, unknown>,
    durch: row.durch,
    erstelltIso: row.erstellt,
  };
}

function toVerlauf(row: AuftragRow): AuftragImVerlauf {
  return { ...toAuftrag(row), status: row.status, quittungText: row.quittung_text, quittiertIso: row.quittiert };
}

// ─── Store ───────────────────────────────────────────────────────

export class SicherheitSpeicher {
  constructor(private db: DatabaseSync) {}

  /**
   * Ersetzt den aktuellen Stand und merkt die Kennzahlen des Berliner Tages
   * (der letzte Stand eines Tages gilt). Gelöscht wird, was älter ist als
   * KENNZAHLEN_TAGE. Hat der Stand keine Kennzahlen, bleibt es beim Ersetzen.
   */
  speichereStand(stand: Record<string, unknown>, jetzt: Date = new Date()): void {
    const empfangen = jetzt.toISOString();
    const heute = todayInBerlin(jetzt);
    this.db.exec('BEGIN');
    try {
      this.db.prepare(
        `INSERT INTO sicherheit_stand (id, stand, empfangen) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET stand = excluded.stand, empfangen = excluded.empfangen`,
      ).run(JSON.stringify(stand), empfangen);
      if (istObjekt(stand.kennzahlen)) {
        this.db.prepare(
          `INSERT INTO sicherheit_kennzahlen (tag, kennzahlen, empfangen) VALUES (?, ?, ?)
           ON CONFLICT(tag) DO UPDATE SET kennzahlen = excluded.kennzahlen, empfangen = excluded.empfangen`,
        ).run(heute, JSON.stringify(stand.kennzahlen), empfangen);
      }
      this.db.prepare('DELETE FROM sicherheit_kennzahlen WHERE tag < ?').run(tagVor(heute, KENNZAHLEN_TAGE));
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /** Der letzte Stand mit dem Zeitpunkt, zu dem er hier ankam; null, solange noch keiner da war. */
  aktuellerStand(): { stand: Record<string, unknown>; empfangenIso: string } | null {
    const row = this.db.prepare('SELECT stand, empfangen FROM sicherheit_stand WHERE id = 1')
      .get() as { stand: string; empfangen: string } | undefined;
    return row ? { stand: JSON.parse(row.stand) as Record<string, unknown>, empfangenIso: row.empfangen } : null;
  }

  /** Die gemerkten Kennzahlen je Berliner Tag, ältester zuerst. */
  kennzahlenVerlauf(): { tag: string; kennzahlen: Record<string, unknown> }[] {
    const rows = this.db.prepare('SELECT tag, kennzahlen FROM sicherheit_kennzahlen ORDER BY tag')
      .all() as unknown as { tag: string; kennzahlen: string }[];
    return rows.map((r) => ({ tag: r.tag, kennzahlen: JSON.parse(r.kennzahlen) as Record<string, unknown> }));
  }

  /** Legt einen Auftrag mit Status offen an und liefert seine ID (eine UUID, nie wieder vergeben). */
  legeAuftragAn(a: NeuerAuftrag, jetzt: Date = new Date()): string {
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO sicherheit_auftraege (id, art, site, typ, werte, durch, erstellt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, a.art, a.site, a.typ ?? null, JSON.stringify(a.werte), a.durch, jetzt.toISOString());
    return id;
  }

  /** Die Aufträge, die der Kern noch nicht quittiert hat, der älteste zuerst. */
  offeneAuftraege(): Auftrag[] {
    const rows = this.db.prepare(
      `SELECT * FROM sicherheit_auftraege WHERE status = 'offen' ORDER BY erstellt, rowid`,
    ).all() as unknown as AuftragRow[];
    return rows.map(toAuftrag);
  }

  /**
   * Setzt Status und Quittung eines offenen Auftrags: ok angewandt, sonst
   * fehler. Die erste Quittung gilt; eine weitere zur selben ID ändert nichts
   * (der Kern quittiert doppelt gelieferte Aufträge erneut).
   */
  quittiere(id: string, ok: boolean, text: string, jetzt: Date = new Date()): 'neu' | 'schon_quittiert' | 'unbekannt' {
    const ergebnis = this.db.prepare(
      `UPDATE sicherheit_auftraege SET status = ?, quittung_text = ?, quittiert = ?
       WHERE id = ? AND status = 'offen'`,
    ).run(ok ? 'angewandt' : 'fehler', text.slice(0, QUITTUNG_TEXT_MAX), jetzt.toISOString(), id);
    if (Number(ergebnis.changes) > 0) return 'neu';
    return this.db.prepare('SELECT 1 FROM sicherheit_auftraege WHERE id = ?').get(id) ? 'schon_quittiert' : 'unbekannt';
  }

  /** Der Verlauf für das Dashboard: Aufträge ab `seitIso` (einschließlich, nach Erstellung), die jüngsten zuerst, höchstens VERLAUF_MAX. */
  verlauf(opts: { seitIso?: string } = {}): AuftragImVerlauf[] {
    const rows = (opts.seitIso === undefined
      ? this.db.prepare(`SELECT * FROM sicherheit_auftraege ORDER BY erstellt DESC, rowid DESC LIMIT ${VERLAUF_MAX}`).all()
      : this.db.prepare(
        `SELECT * FROM sicherheit_auftraege WHERE erstellt >= ? ORDER BY erstellt DESC, rowid DESC LIMIT ${VERLAUF_MAX}`,
      ).all(opts.seitIso)) as unknown as AuftragRow[];
    return rows.map(toVerlauf);
  }
}
