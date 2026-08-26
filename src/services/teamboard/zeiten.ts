import type { AworkClient, AworkTimeEntry, LaufenderTimer } from "../awork.js";
import { timerAnzeige } from "./board.js";
import { previousWorkday, todayInBerlin } from "../workdays.js";

export interface ZeitSummen {
  heuteSekunden: number;
  vortagSekunden: number;
  wocheSekunden: number;
}

/** Schlüssel: awork-User-ID. */
export type ZeitenProNutzer = Record<string, ZeitSummen>;

export type ZeitenLader = () => Promise<ZeitenProNutzer>;

/** Montag der ISO-Woche von "YYYY-MM-DD" (Mo–So-Wochendefinition). */
export function wochenstart(datumLocal: string): string {
  const date = new Date(`${datumLocal}T12:00:00Z`);
  const wochentag = date.getUTCDay(); // 0=So, 1=Mo, …, 6=Sa
  const versatzZuMontag = wochentag === 0 ? 6 : wochentag - 1;
  date.setUTCDate(date.getUTCDate() - versatzZuMontag);
  return date.toISOString().split("T")[0];
}

function leereSummen(): ZeitSummen {
  return { heuteSekunden: 0, vortagSekunden: 0, wocheSekunden: 0 };
}

function summenFuer(ziel: ZeitenProNutzer, userId: string): ZeitSummen {
  let summen = ziel[userId];
  if (!summen) {
    summen = leereSummen();
    ziel[userId] = summen;
  }
  return summen;
}

/**
 * Verteilt abgeschlossene Einträge + laufende Timer auf die drei Töpfe je
 * Nutzer. Das Datumsfeld ist startDateLocal — dasselbe Feld, auf das
 * getTimeEntriesForDay/getTimeEntriesForRange serverseitig filtern (awork:
 * "StartDateLocal").
 */
function baueZeitSummen(eingabe: {
  eintraege: AworkTimeEntry[];
  timer: LaufenderTimer[];
  jetzt: Date;
  heute: string;
  vortag: string;
  wstart: string;
}): ZeitenProNutzer {
  const ergebnis: ZeitenProNutzer = {};
  for (const eintrag of eingabe.eintraege) {
    // Laufende Timer überspringen — exakt die Laufend-Signatur aus
    // getRunningTimers ("endTimeUtc eq null and startTimeUtc ne null").
    // Der Zeiteintrag eines laufenden Timers steckt (mit seiner von awork
    // live gepflegten duration) AUCH in getTimeEntriesForRange; ohne diesen
    // Skip würde er hier UND über timerAnzeige (unten) doppelt gezählt.
    // Manuell gebuchte Dauer-Einträge ohne startTimeUtc bleiben unberührt.
    if (eintrag.endTimeUtc === null && eintrag.startTimeUtc) continue;
    const tag = String(eintrag.startDateLocal ?? "").slice(0, 10);
    const sekunden = eintrag.duration || 0;
    const summen = summenFuer(ergebnis, eintrag.userId);
    if (tag === eingabe.heute) {
      summen.heuteSekunden += sekunden;
      if (tag >= eingabe.wstart) summen.wocheSekunden += sekunden;
    } else if (tag === eingabe.vortag) {
      summen.vortagSekunden += sekunden;
      // Montags-Grenzfall: previousWorkday(Montag) ist der Freitag davor,
      // der VOR dem Wochenstart (Montag) liegt — dieser Vortag zählt dann
      // NICHT in wocheSekunden.
      if (tag >= eingabe.wstart) summen.wocheSekunden += sekunden;
    } else if (tag >= eingabe.wstart) {
      summen.wocheSekunden += sekunden;
    }
  }
  for (const timer of eingabe.timer) {
    const { sekunden } = timerAnzeige(timer, eingabe.jetzt);
    const summen = summenFuer(ergebnis, timer.userId);
    summen.heuteSekunden += sekunden;
    summen.wocheSekunden += sekunden;
  }
  return ergebnis;
}

