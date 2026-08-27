import { Cron } from 'croner';
import { DatabaseSync } from 'node:sqlite';

// ─── Automations-Framework ───────────────────────────────────────
//
// Automationen sind im Code registrierte Definitionen (id, run-Funktion);
// Zustand (an/aus, Cron, Settings) liegt in der DB und ist zur Laufzeit
// änderbar. Jeder Lauf erzeugt einen automation_runs-Datensatz – die
// Datenbasis für die Status-Ansicht im Hub.

export const TIMEZONE = 'Europe/Berlin';
const MAX_LOG_LENGTH = 64 * 1024;

export interface RunContext {
  log(message: string): void;
  settings: Record<string, unknown>;
}

export interface AutomationDefinition {
  id: string;
  name: string;
  description: string;
  /** null = nur manuell auslösbar */
  defaultCron: string | null;
  /** true = beim ersten Registrieren direkt aktiv (z. B. Housekeeping) */
  enabledByDefault?: boolean;
  run(ctx: RunContext): Promise<string>;
}

export interface AutomationRun {
  id: number;
  automationId: string;
  trigger: 'schedule' | 'manual';
  status: 'running' | 'ok' | 'error';
  startedAt: string;
  finishedAt: string | null;
  summary: string | null;
  error: string | null;
  log: string;
}

export interface AutomationStatus {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  cron: string | null;
  running: boolean;
  nextRunAt: string | null;
  lastRun: Omit<AutomationRun, 'log'> | null;
}

export function isValidCron(expr: string): boolean {
  try {
    new Cron(expr, { paused: true }).stop();
    return true;
  } catch {
    return false;
  }
}

interface RunRow {
  id: number;
  automation_id: string;
  trigger: 'schedule' | 'manual';
  status: 'running' | 'ok' | 'error';
  started_at: string;
  finished_at: string | null;
  summary: string | null;
  error: string | null;
  log: string;
}

function toRun(row: RunRow): AutomationRun {
  return {
    id: row.id,
    automationId: row.automation_id,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    summary: row.summary,
    error: row.error,
    log: row.log,
  };
}

export class Scheduler {
  private definitions = new Map<string, AutomationDefinition>();
  private jobs = new Map<string, Cron>();
  private runningIds = new Set<string>();
  private started = false;

  constructor(private db: DatabaseSync) {}

  /** Definition registrieren; Config-Zeile entsteht beim ersten Mal mit Defaults. */
  register(def: AutomationDefinition): void {
    if (this.definitions.has(def.id)) {
      throw new Error(`Automation "${def.id}" ist bereits registriert`);
    }
    this.definitions.set(def.id, def);
    this.db.prepare(
      `INSERT OR IGNORE INTO automation_config (id, enabled, cron, settings, updated_at)
       VALUES (?, ?, ?, '{}', ?)`,
    ).run(def.id, def.enabledByDefault ? 1 : 0, def.defaultCron, new Date().toISOString());
    if (this.started) this.reschedule(def.id);
  }

  start(): void {
    this.started = true;
    // Abgebrochene Läufe aus einem harten Neustart als Fehler abschließen
    this.db.prepare(
      `UPDATE automation_runs SET status = 'error', finished_at = ?,
       error = 'Abgebrochen (Neustart der Middleware während des Laufs)'
       WHERE status = 'running'`,
    ).run(new Date().toISOString());
    for (const id of this.definitions.keys()) this.reschedule(id);
    const active = [...this.jobs.keys()];
    console.log(`⏰ Scheduler gestartet – ${active.length} aktive Automation(en)${active.length ? `: ${active.join(', ')}` : ''}`);
  }

  stop(): void {
    this.started = false;
    for (const job of this.jobs.values()) job.stop();
    this.jobs.clear();
  }

  private getConfig(id: string): { enabled: boolean; cron: string | null; settings: Record<string, unknown> } {
    const row = this.db.prepare('SELECT enabled, cron, settings FROM automation_config WHERE id = ?')
      .get(id) as { enabled: number; cron: string | null; settings: string } | undefined;
    if (!row) throw new Error(`Automation "${id}" hat keine Config`);
    let settings: Record<string, unknown> = {};
    try { settings = JSON.parse(row.settings); } catch { /* defekte Settings → leeres Objekt */ }
    return { enabled: row.enabled === 1, cron: row.cron, settings };
  }

  private reschedule(id: string): void {
    this.jobs.get(id)?.stop();
    this.jobs.delete(id);
    if (!this.started) return;
    const config = this.getConfig(id);
    if (!config.enabled || !config.cron) return;
    const job = new Cron(config.cron, { timezone: TIMEZONE, catch: true }, () => {
      void this.trigger(id, 'schedule');
    });
    this.jobs.set(id, job);
  }

