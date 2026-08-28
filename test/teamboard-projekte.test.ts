import { describe, it, expect, vi } from "vitest";
import { erstelleProjekteLader, projekteFuerBoard } from "../src/services/teamboard/projekte.js";
import type { AworkProjektLeicht } from "../src/services/awork.js";
import type { Board, Lane } from "../src/services/teamboard/board.js";

const BASIS_MS = 1_756_200_000_000; // Referenzzeitpunkt, wie in teamboard-zeiten.test.ts
const FUENF_MINUTEN_MS = 5 * 60 * 1000;

/** Fake-awork (vi.fn()-Stub), der Aufrufe zählt und per Schalter Fehler wirft. */
function fakeAwork(projekte: AworkProjektLeicht[] = []) {
  const zustand = { wirft: false };
  const getProjectsLeicht = vi.fn(async () => {
    if (zustand.wirft) throw new Error("awork-API-Fehler 500 bei projects: kaputt");
    return projekte;
  });
  return { zustand, getProjectsLeicht };
}

// ─── Mapping ───────────────────────────────────────────────────────

describe("erstelleProjekteLader — Mapping", () => {
  it("schlüsselt die Projekte nach id auf { art, status }", async () => {
    const awork = fakeAwork([
      { id: "proj-intern", artName: "straightup Projekt", statusTyp: "progress" },
      { id: "proj-kunde-x", artName: "Website-Support", statusTyp: "closed" },
    ]);
    const lade = erstelleProjekteLader({ awork, ttlMs: FUENF_MINUTEN_MS });

    expect(await lade()).toEqual({
      "proj-intern": { art: "straightup Projekt", status: "progress" },
      "proj-kunde-x": { art: "Website-Support", status: "closed" },
    });
  });

  it("reicht fehlende Art und fehlenden Status als null durch", async () => {
    const awork = fakeAwork([{ id: "proj-ohne", artName: null, statusTyp: null }]);
    const lade = erstelleProjekteLader({ awork, ttlMs: FUENF_MINUTEN_MS });

    expect(await lade()).toEqual({ "proj-ohne": { art: null, status: null } });
  });

  it("liefert ein leeres Objekt, wenn awork keine Projekte kennt", async () => {
    const lade = erstelleProjekteLader({ awork: fakeAwork([]), ttlMs: FUENF_MINUTEN_MS });
    expect(await lade()).toEqual({});
  });
});

// ─── Cache/Backoff (dasselbe Muster wie erstelleZeitenLader) ────────

describe("erstelleProjekteLader — Cache/Backoff (Muster erstelleZeitenLader)", () => {
  it("holt einmal und beantwortet Folgeaufrufe innerhalb der TTL aus dem Cache", async () => {
    const awork = fakeAwork([{ id: "p-1", artName: "Vorlagen", statusTyp: "progress" }]);
    let ms = 0;
    const lade = erstelleProjekteLader({
      awork,
      ttlMs: FUENF_MINUTEN_MS,
      jetztFn: () => new Date(BASIS_MS + ms),
    });

    await lade();
    ms = 4 * 60 * 1000;
    await lade();
    expect(awork.getProjectsLeicht).toHaveBeenCalledTimes(1); // kein zweiter API-Gang

    // Projekt-Stammdaten ändern sich selten — die TTL ist deshalb bewusst
    // 5 Minuten statt der 10 Sekunden von Board und Zeiten.
    ms = FUENF_MINUTEN_MS + 1_000;
    await lade();
    expect(awork.getProjectsLeicht).toHaveBeenCalledTimes(2);
  });

  it("liefert bei awork-Fehlern den letzten Stand weiter (Stale-Fallback), wenn schon einer existiert", async () => {
    const awork = fakeAwork([{ id: "p-1", artName: "Website-Support", statusTyp: "progress" }]);
    let ms = 0;
    const lade = erstelleProjekteLader({
      awork,
      ttlMs: 1_000,
      jetztFn: () => new Date(BASIS_MS + ms),
    });

    const erster = await lade();
    awork.zustand.wirft = true;
    ms = 120_000;
    const stale = await lade();

    expect(stale).toEqual(erster);
  });

  it("wirft, wenn es noch nie einen Stand gab und awork nicht antwortet", async () => {
    const awork = fakeAwork([]);
    awork.zustand.wirft = true;
    const lade = erstelleProjekteLader({ awork, ttlMs: 1_000 });

    await expect(lade()).rejects.toThrow("projects");
  });

  it("verstärkt einen awork-Fehler nicht durch sofortige Folge-Retries (Fehler-Backoff, 1×ttl)", async () => {
    const awork = fakeAwork([{ id: "p-1", artName: null, statusTyp: "progress" }]);
    let ms = 0;
    const lade = erstelleProjekteLader({
      awork,
      ttlMs: 1_000,
      jetztFn: () => new Date(BASIS_MS + ms),
    });

    await lade();
    expect(awork.getProjectsLeicht).toHaveBeenCalledTimes(1);

    awork.zustand.wirft = true;
    ms = 2_000; // TTL abgelaufen -> erster Fehlschlag
    await lade();
    expect(awork.getProjectsLeicht).toHaveBeenCalledTimes(2);

    ms = 2_100; // innerhalb der Backoff-Frist: kein weiterer Versuch
    await lade();
    expect(awork.getProjectsLeicht).toHaveBeenCalledTimes(2);

    ms = 3_100; // Backoff-Frist (1×ttl) abgelaufen
    await lade();
    expect(awork.getProjectsLeicht).toHaveBeenCalledTimes(3);
  });

  it("teilt einen laufenden Abruf zwischen gleichzeitigen Aufrufern (In-Flight-Dedup)", async () => {
    const awork = fakeAwork([{ id: "p-1", artName: "Messe-Betreuung", statusTyp: "progress" }]);
    const lade = erstelleProjekteLader({ awork, ttlMs: FUENF_MINUTEN_MS });

    const [a, b] = await Promise.all([lade(), lade()]);

    expect(awork.getProjectsLeicht).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });
});

