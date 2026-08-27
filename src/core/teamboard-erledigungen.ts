import { DatabaseSync } from 'node:sqlite';

// ─── Konstanten ──────────────────────────────────────────────────

/** Zeitfenster, in dem ein „Erledigt"-Klick per Undo zurückgenommen werden kann. */
export const UNDO_FENSTER_MS = 20_000;

/** Nach so vielen fehlgeschlagenen Kommentar-Versuchen gilt ein Vorgang als endgültig gescheitert. */
export const MAX_KOMMENTAR_FEHLVERSUCHE = 5;

// ─── Types ───────────────────────────────────────────────────────

export interface Erledigung {
  id: number;
  taskId: string;
  taskName: string;
  projectId: string;
  alterStatusId: string;
  userId: string;
  aworkUserId: string;
  erledigtAm: string;
  rueckgaengigAm: string | null;
  kommentarAm: string | null;
  fehlversuche: number;
}

interface ErledigungRow {
  id: number;
  task_id: string;
  task_name: string;
  project_id: string;
  alter_status_id: string;
  user_id: string;
  awork_user_id: string;
  erledigt_am: string;
  rueckgaengig_am: string | null;
  kommentar_am: string | null;
  fehlversuche: number;
}

function toErledigung(row: ErledigungRow): Erledigung {
  return {
    id: row.id,
    taskId: row.task_id,
    taskName: row.task_name,
    projectId: row.project_id,
    alterStatusId: row.alter_status_id,
    userId: row.user_id,
    aworkUserId: row.awork_user_id,
    erledigtAm: row.erledigt_am,
    rueckgaengigAm: row.rueckgaengig_am,
    kommentarAm: row.kommentar_am,
    fehlversuche: row.fehlversuche,
  };
}

// ─── Store ───────────────────────────────────────────────────────

export class TeamboardErledigungenStore {
  constructor(private db: DatabaseSync) {}

  anlegen(e: {
    taskId: string;
    taskName: string;
    projectId: string;
    alterStatusId: string;
    userId: string;
    aworkUserId: string;
    jetzt?: Date;
  }): Erledigung {
    const erledigtAm = (e.jetzt ?? new Date()).toISOString();
    const result = this.db.prepare(
      `INSERT INTO teamboard_erledigungen
         (task_id, task_name, project_id, alter_status_id, user_id, awork_user_id, erledigt_am)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(e.taskId, e.taskName, e.projectId, e.alterStatusId, e.userId, e.aworkUserId, erledigtAm);
    return this.finde(Number(result.lastInsertRowid))!;
  }

  finde(id: number): Erledigung | undefined {
    const row = this.db.prepare(
      'SELECT * FROM teamboard_erledigungen WHERE id = ?',
    ).get(id) as ErledigungRow | undefined;
    return row ? toErledigung(row) : undefined;
  }

  markiereRueckgaengig(id: number, jetzt?: Date): void {
    this.db.prepare(
      'UPDATE teamboard_erledigungen SET rueckgaengig_am = ? WHERE id = ?',
    ).run((jetzt ?? new Date()).toISOString(), id);
  }

  /**
   * Ein laufender Vorgang für DIESE Aufgabe: nicht widerrufen, noch nicht kommentiert,
   * unter der Fehlversuchsgrenze. Grundlage des Doppelklick-Schutzes (`laeuft_bereits` in T4).
   * Die Fehlversuchsgrenze MUSS mit hinein: ein endgültig gescheiterter Vorgang behält
   * `kommentar_am = NULL` für immer und würde die Aufgabe sonst dauerhaft blockieren.
   */
  findeOffenenVorgang(taskId: string, maxFehlversuche: number): Erledigung | undefined {
    const row = this.db.prepare(
      `SELECT * FROM teamboard_erledigungen
       WHERE task_id = ? AND rueckgaengig_am IS NULL AND kommentar_am IS NULL AND fehlversuche < ?
       ORDER BY id DESC LIMIT 1`,
    ).get(taskId, maxFehlversuche) as ErledigungRow | undefined;
    return row ? toErledigung(row) : undefined;
  }

  /**
   * Vorgänge, deren Undo-Fenster abgelaufen ist, die nicht widerrufen und noch nicht
   * kommentiert sind und die unter der Fehlversuchsgrenze liegen.
   */
  offeneKommentare(vorMs: number, maxFehlversuche: number, jetzt?: Date): Erledigung[] {
    const grenze = new Date((jetzt ?? new Date()).getTime() - vorMs).toISOString();
    const rows = this.db.prepare(
      `SELECT * FROM teamboard_erledigungen
       WHERE kommentar_am IS NULL AND rueckgaengig_am IS NULL
         AND fehlversuche < ? AND erledigt_am <= ?`,
    ).all(maxFehlversuche, grenze) as unknown as ErledigungRow[];
    return rows.map(toErledigung);
  }

  markiereKommentiert(id: number, jetzt?: Date): void {
    this.db.prepare(
      'UPDATE teamboard_erledigungen SET kommentar_am = ? WHERE id = ?',
    ).run((jetzt ?? new Date()).toISOString(), id);
  }

  /** Zählt einen Fehlversuch hoch; beim Erreichen der Fehlversuchsgrenze wird der Vorgang als endgültig gescheitert geloggt. */
  zaehleFehlversuch(id: number): void {
    this.db.prepare(
      'UPDATE teamboard_erledigungen SET fehlversuche = fehlversuche + 1 WHERE id = ?',
    ).run(id);
    const erledigung = this.finde(id);
    if (erledigung && erledigung.fehlversuche === MAX_KOMMENTAR_FEHLVERSUCHE) {
      console.error(
        `Teamboard-Erledigung ${erledigung.id} (Aufgabe ${erledigung.taskId}) endgültig gescheitert: ` +
          `Kommentar nach ${MAX_KOMMENTAR_FEHLVERSUCHE} Versuchen nicht gesetzt`,
      );
    }
  }
}
