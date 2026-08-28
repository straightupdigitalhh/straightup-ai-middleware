import { describe, it, expect } from "vitest";
import { baueBoard, timerAnzeige } from "../src/services/teamboard/board.js";
import type {
  LaufenderTimer,
  OffeneAufgabe,
  TeamboardNutzer,
} from "../src/services/awork.js";

function timer(teile: Partial<LaufenderTimer>): LaufenderTimer {
  return {
    userId: "u-1",
    aufgabenName: "Aufgabe",
    aufgabenKennung: "STRI-1",
    projektName: "Projekt",
    projektId: "p-1",
    startUtc: "2026-08-26T09:00:00Z",
    pausen: [],
    ...teile,
  };
}

describe("timerAnzeige", () => {
  const jetzt = new Date("2026-08-26T10:00:00Z");

  it("zählt die Sekunden seit Start ohne Pausen", () => {
    expect(timerAnzeige(timer({}), jetzt)).toEqual({ sekunden: 3600, pausiert: false });
  });

  it("zieht abgeschlossene Pausen ab", () => {
    const t = timer({
      pausen: [
        { startUtc: "2026-08-26T09:10:00Z", dauerSekunden: 600, endeUtc: "2026-08-26T09:20:00Z" },
      ],
    });
    expect(timerAnzeige(t, jetzt)).toEqual({ sekunden: 3000, pausiert: false });
  });

  it("steht bei offener Pause auf pausiert und zählt nur bis zum Pausenbeginn", () => {
    const t = timer({
      pausen: [
        { startUtc: "2026-08-26T09:10:00Z", dauerSekunden: 600, endeUtc: "2026-08-26T09:20:00Z" },
        { startUtc: "2026-08-26T09:50:00Z", dauerSekunden: 0, endeUtc: null },
      ],
    });
    // 09:00 → 09:50 sind 3000 s, minus 600 s abgeschlossene Pause = 2400 s.
    expect(timerAnzeige(t, jetzt)).toEqual({ sekunden: 2400, pausiert: true });
  });

  it("wird nie negativ (Uhren-Schiefstand zwischen awork und Server)", () => {
    const t = timer({ startUtc: "2026-08-26T10:00:05Z" });
    expect(timerAnzeige(t, jetzt)).toEqual({ sekunden: 0, pausiert: false });
  });
});

function aufgabe(teile: Partial<OffeneAufgabe>): OffeneAufgabe {
  return {
    id: "t-x",
    name: "Aufgabe",
    kennung: null,
    projektName: null,
    projektId: "p-1",
    statusName: "Offen",
    statusTyp: "todo",
    faelligAm: null,
    istPrio: false,
    istWiederkehrend: false,
    arbeitsart: null,
    assigneeIds: [],
    ...teile,
  };
}

