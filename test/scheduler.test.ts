import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/core/db.js';
import { Scheduler, isValidCron } from '../src/core/scheduler.js';

describe('isValidCron', () => {
  it('akzeptiert gültige Ausdrücke', () => {
    expect(isValidCron('55 8 * * 1-5')).toBe(true);
    expect(isValidCron('0 4 * * *')).toBe(true);
  });
  it('lehnt Unsinn ab', () => {
    expect(isValidCron('quatsch')).toBe(false);
    expect(isValidCron('99 99 * * *')).toBe(false);
  });
});

describe('Scheduler', () => {
  let scheduler: Scheduler;

  beforeEach(() => {
    scheduler = new Scheduler(openDb(':memory:'));
  });

  function registerNoop(id = 'demo', run?: () => Promise<string>) {
    scheduler.register({
      id,
      name: 'Demo',
      description: 'Testautomation',
      defaultCron: '0 9 * * 1-5',
      run: run || (async () => 'alles gut'),
    });
  }

  it('register legt Config mit Defaults an (disabled)', () => {
    registerNoop();
    const status = scheduler.statusOf('demo');
    expect(status.enabled).toBe(false);
    expect(status.cron).toBe('0 9 * * 1-5');
    expect(status.lastRun).toBeNull();
  });

  it('doppelte Registrierung wird abgelehnt', () => {
    registerNoop();
    expect(() => registerNoop()).toThrow(/bereits registriert/);
  });

  it('manueller Lauf erzeugt ok-Run mit Summary und Log', async () => {
    scheduler.register({
      id: 'demo',
      name: 'Demo',
      description: '',
      defaultCron: null,
      async run(ctx) {
        ctx.log('Schritt 1');
        ctx.log('Schritt 2');
        return '2 Schritte erledigt';
      },
    });
    const { runId, done } = scheduler.trigger('demo', 'manual');
    const run = await done;
    expect(run.id).toBe(runId);
    expect(run.status).toBe('ok');
    expect(run.summary).toBe('2 Schritte erledigt');
    expect(run.trigger).toBe('manual');
    expect(run.finishedAt).not.toBeNull();
    expect(run.log).toContain('Schritt 1');
    expect(run.log).toContain('Schritt 2');
  });

  it('Fehler im Lauf → error-Run, done rejected nicht', async () => {
    registerNoop('kaputt', async () => { throw new Error('awork explodiert'); });
    const { done } = scheduler.trigger('kaputt', 'manual');
    const run = await done;
    expect(run.status).toBe('error');
    expect(run.error).toBe('awork explodiert');
  });

  it('Überlapp-Schutz: zweiter Trigger während des Laufs wird abgelehnt', async () => {
    let release: () => void;
    const gate = new Promise<void>(r => { release = r; });
    registerNoop('langsam', async () => { await gate; return 'fertig'; });

    const { done } = scheduler.trigger('langsam', 'manual');
    expect(() => scheduler.trigger('langsam', 'manual')).toThrow(/läuft bereits/);
    release!();
    await done;
    // Nach Abschluss wieder möglich
    const second = scheduler.trigger('langsam', 'manual');
    await second.done;
    expect(scheduler.listRuns('langsam')).toHaveLength(2);
  });

  it('setConfig validiert Cron und plant um', () => {
    registerNoop();
    scheduler.start();
    expect(scheduler.statusOf('demo').nextRunAt).toBeNull(); // disabled

    const status = scheduler.setConfig('demo', { enabled: true, cron: '55 8 * * 1-5' });
    expect(status.enabled).toBe(true);
    expect(status.nextRunAt).not.toBeNull();

    expect(() => scheduler.setConfig('demo', { cron: 'quatsch' })).toThrow(/Ungültiger Cron/);

    scheduler.setConfig('demo', { enabled: false });
    expect(scheduler.statusOf('demo').nextRunAt).toBeNull();
    scheduler.stop();
  });

  it('unbekannte Automation → Fehler', () => {
    expect(() => scheduler.trigger('gibtsnicht', 'manual')).toThrow(/nicht registriert/);
    expect(() => scheduler.setConfig('gibtsnicht', { enabled: true })).toThrow(/nicht registriert/);
  });

  it('verwaiste running-Runs werden beim Start als Fehler abgeschlossen', async () => {
    const db = openDb(':memory:');
    const s1 = new Scheduler(db);
    db.prepare(
      `INSERT INTO automation_runs (automation_id, trigger, status, started_at)
       VALUES ('demo', 'schedule', 'running', ?)`,
    ).run(new Date().toISOString());
    s1.register({ id: 'demo', name: 'Demo', description: '', defaultCron: null, run: async () => 'ok' });
    s1.start();
    const runs = s1.listRuns('demo');
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('error');
    expect(runs[0].error).toContain('Neustart');
    s1.stop();
  });

  it('Settings werden gespeichert und im Lauf gereicht', async () => {
    let seen: unknown;
    registerNoop('mit-settings', async () => 'ok');
    scheduler.setSettings('mit-settings', { empfaenger: ['gabi@straightup-digital.de'] });
    expect(scheduler.getSettings('mit-settings')).toEqual({ empfaenger: ['gabi@straightup-digital.de'] });

    scheduler.register({
      id: 'liest-settings', name: '', description: '', defaultCron: null,
      async run(ctx) { seen = ctx.settings; return 'ok'; },
    });
    scheduler.setSettings('liest-settings', { soll: 8 });
    await scheduler.trigger('liest-settings', 'manual').done;
    expect(seen).toEqual({ soll: 8 });
  });

  it('loescheAlteLaeufe löscht Läufe älter als die Grenze, jüngere bleiben stehen', () => {
    const db = openDb(':memory:');
    const s1 = new Scheduler(db);
    const TAG_MS = 24 * 60 * 60 * 1000;
    const jetzt = new Date('2026-08-27T12:00:00.000Z');
    const alt = new Date(jetzt.getTime() - 31 * TAG_MS).toISOString();
    const juenger = new Date(jetzt.getTime() - 29 * TAG_MS).toISOString();
    db.prepare(
      `INSERT INTO automation_runs (automation_id, trigger, status, started_at) VALUES ('demo', 'schedule', 'ok', ?)`,
    ).run(alt);
    db.prepare(
      `INSERT INTO automation_runs (automation_id, trigger, status, started_at) VALUES ('demo', 'schedule', 'ok', ?)`,
    ).run(juenger);

    const geloescht = s1.loescheAlteLaeufe(30, jetzt);

    expect(geloescht).toBe(1);
    const rows = db.prepare('SELECT started_at FROM automation_runs ORDER BY id').all() as { started_at: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].started_at).toBe(juenger);
  });

  it('loescheAlteLaeufe verwendet ohne jetzt-Parameter die aktuelle Zeit', () => {
    const db = openDb(':memory:');
    const s1 = new Scheduler(db);
    const weitWeg = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO automation_runs (automation_id, trigger, status, started_at) VALUES ('demo', 'schedule', 'ok', ?)`,
    ).run(weitWeg);

    expect(s1.loescheAlteLaeufe(30)).toBe(1);
  });
});
