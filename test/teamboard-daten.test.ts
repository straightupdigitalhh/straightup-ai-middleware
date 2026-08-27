import { describe, it, expect, vi } from "vitest";
import { erstelleBoardLader, heuteBerlin } from "../src/services/teamboard/daten.js";

/** Fake-Client, der Aufrufe zählt und per Schalter Fehler wirft. */
function fakeClient() {
  const zustand = { aufrufe: 0, wirft: false };
  return {
    zustand,
    getBoardUsers: async () => {
      zustand.aufrufe += 1;
      if (zustand.wirft) throw new Error("awork-API-Fehler 500 bei aktiveNutzer: kaputt");
      return [{ id: "u-lea", vorname: "Lea", nachname: "Stöber" }];
    },
    getRunningTimers: async () => [],
    getAvailableTasks: async () => [],
    nutzerBild: async () => null,
  };
}

/** Fake-Client, dessen getBoardUsers()-Aufruf erst nach externem freigeben() aufgelöst wird. */
function fakeClientVerzoegert() {
  const zustand = { aufrufe: 0 };
  let freigebenFn: () => void = () => {};
  const wartend = new Promise<void>((resolve) => {
    freigebenFn = resolve;
  });
  return {
    zustand,
    freigeben: () => freigebenFn(),
    getBoardUsers: async () => {
      zustand.aufrufe += 1;
      await wartend;
      return [{ id: "u-lea", vorname: "Lea", nachname: "Stöber" }];
    },
    getRunningTimers: async () => [],
    getAvailableTasks: async () => [],
    nutzerBild: async () => null,
  };
}

/** Fake-Client, der auf Schalter eine Aufgabe mit falschem Feldtyp liefert — bricht baueBoard(), nicht awork. */
function fakeClientMitSchaltbarerAufgabe() {
  const zustand = { aufrufe: 0, kaputt: false };
  return {
    zustand,
    getBoardUsers: async () => {
      zustand.aufrufe += 1;
      return [{ id: "u-lea", vorname: "Lea", nachname: "Stöber" }];
    },
    getRunningTimers: async () => [],
    getAvailableTasks: async () =>
      zustand.kaputt
        ? [
            {
              id: "t1",
              name: "Kaputt",
              kennung: null,
              projektName: null,
              statusName: "Offen",
              statusTyp: "todo",
              faelligAm: 12345 as unknown as string, // awork liefert hier z.B. eine Zahl statt ISO-String
              istPrio: false,
              assigneeIds: ["u-lea"],
            },
          ]
        : [],
    nutzerBild: async () => null,
  };
}