describe("baueBoard", () => {
  const jetzt = new Date("2026-08-26T10:00:00Z");
  const heute = "2026-08-26";
  const nutzer: TeamboardNutzer[] = [
    { id: "u-lea", vorname: "Lea", nachname: "Stöber" },
    { id: "u-gabi", vorname: "Gabi", nachname: "" },
    { id: "u-jan", vorname: "Jan", nachname: "Lehnhoff" },
  ];

  it("baut eine Lane pro Person, alphabetisch nach Vorname, mit Timer-Karte", () => {
    const board = baueBoard({
      nutzer,
      timer: [timer({ userId: "u-lea" })],
      aufgaben: [],
      jetzt,
      heute,
    });
    expect(board.stand).toBe("2026-08-26T10:00:00.000Z");
    expect(board.lanes.map((l) => l.name)).toEqual(["Gabi", "Jan Lehnhoff", "Lea Stöber"]);
    expect(board.lanes[2].timer).toEqual({
      aufgabenName: "Aufgabe",
      aufgabenKennung: "STRI-1",
      projektName: "Projekt",
      projektId: "p-1",
      sekunden: 3600,
      pausiert: false,
    });
    expect(board.lanes[0].timer).toBeNull();
  });

  it("sortiert Aufgaben: Fälligkeit aufsteigend zuerst, ohne Datum zuletzt, Prio als Tiebreak (auf Jans Wunsch nach der Abnahme, 26.08.2026 — die Progress-Gruppierung entfällt, der laufende Timer zeigt ohnehin, woran gearbeitet wird)", () => {
    const board = baueBoard({
      nutzer,
      timer: [],
      aufgaben: [
        aufgabe({ id: "t-ohne", assigneeIds: ["u-lea"], statusTyp: "todo" }),
        aufgabe({ id: "t-morgen", assigneeIds: ["u-lea"], statusTyp: "todo", faelligAm: "2026-08-27T00:00:00Z" }),
        aufgabe({ id: "t-prog", assigneeIds: ["u-lea"], statusTyp: "progress" }),
        aufgabe({ id: "t-prio", assigneeIds: ["u-lea"], statusTyp: "todo", istPrio: true }),
        aufgabe({ id: "t-gestern", assigneeIds: ["u-lea"], statusTyp: "review", faelligAm: "2026-08-25T00:00:00Z" }),
      ],
      jetzt,
      heute,
    });
    const lea = board.lanes.find((l) => l.userId === "u-lea")!;
    // t-gestern (25.08.) vor t-morgen (27.08.) vor den datumslosen; darunter
    // istPrio zuerst (t-prio), danach stabile Reihenfolge der übrigen
    // datumslosen in Eingabe-Reihenfolge (t-ohne vor t-prog — Array.sort ist
    // stabil, t-ohne stand im Eingabe-Array vor t-prog).
    expect(lea.aufgaben.map((a) => a.id)).toEqual(["t-gestern", "t-morgen", "t-prio", "t-ohne", "t-prog"]);
    expect(lea.aufgaben.find((a) => a.id === "t-gestern")!.ueberfaellig).toBe(true);
    expect(lea.aufgaben.find((a) => a.id === "t-morgen")!.ueberfaellig).toBe(false);
    expect(lea.aufgaben.find((a) => a.id === "t-gestern")!.projektId).toBe("p-1");
  });

  it("legt Aufgaben mit mehreren Assignees in jede betroffene Lane", () => {
    const board = baueBoard({
      nutzer,
      timer: [],
      aufgaben: [aufgabe({ id: "t-beide", assigneeIds: ["u-lea", "u-jan"] })],
      jetzt,
      heute,
    });
    expect(board.lanes.find((l) => l.userId === "u-lea")!.aufgaben).toHaveLength(1);
    expect(board.lanes.find((l) => l.userId === "u-jan")!.aufgaben).toHaveLength(1);
  });

  it("gibt die Arbeitsart an die Karte weiter — der Filter liest sie später aus den Karten des Boards", () => {
    const board = baueBoard({
      nutzer,
      timer: [],
      aufgaben: [
        aufgabe({ id: "t-arbeit", assigneeIds: ["u-lea"], arbeitsart: "Interne Arbeit" }),
        aufgabe({ id: "t-ohne", assigneeIds: ["u-gabi"], arbeitsart: null }),
      ],
      jetzt,
      heute,
    });
    expect(board.lanes.find((l) => l.userId === "u-lea")!.aufgaben[0].arbeitsart).toBe("Interne Arbeit");
    expect(board.lanes.find((l) => l.userId === "u-gabi")!.aufgaben[0].arbeitsart).toBeNull();
  });

  it("gibt istWiederkehrend und assigneeIds an der Karte weiter — auch identisch in beiden Lanes bei mehreren Zuständigen", () => {
    const board = baueBoard({
      nutzer,
      timer: [],
      aufgaben: [
        aufgabe({ id: "t-wiederkehrend", assigneeIds: ["u-lea", "u-jan"], istWiederkehrend: true }),
      ],
      jetzt,
      heute,
    });
    const leaKarte = board.lanes.find((l) => l.userId === "u-lea")!.aufgaben[0];
    const janKarte = board.lanes.find((l) => l.userId === "u-jan")!.aufgaben[0];
    expect(leaKarte.istWiederkehrend).toBe(true);
    expect(leaKarte.assigneeIds).toEqual(["u-lea", "u-jan"]);
    expect(janKarte.istWiederkehrend).toBe(true);
    expect(janKarte.assigneeIds).toEqual(["u-lea", "u-jan"]);
  });
});
