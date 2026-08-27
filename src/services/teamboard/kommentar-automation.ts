import type { AutomationDefinition } from '../../core/scheduler.js';

// ─── Zurechnungs-Kommentare ───────────────────────────────────────

/**
 * Schreibt für erledigte Aufgaben den awork-Zurechnungskommentar, sobald das
 * Undo-Fenster abgelaufen ist. Läuft jede Minute, damit der Kommentar kurz
 * nach Ablauf des (kurzen) Undo-Fensters steht.
 */
export function erstelleKommentarAutomation(dienst: {
  schreibeFaelligeKommentare(): Promise<{ geschrieben: number; fehlgeschlagen: number }>;
}): AutomationDefinition {
  return {
    id: 'teamboard-kommentare',
    name: 'Teamboard-Zurechnungen',
    description:
      'Schreibt für erledigte Aufgaben den awork-Kommentar im Namen der Person, sobald das Undo-Fenster abgelaufen ist',
    defaultCron: '* * * * *',
    enabledByDefault: true,
    async run(ctx) {
      const { geschrieben, fehlgeschlagen } = await dienst.schreibeFaelligeKommentare();
      const text = `${geschrieben} Kommentare geschrieben, ${fehlgeschlagen} fehlgeschlagen`;
      ctx.log(text);
      return text;
    },
  };
}

// ─── Aufräumen der Lauf-Protokolle ────────────────────────────────

/**
 * Zeilen in automation_runs, die älter sind, werden gelöscht. Die
 * Kommentar-Automation oben läuft jede Minute — ohne dieses Aufräumen
 * wüchse automation_runs um ~525.000 Zeilen im Jahr, denn der Scheduler
 * legt für jeden Lauf eine Zeile an (scheduler.ts, trigger()).
 *
 * 30 Tage sind eine bewusste Wahl, kein Platzhalter: bei minütlichem Takt
 * sind das ~1.440 Zeilen pro Tag bzw. ~43.000 für den gesamten Zeitraum —
 * für SQLite unproblematisch und mehr als die übliche Aufbewahrung
 * („was lief letzte Woche/letzten Monat") für die Status-Ansicht im Hub
 * braucht. Exportiert, damit Tests denselben Wert referenzieren statt ihn
 * zu duplizieren.
 */
export const AUFRAEUM_GRENZE_TAGE = 30;

/** Läuft nachts, weit außerhalb der Geschäftszeiten. */
export function erstelleLaufAufraeumAutomation(scheduler: {
  loescheAlteLaeufe(aelterAlsTage: number): number;
}): AutomationDefinition {
  return {
    id: 'automation-runs-aufraeumen',
    name: 'Automation-Läufe aufräumen',
    description: `Löscht Lauf-Protokolle (automation_runs), die älter als ${AUFRAEUM_GRENZE_TAGE} Tage sind`,
    defaultCron: '17 3 * * *',
    enabledByDefault: true,
    async run(ctx) {
      const geloescht = scheduler.loescheAlteLaeufe(AUFRAEUM_GRENZE_TAGE);
      const text = `${geloescht} alte Lauf-Protokolle gelöscht`;
      ctx.log(text);
      return text;
    },
  };
}