// ─── projekteFuerBoard ─────────────────────────────────────────────

function lane(teile: Partial<Lane>): Lane {
  return { userId: "u-x", name: "X", timer: null, aufgaben: [], ...teile };
}

function aufgabe(projektId: string | null): Lane["aufgaben"][number] {
  return {
    id: `a-${projektId}`,
    name: "Aufgabe",
    kennung: null,
    projektName: null,
    projektId,
    statusName: "Offen",
    statusTyp: "todo",
    faelligAm: null,
    istPrio: false,
    istWiederkehrend: false,
    arbeitsart: null,
    assigneeIds: [],
    ueberfaellig: false,
  };
}

function timer(projektId: string | null): NonNullable<Lane["timer"]> {
  return {
    aufgabenName: "Timer-Aufgabe",
    aufgabenKennung: null,
    projektName: null,
    projektId,
    sekunden: 60,
    pausiert: false,
  };
}

const ALLE = {
  "p-karte": { art: "Website-Support", status: "progress" },
  "p-timer": { art: "Website-Erstellung", status: "closed" },
  "p-fremd": { art: "Vorlagen", status: "not-started" },
};

describe("projekteFuerBoard — nur die im Board vorkommenden Projekte", () => {
  it("nimmt Projekte aus Karten UND Timern auf, alle übrigen bleiben draußen", () => {
    const board: Board = {
      stand: "2026-08-28T10:00:00.000Z",
      lanes: [
        lane({ userId: "u-1", aufgaben: [aufgabe("p-karte")] }),
        lane({ userId: "u-2", timer: timer("p-timer") }),
      ],
    };
    expect(projekteFuerBoard(board, ALLE)).toEqual({
      "p-karte": { art: "Website-Support", status: "progress" },
      "p-timer": { art: "Website-Erstellung", status: "closed" },
    });
  });

  it("lässt Karten und Timer ohne Projekt (projektId null) aus", () => {
    const board: Board = {
      stand: "2026-08-28T10:00:00.000Z",
      lanes: [lane({ aufgaben: [aufgabe(null)], timer: timer(null) })],
    };
    expect(projekteFuerBoard(board, ALLE)).toEqual({});
  });

  it("übergeht Projekte, die die Stammdaten (noch) nicht kennen — kein Platzhalter-Eintrag", () => {
    // Ein Projekt, das seit dem letzten Stammdaten-Abruf entstanden ist:
    // die Karte bleibt im Board, sie trägt für den Filter nur keine Art.
    const board: Board = {
      stand: "2026-08-28T10:00:00.000Z",
      lanes: [lane({ aufgaben: [aufgabe("p-brandneu")] })],
    };
    expect(projekteFuerBoard(board, ALLE)).toEqual({});
  });

  it("nimmt nur eigene Einträge der Stammdaten — eine Projekt-ID wie 'constructor' erbt keinen Treffer", () => {
    // Ohne eigene-Eigenschaft-Prüfung liefert alle["constructor"] den
    // Prototyp-Wert und schriebe ihn als Projekt-Angabe in die Antwort.
    // Der Geschwistercode (projektPasst, projektArtenAusBoard) prüft
    // bereits so — hier war es die einzige Lücke.
    const board: Board = {
      stand: "2026-08-28T10:00:00.000Z",
      lanes: [lane({ aufgaben: [aufgabe("constructor")], timer: timer("toString") })],
    };
    expect(projekteFuerBoard(board, ALLE)).toEqual({});
  });

  it("liefert bei leeren Stammdaten (awork-Ausfall vor dem ersten Stand) ein leeres Objekt", () => {
    const board: Board = {
      stand: "2026-08-28T10:00:00.000Z",
      lanes: [lane({ aufgaben: [aufgabe("p-karte")] })],
    };
    expect(projekteFuerBoard(board, {})).toEqual({});
  });
});