describe("erstelleBoardLader", () => {
  it("holt einmal und beantwortet Folgeaufrufe innerhalb der TTL aus dem Cache", async () => {
    const client = fakeClient();
    let ms = 0;
    const lade = erstelleBoardLader({
      client,
      ttlMs: 30_000,
      jetztFn: () => new Date(1_756_200_000_000 + ms),
    });
    const erster = await lade();
    expect(erster.alterSekunden).toBe(0);
    expect(erster.board.lanes.map((l) => l.name)).toEqual(["Lea Stöber"]);
    ms = 10_000;
    const zweiter = await lade();
    expect(client.zustand.aufrufe).toBe(1); // kein zweiter API-Gang
    expect(zweiter.alterSekunden).toBe(10);
    ms = 31_000;
    await lade();
    expect(client.zustand.aufrufe).toBe(2); // TTL abgelaufen → frisch geholt
  });

  it("liefert bei awork-Fehlern den letzten Stand weiter (Stale-Fallback)", async () => {
    const client = fakeClient();
    let ms = 0;
    const lade = erstelleBoardLader({
      client,
      ttlMs: 1_000,
      jetztFn: () => new Date(1_756_200_000_000 + ms),
    });
    await lade();
    client.zustand.wirft = true;
    ms = 120_000;
    const stale = await lade();
    expect(stale.board.lanes).toHaveLength(1);
    expect(stale.alterSekunden).toBe(120);
  });

  it("wirft, wenn es noch nie einen Stand gab und awork nicht antwortet", async () => {
    const client = fakeClient();
    client.zustand.wirft = true;
    const lade = erstelleBoardLader({ client, ttlMs: 1_000 });
    await expect(lade()).rejects.toThrow("aktiveNutzer");
  });

  it("verstärkt einen awork-Fehler nicht durch sofortige Folge-Retries (Fehler-Backoff)", async () => {
    const client = fakeClient();
    let ms = 0;
    const lade = erstelleBoardLader({
      client,
      ttlMs: 1_000,
      jetztFn: () => new Date(1_756_200_000_000 + ms),
    });
    await lade();
    expect(client.zustand.aufrufe).toBe(1);

    client.zustand.wirft = true;
    ms = 2_000; // TTL abgelaufen -> erster Fehlschlag
    await lade();
    expect(client.zustand.aufrufe).toBe(2);

    // Direkt danach: geholtUmMs blieb auf dem alten Erfolg stehen, die TTL
    // wäre also weiterhin "abgelaufen" — ohne Backoff triggert das sofort
    // einen weiteren awork-Aufruf. Mit Backoff bleibt es beim Stale-Stand.
    ms = 2_100;
    const zwischenzeitlich = await lade();
    expect(client.zustand.aufrufe).toBe(2);
    expect(zwischenzeitlich.board.lanes).toHaveLength(1);

    // Nach Ablauf der Backoff-Frist wird wieder versucht.
    ms = 3_100;
    await lade();
    expect(client.zustand.aufrufe).toBe(3);
  });

  it("behandelt einen Cache als Miss statt als Treffer 'aus der Zukunft', wenn die Uhr zurückspringt (D3)", async () => {
    const client = fakeClient();
    let ms = 10_000;
    const lade = erstelleBoardLader({
      client,
      ttlMs: 30_000,
      jetztFn: () => new Date(1_756_200_000_000 + ms),
    });
    await lade();
    expect(client.zustand.aufrufe).toBe(1);

    // Uhr springt vor den Abrufzeitpunkt zurück (z. B. NTP-Korrektur) — ein
    // negatives Alter darf den Cache nicht fälschlich weiter gültig machen.
    ms = 5_000;
    await lade();
    expect(client.zustand.aufrufe).toBe(2); // frischer Versuch statt Cache-Treffer
  });

  it("verwirft das Fehler-Backoff-Fenster, wenn die Uhr vor die Fehlschlag-Aufzeichnung zurückspringt (D3)", async () => {
    const client = fakeClient();
    let ms = 10_000;
    const lade = erstelleBoardLader({
      client,
      ttlMs: 1_000,
      jetztFn: () => new Date(1_756_200_000_000 + ms),
    });
    await lade();
    expect(client.zustand.aufrufe).toBe(1);

    client.zustand.wirft = true;
    ms = 12_000; // TTL abgelaufen -> Fehlschlag, setzt die Backoff-Frist auf 13_000
    await lade();
    expect(client.zustand.aufrufe).toBe(2);

    // Uhr springt zurück auf einen Zeitpunkt VOR den Fehlschlag selbst — ohne
    // Klammer würde das Rest-Fenster (fehlerBisMs - jetzt) über die TTL
    // hinauswachsen und Retries für die Sprungdauer unterdrücken.
    client.zustand.wirft = false;
    ms = 11_500;
    await lade();
    expect(client.zustand.aufrufe).toBe(3); // neuer Versuch statt unterdrücktem Retry
  });

  it("bündelt parallele Anfragen während eines laufenden awork-Abrufs (In-Flight-Dedup)", async () => {
    const client = fakeClientVerzoegert();
    const lade = erstelleBoardLader({ client, ttlMs: 30_000 });

    const p1 = lade();
    const p2 = lade();
    // Beide Anfragen sind noch offen, aber teilen sich denselben awork-Abruf.
    expect(client.zustand.aufrufe).toBe(1);

    client.freigeben();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.board.lanes[0].name).toBe("Lea Stöber");
    expect(r2.board.lanes[0].name).toBe("Lea Stöber");
  });

  it("datiert den Cache auf den Start des geteilten Abrufs, nicht auf die Ankunft eines später beigetretenen Joiners (D2)", async () => {
    const client = fakeClientVerzoegert();
    let ms = 0;
    const lade = erstelleBoardLader({
      client,
      ttlMs: 30_000,
      jetztFn: () => new Date(1_756_200_000_000 + ms),
    });

    const p1 = lade(); // Abruf startet bei ms=0
    ms = 5_000;
    const p2 = lade(); // tritt 5s später demselben laufenden Abruf bei
    client.freigeben();
    await Promise.all([p1, p2]);

    ms = 6_000;
    const dritter = await lade(); // Cache-Treffer
    expect(dritter.alterSekunden).toBe(6); // ab Abruf-Start (ms=0), nicht ab Beitritt (ms=5000)
  });

  it("loggt einen awork-Fehler genau einmal, wenn mehrere Aufrufer sich denselben fehlgeschlagenen Abruf teilen (D1)", async () => {
    const client = fakeClient();
    client.zustand.wirft = true;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const lade = erstelleBoardLader({ client, ttlMs: 1_000 });

    const ergebnisse = await Promise.allSettled([lade(), lade(), lade()]);
    expect(ergebnisse.every((e) => e.status === "rejected")).toBe(true);
    expect(client.zustand.aufrufe).toBe(1); // ein einziger awork-Versuch (In-Flight-Dedup)
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("loggt einen awork-Fehler mit der Nachricht, nie mit dem Fehlerobjekt selbst", async () => {
    const client = fakeClient();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const lade = erstelleBoardLader({ client, ttlMs: 1_000 });
    client.zustand.wirft = true;

    await expect(lade()).rejects.toThrow();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [praefix, nachricht] = errorSpy.mock.calls[0]!;
    expect(String(praefix)).toContain("teamboard");
    expect(nachricht).toBe("awork-API-Fehler 500 bei aktiveNutzer: kaputt");
    errorSpy.mockRestore();
  });

  it("maskiert einen baueBoard-Fehler nicht als Stale (auch mit vorhandenem Cache), und der Fehler-Backoff greift dafür nicht", async () => {
    const client = fakeClientMitSchaltbarerAufgabe();
    let ms = 0;
    const lade = erstelleBoardLader({
      client,
      ttlMs: 1_000,
      jetztFn: () => new Date(1_756_200_000_000 + ms),
    });
    const erster = await lade();
    expect(erster.board.lanes[0].name).toBe("Lea Stöber");

    // awork antwortet erfolgreich, liefert aber eine Aufgabe, an der
    // baueBoard() bricht (faelligAm keine ISO-Zeichenkette) — das darf NICHT
    // stillschweigend hinter dem alten Stand als "awork nicht erreichbar"
    // verschwinden.
    client.zustand.kaputt = true;
    ms = 2_000; // TTL abgelaufen -> Neuabruf
    await expect(lade()).rejects.toThrow();
    expect(client.zustand.aufrufe).toBe(2);

    // Der baueBoard-Fehler ist kein awork-Ausfall: der nächste Versuch fragt
    // sofort wieder awork an, statt vom Fehler-Backoff ausgebremst zu werden.
    client.zustand.kaputt = false;
    const dritter = await lade();
    expect(dritter.board.lanes[0].name).toBe("Lea Stöber");
    expect(client.zustand.aufrufe).toBe(3);
  });

  it("holt nach verwerfen() frisch ab, obwohl die TTL noch läuft", async () => {
    const client = fakeClient();
    let ms = 0;
    const lade = erstelleBoardLader({
      client,
      ttlMs: 30_000,
      jetztFn: () => new Date(1_756_200_000_000 + ms),
    });
    await lade();
    ms = 10_000;
    await lade();
    expect(client.zustand.aufrufe).toBe(1); // Cache-Treffer

    lade.verwerfen();
    const frisch = await lade();
    expect(client.zustand.aufrufe).toBe(2);
    expect(frisch.alterSekunden).toBe(0);
  });

  it("holt nach verwerfen() auch bei offenem Fehler-Backoff frisch ab, statt den Stale-Stand zu liefern", async () => {
    const client = fakeClient();
    let ms = 0;
    const lade = erstelleBoardLader({
      client,
      ttlMs: 1_000,
      jetztFn: () => new Date(1_756_200_000_000 + ms),
    });
    await lade();

    client.zustand.wirft = true;
    ms = 2_000; // TTL abgelaufen -> Fehlschlag, Backoff-Frist bis 3_000
    await lade();
    expect(client.zustand.aufrufe).toBe(2);

    ms = 2_100;
    await lade();
    expect(client.zustand.aufrufe).toBe(2); // Backoff: Stale-Stand ohne neuen Versuch

    // Nach dem eigenen Erledigt-Klick MUSS neu geholt werden — sonst sähe der
    // Nutzer seine gerade erledigte Aufgabe weiter im Board.
    client.zustand.wirft = false;
    lade.verwerfen();
    const frisch = await lade();
    expect(client.zustand.aufrufe).toBe(3);
    expect(frisch.alterSekunden).toBe(0);
  });
});

describe("heuteBerlin", () => {
  it("gibt den Berliner Kalendertag zurück (UTC-Abend ist in Berlin schon der nächste Tag)", () => {
    expect(heuteBerlin(new Date("2026-08-26T10:00:00Z"))).toBe("2026-08-26");
    expect(heuteBerlin(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
  });
});
