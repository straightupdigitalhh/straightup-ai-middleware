import type {
  LaufenderTimer,
  OffeneAufgabe,
  TeamboardNutzer,
} from "../awork.js";

/**
 * Anzeige-Zustand eines laufenden Timers: verstrichene Netto-Sekunden
 * (ohne Pausen) und ob er gerade pausiert ist. Bei offener Pause steht die
 * Uhr auf dem Stand des Pausenbeginns.
 */
export function timerAnzeige(
  timer: LaufenderTimer,
  jetzt: Date
): { sekunden: number; pausiert: boolean } {
  const startMs = Date.parse(timer.startUtc);
  const offenePause = timer.pausen.find((p) => p.endeUtc === null);
  const abgeschlossenSekunden = timer.pausen
    .filter((p) => p.endeUtc !== null)
    .reduce((summe, p) => summe + p.dauerSekunden, 0);
  const endeMs = offenePause ? Date.parse(offenePause.startUtc) : jetzt.getTime();
  const sekunden = Math.max(0, Math.floor((endeMs - startMs) / 1000) - abgeschlossenSekunden);
  return { sekunden, pausiert: offenePause !== undefined };
}

export interface TimerKarte {
  aufgabenName: string | null;
  aufgabenKennung: string | null;
  projektName: string | null;
  projektId: string | null;
  sekunden: number;
  pausiert: boolean;
}

export interface AufgabenKarte {
  id: string;
  name: string;
  kennung: string | null;
  projektName: string | null;
  projektId: string | null;
  statusName: string;
  statusTyp: string;
  faelligAm: string | null;
  istPrio: boolean;
  ueberfaellig: boolean;
}

export interface Lane {
  userId: string;
  name: string; // "Lea Stöber", bei fehlendem Nachnamen nur "Gabi"
  timer: TimerKarte | null;
  aufgaben: AufgabenKarte[]; // vollständig — die 10er-Grenze ist reine Anzeige-Logik der Seite
}

export interface Board {
  stand: string; // ISO-Zeitpunkt des Board-Baus
  lanes: Lane[];
}

export function baueBoard(eingabe: {
  nutzer: TeamboardNutzer[];
  timer: LaufenderTimer[];
  aufgaben: OffeneAufgabe[];
  jetzt: Date;
  heute: string; // "YYYY-MM-DD" in Europe/Berlin — für die Überfällig-Markierung
}): Board {
  const lanes = eingabe.nutzer
    .sort((a, b) => a.vorname.localeCompare(b.vorname, "de"))
    .map((n) => {
      const laufend = eingabe.timer.find((t) => t.userId === n.id);
      const aufgaben = eingabe.aufgaben
        .filter((a) => a.assigneeIds.includes(n.id))
        .map((a) => ({
          id: a.id,
          name: a.name,
          kennung: a.kennung,
          projektName: a.projektName,
          projektId: a.projektId,
          statusName: a.statusName,
          statusTyp: a.statusTyp,
          faelligAm: a.faelligAm,
          istPrio: a.istPrio,
          // Datums-Vergleich auf Tagesbasis: dueOn ist ein UTC-Mitternachts-
          // Stempel, "heute" kommt als Berlin-Kalendertag herein.
          ueberfaellig: a.faelligAm !== null && a.faelligAm.slice(0, 10) < eingabe.heute,
        }))
        .sort(vergleicheAufgaben);
      return {
        userId: n.id,
        name: `${n.vorname} ${n.nachname}`.trim(),
        timer: laufend
          ? {
              aufgabenName: laufend.aufgabenName,
              aufgabenKennung: laufend.aufgabenKennung,
              projektName: laufend.projektName,
              projektId: laufend.projektId,
              ...timerAnzeige(laufend, eingabe.jetzt),
            }
          : null,
        aufgaben,
      };
    });
  return { stand: eingabe.jetzt.toISOString(), lanes };
}

/**
 * Fälligkeit aufsteigend zuerst, ohne Datum zuletzt; bei gleichem Datum (und
 * unter den datumslosen) istPrio zuerst, danach stabile Reihenfolge (Array.
 * sort ist stabil — die Bestands-Reihenfolge bleibt für den Rest erhalten).
 * Auf Jans Wunsch nach der Abnahme (26.08.2026): die frühere Progress-
 * Gruppierung ("In Bearbeitung" zuerst) entfällt — der laufende Timer zeigt
 * ohnehin, woran gerade gearbeitet wird.
 */
function vergleicheAufgaben(a: AufgabenKarte, b: AufgabenKarte): number {
  const fa = a.faelligAm ?? "9999-12-31";
  const fb = b.faelligAm ?? "9999-12-31";
  if (fa !== fb) return fa < fb ? -1 : 1;
  if (a.istPrio !== b.istPrio) return a.istPrio ? -1 : 1;
  return 0;
}