  /**
   * Lauf starten. Der Run-Datensatz entsteht sofort (runId), die Ausführung
   * läuft asynchron; `done` resolved immer (Fehler landen im Run-Datensatz).
   */
  trigger(id: string, trigger: 'schedule' | 'manual'): { runId: number; done: Promise<AutomationRun> } {
    const def = this.definitions.get(id);
    if (!def) throw new Error(`Automation "${id}" ist nicht registriert`);
    if (this.runningIds.has(id)) {
      throw new Error(`Automation "${id}" läuft bereits`);
    }
    this.runningIds.add(id);

    const startedAt = new Date().toISOString();
    const result = this.db.prepare(
      `INSERT INTO automation_runs (automation_id, trigger, status, started_at)
       VALUES (?, ?, 'running', ?)`,
    ).run(id, trigger, startedAt);
    const runId = Number(result.lastInsertRowid);

    const done = this.execute(def, runId).finally(() => {
      this.runningIds.delete(id);
    });
    return { runId, done };
  }

  private async execute(def: AutomationDefinition, runId: number): Promise<AutomationRun> {
    const lines: string[] = [];
    const ctx: RunContext = {
      log: (message: string) => {
        lines.push(`${new Date().toISOString()} ${message}`);
        console.log(`   [${def.id}] ${message}`);
      },
      settings: this.getConfig(def.id).settings,
    };

    console.log(`▶️  Automation "${def.id}" gestartet (Run ${runId})`);
    let status: 'ok' | 'error' = 'ok';
    let summary: string | null = null;
    let error: string | null = null;
    try {
      summary = await def.run(ctx);
      console.log(`✅ Automation "${def.id}" fertig: ${summary}`);
    } catch (e: any) {
      status = 'error';
      error = e?.message || String(e);
      console.error(`❌ Automation "${def.id}" fehlgeschlagen: ${error}`);
    }

    this.db.prepare(
      `UPDATE automation_runs SET status = ?, finished_at = ?, summary = ?, error = ?, log = ?
       WHERE id = ?`,
    ).run(status, new Date().toISOString(), summary, error, lines.join('\n').slice(0, MAX_LOG_LENGTH), runId);

    return this.getRun(runId)!;
  }

  setConfig(id: string, patch: { enabled?: boolean; cron?: string | null }): AutomationStatus {
    if (!this.definitions.has(id)) throw new Error(`Automation "${id}" ist nicht registriert`);
    if (patch.cron != null && !isValidCron(patch.cron)) {
      throw new Error(`Ungültiger Cron-Ausdruck: "${patch.cron}"`);
    }
    const current = this.getConfig(id);
    const enabled = patch.enabled ?? current.enabled;
    const cron = patch.cron === undefined ? current.cron : patch.cron;
    this.db.prepare('UPDATE automation_config SET enabled = ?, cron = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, cron, new Date().toISOString(), id);
    this.reschedule(id);
    return this.statusOf(id);
  }

  getSettings(id: string): Record<string, unknown> {
    return this.getConfig(id).settings;
  }

  setSettings(id: string, settings: Record<string, unknown>): void {
    if (!this.definitions.has(id)) throw new Error(`Automation "${id}" ist nicht registriert`);
    this.db.prepare('UPDATE automation_config SET settings = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(settings), new Date().toISOString(), id);
  }

  getRun(runId: number): AutomationRun | undefined {
    const row = this.db.prepare('SELECT * FROM automation_runs WHERE id = ?').get(runId) as RunRow | undefined;
    return row ? toRun(row) : undefined;
  }

  listRuns(id: string, limit = 20): AutomationRun[] {
    const rows = this.db.prepare(
      'SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY id DESC LIMIT ?',
    ).all(id, limit) as unknown as RunRow[];
    return rows.map(toRun);
  }

  /**
   * Löscht Lauf-Protokolle, deren Start länger als `aelterAlsTage` zurückliegt.
   * Ohne dieses Aufräumen wüchse automation_runs unbegrenzt, sobald eine
   * Automation minütlich läuft (jeder Lauf legt eine Zeile an, `trigger`).
   * Gibt die Zahl gelöschter Zeilen zurück.
   */
  loescheAlteLaeufe(aelterAlsTage: number, jetzt?: Date): number {
    const grenze = new Date((jetzt ?? new Date()).getTime() - aelterAlsTage * 24 * 60 * 60 * 1000);
    const result = this.db.prepare('DELETE FROM automation_runs WHERE started_at <= ?').run(grenze.toISOString());
    return Number(result.changes);
  }

  statusOf(id: string): AutomationStatus {
    const def = this.definitions.get(id);
    if (!def) throw new Error(`Automation "${id}" ist nicht registriert`);
    const config = this.getConfig(id);
    const job = this.jobs.get(id);
    const lastRow = this.db.prepare(
      `SELECT id, automation_id, trigger, status, started_at, finished_at, summary, error, ''
       AS log FROM automation_runs WHERE automation_id = ? ORDER BY id DESC LIMIT 1`,
    ).get(id) as RunRow | undefined;
    const lastRun = lastRow ? toRun(lastRow) : null;
    if (lastRun) delete (lastRun as any).log;
    return {
      id: def.id,
      name: def.name,
      description: def.description,
      enabled: config.enabled,
      cron: config.cron,
      running: this.runningIds.has(id),
      nextRunAt: job?.nextRun()?.toISOString() ?? null,
      lastRun: lastRun as Omit<AutomationRun, 'log'> | null,
    };
  }

  status(): AutomationStatus[] {
    return [...this.definitions.keys()].map(id => this.statusOf(id));
  }

  has(id: string): boolean {
    return this.definitions.has(id);
  }
}
