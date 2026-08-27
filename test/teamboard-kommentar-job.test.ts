import { describe, it, expect } from 'vitest';
import { openDb } from '../src/core/db.js';
import { Scheduler } from '../src/core/scheduler.js';
import {
  erstelleKommentarAutomation,
  erstelleLaufAufraeumAutomation,
  AUFRAEUM_GRENZE_TAGE,
} from '../src/services/teamboard/kommentar-automation.js';

// ─── Kommentar-Automation ─────────────────────────────────────────

describe('erstelleKommentarAutomation', () => {
  function registriere(dienst: {
    schreibeFaelligeKommentare(): Promise<{ geschrieben: number; fehlgeschlagen: number }>;
  }): Scheduler {
    const scheduler = new Scheduler(openDb(':memory:'));
    scheduler.register(erstelleKommentarAutomation(dienst));
    return scheduler;
  }

  it('registriert sich mit der erwarteten Konfiguration (jede Minute, standardmäßig an)', () => {
    const scheduler = registriere({
      schreibeFaelligeKommentare: async () => ({ geschrieben: 0, fehlgeschlagen: 0 }),
    });
    const status = scheduler.statusOf('teamboard-kommentare');
    expect(status.name).toBe('Teamboard-Zurechnungen');
    expect(status.cron).toBe('* * * * *');
    expect(status.enabled).toBe(true);
  });

  it('meldet geschriebene und fehlgeschlagene Kommentare', async () => {
    const scheduler = registriere({
      schreibeFaelligeKommentare: async () => ({ geschrieben: 2, fehlgeschlagen: 0 }),
    });
    const run = await scheduler.trigger('teamboard-kommentare', 'manual').done;
    expect(run.status).toBe('ok');
    expect(run.summary).toBe('2 Kommentare geschrieben, 0 fehlgeschlagen');
    expect(run.log).toContain('2 Kommentare geschrieben, 0 fehlgeschlagen');
  });

  it('meldet 0 fällige Kommentare ohne Fehler', async () => {
    const scheduler = registriere({
      schreibeFaelligeKommentare: async () => ({ geschrieben: 0, fehlgeschlagen: 0 }),
    });
    const run = await scheduler.trigger('teamboard-kommentare', 'manual').done;
    expect(run.status).toBe('ok');
    expect(run.summary).toBe('0 Kommentare geschrieben, 0 fehlgeschlagen');
  });
});

// ─── Aufräumen der Lauf-Protokolle ────────────────────────────────

describe('erstelleLaufAufraeumAutomation', () => {
  it('registriert sich mit der erwarteten Konfiguration (nachts, standardmäßig an)', () => {
    const scheduler = new Scheduler(openDb(':memory:'));
    scheduler.register(erstelleLaufAufraeumAutomation({ loescheAlteLaeufe: () => 0 }));
    const status = scheduler.statusOf('automation-runs-aufraeumen');
    expect(status.cron).toBe('17 3 * * *');
    expect(status.enabled).toBe(true);
  });

  it('ruft loescheAlteLaeufe auf und meldet die Zahl gelöschter Zeilen', async () => {
    const scheduler = new Scheduler(openDb(':memory:'));
    let aufgerufenMit: number | undefined;
    scheduler.register(
      erstelleLaufAufraeumAutomation({
        loescheAlteLaeufe: (tage) => {
          aufgerufenMit = tage;
          return 5;
        },
      }),
    );
    const run = await scheduler.trigger('automation-runs-aufraeumen', 'manual').done;
    expect(run.status).toBe('ok');
    expect(run.summary).toBe('5 alte Lauf-Protokolle gelöscht');
    expect(aufgerufenMit).toBe(AUFRAEUM_GRENZE_TAGE);
  });
});
