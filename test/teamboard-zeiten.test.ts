import { describe, it, expect, vi } from "vitest";
import { erstelleZeitenLader, wochenstart } from "../src/services/teamboard/zeiten.js";
import type { AworkTimeEntry, LaufenderTimer } from "../src/services/awork.js";

const BASIS_MS = 1_756_200_000_000; // Referenzzeitpunkt, wie in teamboard-daten.test.ts

function eintrag(userId: string, tagLocal: string, sekunden: number): AworkTimeEntry {
  return {
    id: `e-${userId}-${tagLocal}-${sekunden}`,
    userId,
    duration: sekunden,
    startDateLocal: `${tagLocal}T09:00:00`,
  };
}

/** Fake-awork (vi.fn()-Stubs), der Aufrufe zählt und per Schalter Fehler wirft. */
function fakeAwork(entries: AworkTimeEntry[] = [], timer: LaufenderTimer[] = []) {
  const zustand = { wirft: false };
  const getTimeEntriesForRange = vi.fn(async (_fromLocal: string, _toLocal: string) => {
    if (zustand.wirft) throw new Error("awork-API-Fehler 500 bei timeentries: kaputt");
    return entries;
  });
  const getRunningTimers = vi.fn(async () => timer);
  return { zustand, getTimeEntriesForRange, getRunningTimers };
}

describe("wochenstart", () => {
  it("Mittwoch → Montag derselben Woche", () => {
    expect(wochenstart("2026-08-26")).toBe("2026-08-24");
  });

  it("Montag bleibt Montag", () => {
    expect(wochenstart("2026-08-24")).toBe("2026-08-24");
  });

  it("Sonntag → Montag derselben (angebrochenen) Woche", () => {
    expect(wochenstart("2026-08-30")).toBe("2026-08-24");
  });
});

describe("erstelleZeitenLader — Bucket-Regeln", () => {
  it("summiert abgeschlossene Einträge je Nutzer in heute/Vortag/Woche", async () => {
    // jetzt = Do 27.08.2026 -> heute=27., vortag=Mi 26. (previousWorkday), wstart=Mo 24.
    const awork = fakeAwork([
      eintrag("u1", "2026-08-27", 3600), // heute
      eintrag("u1", "2026-08-26", 1800), // vortag
      eintrag("u1", "2026-08-25", 900), // früher in der Woche (Dienstag)
    ]);
    const lade = erstelleZeitenLader({
      awork,
      ttlMs: 30_000,
      jetztFn: () => new Date("2026-08-27T10:00:00Z"),
    });

    const zeiten = await lade();

    expect(zeiten["u1"]).toEqual({ heuteSekunden: 3600, vortagSekunden: 1800, wocheSekunden: 6300 });
    expect(awork.getTimeEntriesForRange).toHaveBeenCalledWith("2026-08-24", "2026-08-27");
  });

  it("Montags-Grenzfall: Freitag zählt in vortagSekunden, NICHT in wocheSekunden", async () => {
    // jetzt = Mo 31.08.2026 -> heute=31., vortag=Fr 28. (previousWorkday übers WE), wstart=31. (Montag selbst).
    // from = min(vortag, wstart) = 28. -> Freitag liegt VOR dem Wochenstart.
    const awork = fakeAwork([
      eintrag("u1", "2026-08-28", 7200), // Freitag der Vorwoche
    ]);
    const lade = erstelleZeitenLader({
      awork,
      ttlMs: 30_000,
      jetztFn: () => new Date("2026-08-31T10:00:00Z"),
    });

    const zeiten = await lade();

    expect(zeiten["u1"]).toEqual({ heuteSekunden: 0, vortagSekunden: 7200, wocheSekunden: 0 });
    expect(awork.getTimeEntriesForRange).toHaveBeenCalledWith("2026-08-28", "2026-08-31");
  });

  it("laufender Timer addiert seine Netto-Sekunden auf heute und Woche des Timer-Nutzers", async () => {
    const timer: LaufenderTimer = {
      userId: "u2",
      aufgabenName: null,
      aufgabenKennung: null,
      projektName: null,
      projektId: null,
      startUtc: "2026-08-26T09:00:00Z",
      pausen: [],
    };
    const awork = fakeAwork([], [timer]);
    const lade = erstelleZeitenLader({
      awork,
      ttlMs: 30_000,
      jetztFn: () => new Date("2026-08-26T10:00:00Z"), // 1h nach Timer-Start
    });

    const zeiten = await lade();

    expect(zeiten["u2"]).toEqual({ heuteSekunden: 3600, vortagSekunden: 0, wocheSekunden: 3600 });
  });

  it("holt Einträge und laufende Timer je Zyklus getrennt (zwei awork-Reads, Plan-Ruling Nr. 6)", async () => {
    const awork = fakeAwork([eintrag("u1", "2026-08-26", 100)], []);
    const lade = erstelleZeitenLader({
      awork,
      ttlMs: 30_000,
      jetztFn: () => new Date("2026-08-26T10:00:00Z"),
    });

    await lade();

    expect(awork.getTimeEntriesForRange).toHaveBeenCalledTimes(1);
    expect(awork.getRunningTimers).toHaveBeenCalledTimes(1);
  });
});

