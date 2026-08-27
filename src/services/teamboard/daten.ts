import type { AworkClient, LaufenderTimer, OffeneAufgabe, TeamboardNutzer } from "../awork.js";
import { baueBoard, type Board } from "./board.js";

export interface BoardStand {
  board: Board;
  alterSekunden: number;
}

export type BoardLader = () => Promise<BoardStand>;

/**
 * Berliner Kalendertag als "YYYY-MM-DD" — sv-SE formatiert genau so.
 * Identische Semantik wie todayInBerlin (workdays.ts) — bewusst beim Port
 * aus Stufe 1 dupliziert, nicht auf die Bestandsfunktion umgestellt
 * (Port-Treue).
 */
export function heuteBerlin(jetzt: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(jetzt);
}

/**
 * Liefert das Board mit TTL-Cache. Scheitert awork NACH einem ersten Erfolg,
 * kommt der letzte Stand mit wachsendem alterSekunden zurück (die Seite zeigt
 * daraus ihr "Stand: vor X Minuten"-Banner). Ohne jemals einen Stand gehabt zu
 * haben, wird der Fehler durchgereicht.
 *
 * Fehler-Backoff: scheitert der awork-Abruf, wird bis zu einer ttlMs weit in
 * der Zukunft liegenden Frist kein neuer Versuch unternommen — jede Anfrage
 * in dieser Frist bekommt sofort den Stale-Stand (bzw. den letzten Fehler,
 * ohne Stand). Ohne das entspräche die Retry-Rate während eines awork-
 * Ausfalls der Besucher-Rate statt der Poll-Rate. In-Flight-Dedup: laufen
 * mehrere Anfragen gleichzeitig in einen abgelaufenen Cache, teilen sie sich
 * einen einzigen awork-Abruf statt je einen eigenen auszulösen.
 *
 * baueBoard()/heuteBerlin() laufen bewusst AUSSERHALB des try/catch um die
 * awork-Aufrufe: ein Fehler dort (z.B. ein unerwartetes Feld-Format) ist kein
 * awork-Ausfall und darf weder als Stale maskiert werden noch den
 * Fehler-Backoff auslösen — sonst sähe ein Programmierfehler für immer wie
 * "awork nicht erreichbar" aus, ohne dass ein Log-Eintrag den echten Grund
 * verrät.
 *
 * verwerfen() wirft den Cache weg, damit der nächste Aufruf garantiert frisch
 * lädt — nach einem Schreibvorgang (Erledigen/Undo) muss der Nutzer die
 * Wirkung seines eigenen Klicks sofort sehen.
 */
export function erstelleBoardLader(opts: {
  client: Pick<AworkClient, "getBoardUsers" | "getRunningTimers" | "getAvailableTasks">;
  ttlMs: number;
  jetztFn?: () => Date;
}): BoardLader & { verwerfen(): void } {
  const jetztFn = opts.jetztFn ?? (() => new Date());
  let cache: { board: Board; geholtUmMs: number } | null = null;
  let fehlerBisMs: number | null = null;
  let letzterFehler: unknown = null;
  let laufenderAbruf: Promise<[TeamboardNutzer[], LaufenderTimer[], OffeneAufgabe[]]> | null = null;
  let abrufStartMs = 0;

  /**
   * Stale-BoardStand aus dem Cache, Alter in ganzen Sekunden ab geholtUmMs
   * (D4 — war dreifach dieselbe Formel). Nur aufrufen, wenn cache gesetzt ist.
   */
  function stale(jetztMs: number): BoardStand {
    return {
      board: cache!.board,
      alterSekunden: Math.floor((jetztMs - cache!.geholtUmMs) / 1000),
    };
  }

  async function ladeBoard(): Promise<BoardStand> {
    const jetzt = jetztFn();
    const jetztMs = jetzt.getTime();
    if (cache) {
      const alterMs = jetztMs - cache.geholtUmMs;
      // Uhr-Rücksprung-Klammer: ein negatives Alter hieße, der Cache läge in
      // der Zukunft — das darf nicht als Treffer zählen, sonst gilt er nach
      // einem Rücksprung u. U. viel zu lange (D3).
      if (alterMs >= 0 && alterMs < opts.ttlMs) {
        return stale(jetztMs);
      }
    }
    if (
      fehlerBisMs !== null &&
      jetztMs < fehlerBisMs &&
      // Uhr-Rücksprung-Klammer: liegt jetzt vor der Fehlschlag-Aufzeichnung,
      // wächst das Rest-Fenster über die TTL hinaus — dann als ungültig
      // verwerfen, statt Retries für die ganze Sprungdauer zu unterdrücken (D3).
      fehlerBisMs - jetztMs <= opts.ttlMs
    ) {
      if (cache) {
        return stale(jetztMs);
      }
      throw letzterFehler;
    }

    let nutzer: TeamboardNutzer[], timer: LaufenderTimer[], aufgaben: OffeneAufgabe[];
    try {
      if (!laufenderAbruf) {
        // Startzeitpunkt des geteilten Abrufs selbst festhalten (D2) — nicht
        // die Ankunftszeit irgendeines Joiners, die je nach Await-Reihenfolge
        // den Cache auf einen späteren, falschen Zeitpunkt datieren würde.
        abrufStartMs = jetztMs;
        laufenderAbruf = Promise.all([
          opts.client.getBoardUsers(),
          opts.client.getRunningTimers(),
          opts.client.getAvailableTasks(),
        ])
          .catch((fehler) => {
            // Genau eine Logzeile je tatsächlichem awork-Versuch — nicht je
            // Aufrufer, der sich per In-Flight-Dedup an dieses Promise
            // hängt (D1).
            console.error(
              "teamboard: awork-Laden fehlgeschlagen —",
              fehler instanceof Error ? fehler.message : String(fehler)
            );
            throw fehler;
          })
          .finally(() => {
            laufenderAbruf = null;
          });
      }
      [nutzer, timer, aufgaben] = await laufenderAbruf;
      fehlerBisMs = null;
    } catch (fehler) {
      fehlerBisMs = jetztMs + opts.ttlMs;
      letzterFehler = fehler;
      if (cache) {
        return stale(jetztMs);
      }
      throw fehler;
    }

    const board = baueBoard({
      nutzer,
      timer,
      aufgaben,
      jetzt,
      heute: heuteBerlin(jetzt),
    });
    cache = { board, geholtUmMs: abrufStartMs };
    return { board, alterSekunden: 0 };
  }

  return Object.assign(ladeBoard, {
    /**
     * Alle drei Sperren fallen lassen, nicht nur den Cache: steht das
     * Fehler-Backoff-Fenster offen, lieferte der nächste ladeBoard() sonst
     * trotzdem den Stale-Stand (bzw. würfe letzterFehler weiter) und der
     * Nutzer sähe seine gerade erledigte Aufgabe weiter im Board.
     * laufenderAbruf bleibt unangetastet — ein schon fliegender Abruf darf
     * geteilt werden.
     */
    verwerfen(): void {
      cache = null;
      fehlerBisMs = null;
      letzterFehler = null;
    },
  });
}
