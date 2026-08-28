import type { AworkClient, AworkProjektLeicht } from "../awork.js";
import type { Board } from "./board.js";

/**
 * Was die Filterleiste über ein Projekt wissen muss: seine Art
 * (awork-Projekttyp) und seinen Status-Typ. Beides kann fehlen — nicht
 * jedes Projekt trägt eine Art, und der Status ist Fremddatum aus awork.
 */
export interface ProjektInfo {
  art: string | null;
  status: string | null;
}

/** Schlüssel: awork-Projekt-ID. */
export type ProjekteProId = Record<string, ProjektInfo>;

export type ProjekteLader = () => Promise<ProjekteProId>;

function baueProjektKarte(projekte: AworkProjektLeicht[]): ProjekteProId {
  const ergebnis: ProjekteProId = {};
  for (const p of projekte) {
    ergebnis[p.id] = { art: p.artName, status: p.statusTyp };
  }
  return ergebnis;
}

/**
 * Liefert die Projekt-Stammdaten (Art + Status-Typ) je Projekt-ID mit
 * TTL-Cache. Die Mechanik (Cache/Backoff/In-Flight-Dedup, Uhr-Rücksprung-
 * Klammern) ist — wie schon bei erstelleZeitenLader — 1:1 aus
 * erstelleBoardLader (daten.ts) übernommen: bewusst kopiert statt gemeinsam
 * abstrahiert, weil jeder Lader seinen eigenen Zustand hat (eigener
 * Cache-Inhalt, eigenes Fehler-Backoff-Fenster) und eine gemeinsame
 * Abstraktion für drei Konsumenten nur Kopplung ohne Wiederverwendungs-
 * Gewinn brächte. Das ist hier das Hausmuster, kein Versehen.
 *
 * TTL bewusst 5 Minuten statt der 10 Sekunden von Board und Zeiten:
 * Projekt-Stammdaten ändern sich selten (ein neues Projekt, ein
 * Statuswechsel — nicht im Sekundentakt), und der Abruf holt ALLE Projekte
 * des Workspaces. Bei 10 s wäre das ein awork-Read je Poll-Zyklus für
 * Daten, die sich in Stunden nicht bewegen.
 *
 * Fehler-Semantik EXAKT wie erstelleBoardLader/erstelleZeitenLader:
 * geworfen wird nur, wenn es noch nie einen Stand gab; existiert ein
 * früherer Stand, wird er als Stale weitergereicht. Die Aufrufer in Route
 * und Seiten-Router fangen den Wurf zusätzlich ab und liefern das Board
 * ohne Projekt-Stammdaten aus — die Filterleiste ist ein Komfort, sie darf
 * die Board-Auslieferung nie blockieren.
 */
export function erstelleProjekteLader(opts: {
  awork: Pick<AworkClient, "getProjectsLeicht">;
  ttlMs: number;
  jetztFn?: () => Date;
}): ProjekteLader {
  const jetztFn = opts.jetztFn ?? (() => new Date());
  let cache: { projekte: ProjekteProId; geholtUmMs: number } | null = null;
  let fehlerBisMs: number | null = null;
  let letzterFehler: unknown = null;
  let laufenderAbruf: Promise<AworkProjektLeicht[]> | null = null;
  let abrufStartMs = 0;

  return async function ladeProjekte(): Promise<ProjekteProId> {
    const jetztMs = jetztFn().getTime();
    if (cache) {
      const alterMs = jetztMs - cache.geholtUmMs;
      // Uhr-Rücksprung-Klammer: ein negatives Alter hieße, der Cache läge in
      // der Zukunft — das darf nicht als Treffer zählen (siehe daten.ts/D3).
      if (alterMs >= 0 && alterMs < opts.ttlMs) {
        return cache.projekte;
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
        return cache.projekte;
      }
      throw letzterFehler;
    }

    let roh: AworkProjektLeicht[];
    try {
      if (!laufenderAbruf) {
        // Startzeitpunkt des geteilten Abrufs selbst festhalten (D2) — nicht
        // die Ankunftszeit irgendeines Joiners (siehe daten.ts).
        abrufStartMs = jetztMs;
        laufenderAbruf = opts.awork
          .getProjectsLeicht()
          .catch((fehler) => {
            // Genau eine Logzeile je tatsächlichem awork-Versuch — nicht je
            // Aufrufer, der sich per In-Flight-Dedup an dieses Promise
            // hängt (D1).
            console.error(
              "teamboard: awork-Laden (Projekt-Stammdaten) fehlgeschlagen —",
              fehler instanceof Error ? fehler.message : String(fehler)
            );
            throw fehler;
          })
          .finally(() => {
            laufenderAbruf = null;
          });
      }
      roh = await laufenderAbruf;
      fehlerBisMs = null;
    } catch (fehler) {
      fehlerBisMs = jetztMs + opts.ttlMs;
      letzterFehler = fehler;
      if (cache) {
        return cache.projekte;
      }
      throw fehler;
    }

    const projekte = baueProjektKarte(roh);
    cache = { projekte, geholtUmMs: abrufStartMs };
    return projekte;
  };
}

/**
 * Verkleinert die Stammdaten auf die Projekte, die im Board tatsächlich
 * vorkommen (Karten UND Timer) — die Board-Antwort geht alle 10 Sekunden
 * über die Leitung, die vollen ~100 Projekte des Workspaces hätten darin
 * nichts zu suchen.
 *
 * Ein Projekt, das die Stammdaten nicht kennen (neu angelegt, seit dem
 * letzten Abruf entstanden), bekommt bewusst KEINEN Platzhalter-Eintrag:
 * "steht nicht drin" und "hat keine Art" sind im Client dasselbe
 * (Optional-Zugriff ⇒ keine Art, kein Status), ein leerer Eintrag wäre nur
 * Ballast.
 */
export function projekteFuerBoard(board: Board, alle: ProjekteProId): ProjekteProId {
  const ergebnis: ProjekteProId = {};
  for (const lane of board.lanes) {
    if (lane.timer && lane.timer.projektId && alle[lane.timer.projektId]) {
      ergebnis[lane.timer.projektId] = alle[lane.timer.projektId];
    }
    for (const aufgabe of lane.aufgaben) {
      if (aufgabe.projektId && alle[aufgabe.projektId]) {
        ergebnis[aufgabe.projektId] = alle[aufgabe.projektId];
      }
    }
  }
  return ergebnis;
}