/**
 * Liefert die Zeitsummen je Nutzer (heute/Vortag/laufende Woche) mit
 * TTL-Cache. Die Mechanik (Cache/Backoff/In-Flight-Dedup, Uhr-Rücksprung-
 * Klammern) ist 1:1 aus erstelleBoardLader (daten.ts) übernommen — bewusst
 * kopiert statt gemeinsam abstrahiert: zwei Lader mit je eigenem Zustand
 * (eigener Cache-Inhalt, eigenes Fehler-Backoff-Fenster), eine gemeinsame
 * Abstraktion für zwei Konsumenten hätte hier nur Kopplung ohne
 * Wiederverwendungs-Gewinn gebracht.
 *
 * Fehler-Semantik EXAKT wie erstelleBoardLader: geworfen wird nur, wenn es
 * noch nie einen Stand gab; existiert ein früherer Stand, wird er als Stale
 * weitergereicht. Backoff-Fenster 1×ttlMs in beiden Fällen.
 *
 * Zwei awork-Reads je Zyklus (getTimeEntriesForRange + getRunningTimers) —
 * dokumentiertes Plan-Ruling Nr. 6, NICHT die Timer des Board-Laders
 * wiederverwenden (getrennter Lader, getrennter Zustand).
 *
 * Anders als in daten.ts (wo heuteBerlin() erst NACH dem awork-Abruf für
 * baueBoard() gebraucht wird) müssen heute/vortag/wstart hier VOR dem Abruf
 * feststehen, weil sie die Abruf-Range bestimmen. Sie bleiben trotzdem
 * außerhalb des try/catch um den awork-Aufruf: ein Fehler dort wäre ein
 * Programmierfehler, kein awork-Ausfall, und darf weder als Stale maskiert
 * werden noch den Fehler-Backoff auslösen.
 */
export function erstelleZeitenLader(opts: {
  awork: Pick<AworkClient, "getTimeEntriesForRange" | "getRunningTimers">;
  ttlMs: number;
  jetztFn?: () => Date;
}): ZeitenLader {
  const jetztFn = opts.jetztFn ?? (() => new Date());
  let cache: { zeiten: ZeitenProNutzer; geholtUmMs: number } | null = null;
  let fehlerBisMs: number | null = null;
  let letzterFehler: unknown = null;
  let laufenderAbruf: Promise<[AworkTimeEntry[], LaufenderTimer[]]> | null = null;
  let abrufStartMs = 0;

  return async function ladeZeiten(): Promise<ZeitenProNutzer> {
    const jetzt = jetztFn();
    const jetztMs = jetzt.getTime();
    if (cache) {
      const alterMs = jetztMs - cache.geholtUmMs;
      // Uhr-Rücksprung-Klammer: ein negatives Alter hieße, der Cache läge in
      // der Zukunft — das darf nicht als Treffer zählen (siehe daten.ts/D3).
      if (alterMs >= 0 && alterMs < opts.ttlMs) {
        return cache.zeiten;
      }
    }
    if (
      fehlerBisMs !== null &&
      jetztMs < fehlerBisMs &&
      // Uhr-Rücksprung-Klammer: liegt jetzt vor der Fehlschlag-Aufzeichnung,
      // wächst das Rest-Fenster über die TTL hinaus — dann als ungültig
      // verwerfen (siehe daten.ts/D3).
      fehlerBisMs - jetztMs <= opts.ttlMs
    ) {
      if (cache) {
        return cache.zeiten;
      }
      throw letzterFehler;
    }

    const heute = todayInBerlin(jetzt);
    const vortag = previousWorkday(heute);
    const wstart = wochenstart(heute);
    const from = vortag < wstart ? vortag : wstart;

    let eintraege: AworkTimeEntry[], timer: LaufenderTimer[];
    try {
      if (!laufenderAbruf) {
        // Startzeitpunkt des geteilten Abrufs selbst festhalten (D2) — nicht
        // die Ankunftszeit irgendeines Joiners (siehe daten.ts).
        abrufStartMs = jetztMs;
        laufenderAbruf = Promise.all([
          opts.awork.getTimeEntriesForRange(from, heute),
          opts.awork.getRunningTimers(),
        ])
          .catch((fehler) => {
            // Genau eine Logzeile je tatsächlichem awork-Versuch — nicht je
            // Aufrufer, der sich per In-Flight-Dedup an dieses Promise
            // hängt (D1).
            console.error(
              "teamboard: awork-Laden (Zeitsummen) fehlgeschlagen —",
              fehler instanceof Error ? fehler.message : String(fehler)
            );
            throw fehler;
          })
          .finally(() => {
            laufenderAbruf = null;
          });
      }
      [eintraege, timer] = await laufenderAbruf;
      fehlerBisMs = null;
    } catch (fehler) {
      fehlerBisMs = jetztMs + opts.ttlMs;
      letzterFehler = fehler;
      if (cache) {
        return cache.zeiten;
      }
      throw fehler;
    }

    const zeiten = baueZeitSummen({ eintraege, timer, jetzt, heute, vortag, wstart });
    cache = { zeiten, geholtUmMs: abrufStartMs };
    return zeiten;
  };
}