describe("erstelleZeitenLader — Cache/Backoff (identisch zu erstelleBoardLader)", () => {
  it("holt einmal und beantwortet Folgeaufrufe innerhalb der TTL aus dem Cache", async () => {
    const awork = fakeAwork([eintrag("u1", "2026-08-24", 100)]);
    let ms = 0;
    const lade = erstelleZeitenLader({
      awork,
      ttlMs: 30_000,
      jetztFn: () => new Date(BASIS_MS + ms),
    });

    await lade();
    ms = 10_000;
    await lade();
    expect(awork.getTimeEntriesForRange).toHaveBeenCalledTimes(1); // kein zweiter API-Gang

    ms = 31_000;
    await lade();
    expect(awork.getTimeEntriesForRange).toHaveBeenCalledTimes(2); // TTL abgelaufen -> frisch geholt
  });

  it("liefert bei awork-Fehlern den letzten Stand weiter (Stale-Fallback), wenn schon einer existiert", async () => {
    const awork = fakeAwork([eintrag("u1", "2026-08-24", 100)]);
    let ms = 0;
    const lade = erstelleZeitenLader({
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
    const lade = erstelleZeitenLader({ awork, ttlMs: 1_000 });

    await expect(lade()).rejects.toThrow("timeentries");
  });

  it("verstärkt einen awork-Fehler nicht durch sofortige Folge-Retries (Fehler-Backoff, 1×ttl)", async () => {
    const awork = fakeAwork([eintrag("u1", "2026-08-24", 100)]);
    let ms = 0;
    const lade = erstelleZeitenLader({
      awork,
      ttlMs: 1_000,
      jetztFn: () => new Date(BASIS_MS + ms),
    });

    await lade();
    expect(awork.getTimeEntriesForRange).toHaveBeenCalledTimes(1);

    awork.zustand.wirft = true;
    ms = 2_000; // TTL abgelaufen -> erster Fehlschlag
    await lade();
    expect(awork.getTimeEntriesForRange).toHaveBeenCalledTimes(2);

    // Direkt danach: ohne Backoff triggert die abgelaufene TTL sofort einen
    // weiteren awork-Aufruf. Mit Backoff bleibt es beim Stale-Stand.
    ms = 2_100;
    await lade();
    expect(awork.getTimeEntriesForRange).toHaveBeenCalledTimes(2);

    // Nach Ablauf der Backoff-Frist (1×ttl) wird wieder versucht.
    ms = 3_100;
    await lade();
    expect(awork.getTimeEntriesForRange).toHaveBeenCalledTimes(3);
  });
});
