import { describe, it, expect, beforeEach, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openDb } from "../src/core/db.js";
import { UserStore } from "../src/core/users.js";
import {
  TeamboardErledigungenStore,
  UNDO_FENSTER_MS,
  MAX_KOMMENTAR_FEHLVERSUCHE,
} from "../src/core/teamboard-erledigungen.js";
import {
  erstelleErledigenDienst,
  KOMMENTAR_KARENZ_MS,
} from "../src/services/teamboard/erledigen.js";
import type { AufgabenKarte } from "../src/services/teamboard/board.js";
import type { BoardStand } from "../src/services/teamboard/daten.js";

// ─── Testhilfen ──────────────────────────────────────────────────

const STATUS = {
  offen: { id: "s-offen", name: "Zu erledigen", type: "todo" },
  arbeit: { id: "s-arbeit", name: "In Bearbeitung", type: "progress" },
  fertig: { id: "s-fertig", name: "Erledigt", type: "done" },
};
const ALLE_STATUS = [STATUS.offen, STATUS.arbeit, STATUS.fertig];

interface AworkAufgabe {
  id: string;
  name: string;
  taskStatusId: string | null;
  taskStatus: { id: string; name: string; type: string } | null;
  projectId: string | null;
  isRecurring: boolean;
}

function aworkAufgabe(id: string, over?: Partial<AworkAufgabe>): AworkAufgabe {
  return {
    id,
    name: `Aufgabe ${id}`,
    taskStatusId: STATUS.arbeit.id,
    taskStatus: STATUS.arbeit,
    projectId: "proj-1",
    isRecurring: false,
    ...over,
  };
}

/**
 * awork als vi.fn()-Attrappe mit einem winzigen Zustand: changeTaskStatus
 * schreibt (wie die echte API) nichts zurück, sondern verändert nur die
 * Aufgabe, die das nächste getTask liefert. Über `wechselWirkt` lässt sich
 * genau der Fall bauen, den awork real erzeugen kann: 204 ohne Fehler,
 * aber kein Statuswechsel.
 */
function fakeAwork(opts?: {
  aufgaben?: Record<string, AworkAufgabe | null>;
  statuses?: { id: string; name: string; type: string }[];
  wechselWirkt?: boolean;
}) {
  const zustand = {
    aufgaben: opts?.aufgaben ?? { "task-1": aworkAufgabe("task-1") },
    statuses: opts?.statuses ?? ALLE_STATUS,
    wechselWirkt: opts?.wechselWirkt ?? true,
  };
  const awork = {
    getTaskStatuses: vi.fn(async (_projectId: string) => zustand.statuses),
    changeTaskStatus: vi.fn(async (taskId: string, statusId: string) => {
      const aufgabe = zustand.aufgaben[taskId];
      if (!zustand.wechselWirkt || !aufgabe) return;
      zustand.aufgaben[taskId] = {
        ...aufgabe,
        taskStatusId: statusId,
        taskStatus: zustand.statuses.find((s) => s.id === statusId) ?? null,
      };
    }),
    getTask: vi.fn(async (taskId: string) => zustand.aufgaben[taskId] ?? null),
    createTaskComment: vi.fn(async (_taskId: string, _text: string, _userId: string) => {}),
  };
  return { awork, zustand };
}

function karte(id: string, assigneeIds: string[], over?: Partial<AufgabenKarte>): AufgabenKarte {
  return {
    id,
    name: `Aufgabe ${id}`,
    kennung: null,
    projektName: "Projekt",
    projektId: "proj-1",
    statusName: "In Bearbeitung",
    statusTyp: "progress",
    faelligAm: null,
    istPrio: false,
    istWiederkehrend: false,
    assigneeIds,
    ueberfaellig: false,
    ...over,
  };
}

/** Board-Stand mit je einer Lane pro Zuständigem der übergebenen Karten. */
function boardStand(karten: AufgabenKarte[]): BoardStand {
  const userIds = [...new Set(karten.flatMap((k) => k.assigneeIds))];
  return {
    board: {
      stand: "2026-08-27T10:00:00.000Z",
      lanes: userIds.map((userId) => ({
        userId,
        name: `Nutzer ${userId}`,
        timer: null,
        aufgaben: karten.filter((k) => k.assigneeIds.includes(userId)),
      })),
    },
    alterSekunden: 0,
  };
}

describe("erstelleErledigenDienst", () => {
  let db: DatabaseSync;
  let users: UserStore;
  let store: TeamboardErledigungenStore;

  beforeEach(() => {
    db = openDb(":memory:");
    users = new UserStore(db);
    store = new TeamboardErledigungenStore(db);
  });

  const neuerNutzer = (email = "lea@straightup-digital.de") =>
    users.create({ email, name: "Lea", role: "member" as const, password: "geheimgeheim" });

  function baueDienst(opts: {
    awork: ReturnType<typeof fakeAwork>["awork"];
    karten: AufgabenKarte[];
  }) {
    const cacheVerwerfen = vi.fn();
    const dienst = erstelleErledigenDienst({
      awork: opts.awork,
      store,
      ladeBoard: async () => boardStand(opts.karten),
      cacheVerwerfen,
    });
    return { dienst, cacheVerwerfen };
  }

  // ─── erledige: Berechtigung ────────────────────────────────────

  it("(a) meldet nicht_gefunden für eine Aufgabe, die nicht im Board steht — ohne awork zu fragen", async () => {
    const nutzer = neuerNutzer();
    const { awork } = fakeAwork();
    const { dienst } = baueDienst({ awork, karten: [karte("task-1", ["aw-lea"])] });

    const ergebnis = await dienst.erledige({
      taskId: "task-fremd",
      userId: nutzer.id,
      aworkUserId: "aw-lea",
      istAdmin: false,
    });

    expect(ergebnis).toEqual({ ok: false, fehler: "nicht_gefunden" });
    expect(awork.getTask).not.toHaveBeenCalled();
    expect(awork.getTaskStatuses).not.toHaveBeenCalled();
    expect(awork.changeTaskStatus).not.toHaveBeenCalled();
  });

  it("(b) meldet keine_berechtigung, wenn ein Member nicht unter den Zuständigen der Karte steht", async () => {
    const nutzer = neuerNutzer();
    const { awork } = fakeAwork();
    const { dienst } = baueDienst({ awork, karten: [karte("task-1", ["aw-lea"])] });

    const ergebnis = await dienst.erledige({
      taskId: "task-1",
      userId: nutzer.id,
      aworkUserId: "aw-max",
      istAdmin: false,
    });

    expect(ergebnis).toEqual({ ok: false, fehler: "keine_berechtigung" });
    expect(awork.changeTaskStatus).not.toHaveBeenCalled();
  });

  it("(c) erledigt eine Aufgabe des Zuständigen, setzt den done-Status und verwirft den Board-Cache", async () => {
    const nutzer = neuerNutzer();
    const { awork } = fakeAwork();
    const { dienst, cacheVerwerfen } = baueDienst({ awork, karten: [karte("task-1", ["aw-lea"])] });

    const ergebnis = await dienst.erledige({
      taskId: "task-1",
      userId: nutzer.id,
      aworkUserId: "aw-lea",
      istAdmin: false,
    });

    expect(ergebnis.ok).toBe(true);
    expect(awork.changeTaskStatus).toHaveBeenCalledWith("task-1", STATUS.fertig.id);
    expect(cacheVerwerfen).toHaveBeenCalledTimes(1);

    const vorgangId = (ergebnis as { ok: true; vorgangId: number }).vorgangId;
    const vorgang = store.finde(vorgangId)!;
    expect(vorgang.taskId).toBe("task-1");
    expect(vorgang.taskName).toBe("Aufgabe task-1");
    expect(vorgang.projectId).toBe("proj-1");
    expect(vorgang.alterStatusId).toBe(STATUS.arbeit.id);
    expect(vorgang.userId).toBe(nutzer.id);
    expect(vorgang.aworkUserId).toBe("aw-lea");
  });

  it("(c2) lässt auch den zweiten von zwei Zuständigen erledigen — geprüft wird karte.assigneeIds, nicht die Lane", async () => {
    const nutzer = neuerNutzer();
    const { awork } = fakeAwork();
    const { dienst } = baueDienst({ awork, karten: [karte("task-1", ["aw-lea", "aw-max"])] });

    const ergebnis = await dienst.erledige({
      taskId: "task-1",
      userId: nutzer.id,
      aworkUserId: "aw-max",
      istAdmin: false,
    });

    expect(ergebnis.ok).toBe(true);
  });

  it("(d) lässt einen Admin auch eine fremde Aufgabe erledigen", async () => {
    const nutzer = neuerNutzer();
    const { awork } = fakeAwork();
    const { dienst } = baueDienst({ awork, karten: [karte("task-1", ["aw-lea"])] });

    const ergebnis = await dienst.erledige({
      taskId: "task-1",
      userId: nutzer.id,
      aworkUserId: "aw-admin",
      istAdmin: true,
    });

    expect(ergebnis.ok).toBe(true);
  });

  // ─── erledige: Vorher-Lesen und Schreibpfad ────────────────────

  it("(e) meldet kein_done_status, wenn das Projekt keinen Status mit type done hat — ohne Wechsel", async () => {
    const nutzer = neuerNutzer();
    const { awork } = fakeAwork({ statuses: [STATUS.offen, STATUS.arbeit] });
    const { dienst, cacheVerwerfen } = baueDienst({ awork, karten: [karte("task-1", ["aw-lea"])] });

    const ergebnis = await dienst.erledige({
      taskId: "task-1",
      userId: nutzer.id,
      aworkUserId: "aw-lea",
      istAdmin: false,
    });

    expect(ergebnis).toEqual({ ok: false, fehler: "kein_done_status" });
    expect(awork.changeTaskStatus).not.toHaveBeenCalled();
    expect(cacheVerwerfen).not.toHaveBeenCalled();
  });

  it("(f) meldet nicht_gewechselt, wenn changeTaskStatus nicht wirft, das Nachlesen aber kein done zeigt", async () => {
    const nutzer = neuerNutzer();
    const { awork } = fakeAwork({ wechselWirkt: false });
    const { dienst, cacheVerwerfen } = baueDienst({ awork, karten: [karte("task-1", ["aw-lea"])] });

    const ergebnis = await dienst.erledige({
      taskId: "task-1",
      userId: nutzer.id,
      aworkUserId: "aw-lea",
      istAdmin: false,
    });

    expect(ergebnis).toEqual({ ok: false, fehler: "nicht_gewechselt" });
    expect(awork.changeTaskStatus).toHaveBeenCalledTimes(1);
    // vorher lesen + nachlesen + zweiter Blick (I2)
    expect(awork.getTask).toHaveBeenCalledTimes(3);
    expect(store.findeOffenenVorgang("task-1", MAX_KOMMENTAR_FEHLVERSUCHE)).toBeUndefined();
    expect(cacheVerwerfen).not.toHaveBeenCalled();
  });

  it("(f3) legt den Vorgang an, wenn erst der ZWEITE Blick done zeigt — Read-after-Write über zwei HTTP-Anfragen ist nicht garantiert (I2)", async () => {
    const nutzer = neuerNutzer();
    const { awork } = fakeAwork();
    let getTaskAufrufe = 0;
    awork.getTask.mockImplementation(async (_taskId: string) => {
      getTaskAufrufe += 1;
      // 1 = Vorher-Lesen, 2 = Nachlesen mit noch altem Status (awork hat den
      // Wechsel mit 204 angenommen), 3 = zweiter Blick, jetzt done.
      if (getTaskAufrufe < 3) return aworkAufgabe("task-1");
      return aworkAufgabe("task-1", { taskStatusId: STATUS.fertig.id, taskStatus: STATUS.fertig });
    });
    const { dienst, cacheVerwerfen } = baueDienst({ awork, karten: [karte("task-1", ["aw-lea"])] });

    const ergebnis = await dienst.erledige({
      taskId: "task-1",
      userId: nutzer.id,
      aworkUserId: "aw-lea",
      istAdmin: false,
    });

    expect(ergebnis.ok).toBe(true);
    expect(awork.changeTaskStatus).toHaveBeenCalledTimes(1); // NICHT zweimal geschrieben
    expect(getTaskAufrufe).toBe(3);
    const vorgang = store.finde((ergebnis as { ok: true; vorgangId: number }).vorgangId)!;
    expect(vorgang.alterStatusId).toBe(STATUS.arbeit.id);
    expect(cacheVerwerfen).toHaveBeenCalledTimes(1);
  });

  it("(f2) legt den Vorgang trotzdem an, wenn das Nachlesen wirft — sonst ginge das Undo still verloren", async () => {
    const nutzer = neuerNutzer();
    const { awork, zustand } = fakeAwork();
    let getTaskAufrufe = 0;
    awork.getTask.mockImplementation(async (taskId: string) => {
      getTaskAufrufe += 1;
      // Der Wechsel ging durch, nur die Bestätigung scheitert.
      if (getTaskAufrufe === 2) throw new Error("awork API 503 Service Unavailable");
      return zustand.aufgaben[taskId] ?? null;
    });
    const { dienst, cacheVerwerfen } = baueDienst({ awork, karten: [karte("task-1", ["aw-lea"])] });
    const stillerLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const ergebnis = await dienst.erledige({
      taskId: "task-1",
      userId: nutzer.id,
      aworkUserId: "aw-lea",
      istAdmin: false,
    });
    stillerLog.mockRestore();

    expect(ergebnis.ok).toBe(true);
    expect(awork.changeTaskStatus).toHaveBeenCalledTimes(1);
    const vorgang = store.finde((ergebnis as { ok: true; vorgangId: number }).vorgangId)!;
    expect(vorgang.alterStatusId).toBe(STATUS.arbeit.id); // Undo bleibt möglich
    expect(cacheVerwerfen).toHaveBeenCalledTimes(1);
  });

  it("(g) fragt den done-Status je Projekt nur einmal ab, cacht eine gescheiterte Auflösung aber nicht", async () => {
    const nutzer = neuerNutzer();
    const { awork, zustand } = fakeAwork({
      aufgaben: {
        "task-1": aworkAufgabe("task-1"),
        "task-2": aworkAufgabe("task-2"),
        "task-3": aworkAufgabe("task-3"),
      },
      statuses: [STATUS.offen, STATUS.arbeit],
    });
    const { dienst } = baueDienst({
      awork,
      karten: [
        karte("task-1", ["aw-lea"]),
        karte("task-2", ["aw-lea"]),
        karte("task-3", ["aw-lea"]),
      ],
    });
    const erledige = (taskId: string) =>
      dienst.erledige({ taskId, userId: nutzer.id, aworkUserId: "aw-lea", istAdmin: false });

    // Gescheiterte Auflösung: darf nicht in den Cache wandern.
    expect(await erledige("task-1")).toEqual({ ok: false, fehler: "kein_done_status" });
    expect(awork.getTaskStatuses).toHaveBeenCalledTimes(1);

    zustand.statuses = ALLE_STATUS;
    expect((await erledige("task-2")).ok).toBe(true);
    expect(awork.getTaskStatuses).toHaveBeenCalledTimes(2); // erneut aufgelöst

    // Jetzt liegt die done-ID im Cache — der nächste Vorgang fragt nicht nach.
    expect((await erledige("task-3")).ok).toBe(true);
    expect(awork.getTaskStatuses).toHaveBeenCalledTimes(2);
  });

  it("(j) nimmt Status-ID, Namen und Projekt aus getTask — nie aus der (bis zu 60s alten) Board-Karte", async () => {
    const nutzer = neuerNutzer();
    // Die Karte ist in JEDEM Feld veraltet, das in den Schreibpfad passt:
    // anderer Status (jemand hat verschoben), alter Name, altes Projekt.
    // awork ist die Wahrheit für alles, was zurückgeschrieben oder
    // protokolliert wird; die Karte entscheidet nur die Berechtigung.
    const { awork } = fakeAwork({
      aufgaben: {
        "task-1": aworkAufgabe("task-1", {
          name: "Aufgabe task-1",
          projectId: "proj-1",
          taskStatusId: STATUS.offen.id,
          taskStatus: STATUS.offen,
        }),
      },
    });
    const { dienst } = baueDienst({
      awork,
      karten: [
        karte("task-1", ["aw-lea"], {
          name: "ALTER NAME AUS DEM CACHE",
          projektId: "proj-VERALTET",
          statusName: "In Bearbeitung",
          statusTyp: "progress",
        }),
      ],
    });

    const ergebnis = await dienst.erledige({
      taskId: "task-1",
      userId: nutzer.id,
      aworkUserId: "aw-lea",
      istAdmin: false,
    });

    const vorgang = store.finde((ergebnis as { ok: true; vorgangId: number }).vorgangId)!;
    expect(vorgang.alterStatusId).toBe(STATUS.offen.id);
    expect(vorgang.taskName).toBe("Aufgabe task-1");
    expect(vorgang.projectId).toBe("proj-1");
    // Auch der done-Status wird für das Projekt aus getTask aufgelöst.
    expect(awork.getTaskStatuses).toHaveBeenCalledTimes(1);
    expect(awork.getTaskStatuses).toHaveBeenCalledWith("proj-1");
  });

  it("(k) meldet schon_erledigt, wenn awork die Aufgabe beim Vorher-Lesen bereits als done führt", async () => {
    const nutzer = neuerNutzer();
    const { awork } = fakeAwork({
      aufgaben: {
        "task-1": aworkAufgabe("task-1", { taskStatusId: STATUS.fertig.id, taskStatus: STATUS.fertig }),
      },
    });
    const { dienst } = baueDienst({ awork, karten: [karte("task-1", ["aw-lea"])] });

    const ergebnis = await dienst.erledige({
      taskId: "task-1",
      userId: nutzer.id,
      aworkUserId: "aw-lea",
      istAdmin: false,
    });

    expect(ergebnis).toEqual({ ok: false, fehler: "schon_erledigt" });
    expect(awork.changeTaskStatus).not.toHaveBeenCalled();
  });

  it("(k2) meldet nicht_gefunden, wenn awork die Aufgabe nicht kennt (getTask liefert null)", async () => {
    const nutzer = neuerNutzer();
    const { awork } = fakeAwork({ aufgaben: { "task-1": null } });
    const { dienst } = baueDienst({ awork, karten: [karte("task-1", ["aw-lea"])] });

    const ergebnis = await dienst.erledige({
      taskId: "task-1",
      userId: nutzer.id,
      aworkUserId: "aw-lea",
      istAdmin: false,
    });

    expect(ergebnis).toEqual({ ok: false, fehler: "nicht_gefunden" });
    expect(awork.changeTaskStatus).not.toHaveBeenCalled();
  });

  it("(l) blockt den zweiten Klick auf dieselbe Aufgabe mit laeuft_bereits — ohne zweiten Vorgang", async () => {
    const nutzer = neuerNutzer();
    const { awork } = fakeAwork();
    const { dienst } = baueDienst({ awork, karten: [karte("task-1", ["aw-lea"])] });
    const erledige = () =>
      dienst.erledige({ taskId: "task-1", userId: nutzer.id, aworkUserId: "aw-lea", istAdmin: false });

    expect((await erledige()).ok).toBe(true);
    const aufrufeNachErstem = awork.changeTaskStatus.mock.calls.length;

    expect(await erledige()).toEqual({ ok: false, fehler: "laeuft_bereits" });
    expect(awork.changeTaskStatus.mock.calls.length).toBe(aufrufeNachErstem);
    const anzahl = db
      .prepare("SELECT COUNT(*) AS n FROM teamboard_erledigungen WHERE task_id = ?")
      .get("task-1") as { n: number };
    expect(anzahl.n).toBe(1);
  });

  it("(l2) blockt nicht mehr, wenn der offene Vorgang die Fehlversuchsgrenze erreicht hat", async () => {
    const nutzer = neuerNutzer();
    const { awork } = fakeAwork();
    const { dienst } = baueDienst({ awork, karten: [karte("task-1", ["aw-lea"])] });
    const gescheitert = store.anlegen({
      taskId: "task-1",
      taskName: "Aufgabe task-1",
      projectId: "proj-1",
      alterStatusId: STATUS.arbeit.id,
      userId: nutzer.id,
      aworkUserId: "aw-lea",
    });
    const stillerLog = vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i < MAX_KOMMENTAR_FEHLVERSUCHE; i++) store.zaehleFehlversuch(gescheitert.id);
    stillerLog.mockRestore();

    const ergebnis = await dienst.erledige({
      taskId: "task-1",
      userId: nutzer.id,
      aworkUserId: "aw-lea",
      istAdmin: false,
    });

    expect(ergebnis.ok).toBe(true);
  });

  it("(l3) lässt bei zwei echt gleichzeitigen Klicks nur einen Vorgang entstehen", async () => {
    const nutzer = neuerNutzer();
    const { awork } = fakeAwork();
    const { dienst } = baueDienst({ awork, karten: [karte("task-1", ["aw-lea"])] });
    const klick = () =>
      dienst.erledige({ taskId: "task-1", userId: nutzer.id, aworkUserId: "aw-lea", istAdmin: false });

    // Beide Aufrufe starten, bevor der erste seinen Vorgang schreiben kann —
    // der Blick in die DB allein sähe hier zweimal "kein offener Vorgang"
    // und liesse später zwei Kommentare für dieselbe Aufgabe entstehen.
    const ergebnisse = await Promise.all([klick(), klick()]);

    expect(ergebnisse.filter((e) => e.ok)).toHaveLength(1);
    expect(ergebnisse.filter((e) => !e.ok)).toEqual([{ ok: false, fehler: "laeuft_bereits" }]);
    expect(awork.changeTaskStatus).toHaveBeenCalledTimes(1);
    const anzahl = db
      .prepare("SELECT COUNT(*) AS n FROM teamboard_erledigungen WHERE task_id = ?")
      .get("task-1") as { n: number };
    expect(anzahl.n).toBe(1);
  });

  it("(m) meldet nicht_erledigbar bei fehlender projectId, fehlender taskStatusId oder fehlendem taskStatus — vor jedem Schreibaufruf", async () => {
    const nutzer = neuerNutzer();
    const unvollstaendig: Partial<AworkAufgabe>[] = [
      { projectId: null },
      { taskStatusId: null },
      { taskStatus: null },
    ];
    for (const luecke of unvollstaendig) {
      const { awork } = fakeAwork({
        aufgaben: { "task-1": aworkAufgabe("task-1", luecke) },
      });
      const { dienst } = baueDienst({ awork, karten: [karte("task-1", ["aw-lea"])] });

      const ergebnis = await dienst.erledige({
        taskId: "task-1",
        userId: nutzer.id,
        aworkUserId: "aw-lea",
        istAdmin: false,
      });

      expect(ergebnis).toEqual({ ok: false, fehler: "nicht_erledigbar" });
      expect(awork.changeTaskStatus).not.toHaveBeenCalled();
    }
  });

  // ─── macheRueckgaengig ─────────────────────────────────────────

  function legeVorgangAn(opts: {
    userId: string;
    taskId?: string;
    alterStatusId?: string;
    jetzt?: Date;
  }) {
    return store.anlegen({
      taskId: opts.taskId ?? "task-1",
      taskName: "Aufgabe task-1",
      projectId: "proj-1",
      alterStatusId: opts.alterStatusId ?? STATUS.arbeit.id,
      userId: opts.userId,
      aworkUserId: "aw-lea",
      jetzt: opts.jetzt,
    });
  }

  it("(h1) verweigert das Rückgängigmachen einem fremden Nutzer — auch einem Admin", async () => {
    const urheber = neuerNutzer();
    const admin = users.create({
      email: "jan@straightup-digital.de",
      name: "Jan",
      role: "admin" as const,
      password: "geheimgeheim",
    });
    const { awork } = fakeAwork({
      aufgaben: { "task-1": aworkAufgabe("task-1", { taskStatusId: STATUS.fertig.id, taskStatus: STATUS.fertig }) },
    });
    const { dienst, cacheVerwerfen } = baueDienst({ awork, karten: [] });
    const vorgang = legeVorgangAn({ userId: urheber.id });

    const ergebnis = await dienst.macheRueckgaengig({ vorgangId: vorgang.id, userId: admin.id });

    expect(ergebnis).toEqual({ ok: false, fehler: "keine_berechtigung" });
    expect(awork.changeTaskStatus).not.toHaveBeenCalled();
    expect(cacheVerwerfen).not.toHaveBeenCalled();
  });

  it("(h2) meldet nicht_gefunden für einen unbekannten Vorgang", async () => {
    const nutzer = neuerNutzer();
    const { awork } = fakeAwork();
    const { dienst } = baueDienst({ awork, karten: [] });

    expect(await dienst.macheRueckgaengig({ vorgangId: 999, userId: nutzer.id })).toEqual({
      ok: false,
      fehler: "nicht_gefunden",
    });
    expect(awork.changeTaskStatus).not.toHaveBeenCalled();
  });

  it("(h3) meldet fenster_abgelaufen, sobald das Undo-Fenster vorbei ist", async () => {
    const nutzer = neuerNutzer();
    const { awork } = fakeAwork();
    const { dienst } = baueDienst({ awork, karten: [] });
    const vorgang = legeVorgangAn({
      userId: nutzer.id,
      jetzt: new Date(Date.now() - UNDO_FENSTER_MS - 1_000),
    });

    expect(await dienst.macheRueckgaengig({ vorgangId: vorgang.id, userId: nutzer.id })).toEqual({
      ok: false,
      fehler: "fenster_abgelaufen",
    });
    expect(awork.changeTaskStatus).not.toHaveBeenCalled();
    expect(store.finde(vorgang.id)!.rueckgaengigAm).toBeNull();
  });

  it("(h3b) sperrt das Undo schon bei exakt erreichter Fenstergrenze — dort ist der Kommentarlauf bereits zuständig", async () => {
    const nutzer = neuerNutzer();
    const { awork } = fakeAwork();
    const { dienst } = baueDienst({ awork, karten: [] });
    const vorgang = legeVorgangAn({
      userId: nutzer.id,
      jetzt: new Date(Date.now() - UNDO_FENSTER_MS),
    });

    expect(await dienst.macheRueckgaengig({ vorgangId: vorgang.id, userId: nutzer.id })).toEqual({
      ok: false,
      fehler: "fenster_abgelaufen",
    });
    // Gegenprobe: für die Abfrage des Kommentarlaufs ist derselbe Vorgang
    // bereits fällig. Beides gleichzeitig zulässig wäre genau die
    // Überlappung, die > statt >= offen liesse. (Der Dienst wartet seit I1
    // zusätzlich KOMMENTAR_KARENZ_MS ab — hier zählt die reine Grenze.)
    expect(
      store.offeneKommentare(UNDO_FENSTER_MS, MAX_KOMMENTAR_FEHLVERSUCHE).map((e) => e.id),
    ).toContain(vorgang.id);
  });

  it("(h4) meldet schon_rueckgaengig beim zweiten Undo-Klick", async () => {
    const nutzer = neuerNutzer();
    const { awork } = fakeAwork({
      aufgaben: { "task-1": aworkAufgabe("task-1", { taskStatusId: STATUS.fertig.id, taskStatus: STATUS.fertig }) },
    });
    const { dienst } = baueDienst({ awork, karten: [] });
    const vorgang = legeVorgangAn({ userId: nutzer.id });

    expect(await dienst.macheRueckgaengig({ vorgangId: vorgang.id, userId: nutzer.id })).toEqual({ ok: true });
    expect(await dienst.macheRueckgaengig({ vorgangId: vorgang.id, userId: nutzer.id })).toEqual({
      ok: false,
      fehler: "schon_rueckgaengig",
    });
    expect(awork.changeTaskStatus).toHaveBeenCalledTimes(1);
  });

  it("(h5) meldet nicht_gewechselt und lässt den Vorgang UNMARKIERT, wenn der Rückwechsel nicht greift", async () => {
    const nutzer = neuerNutzer();
    const { awork } = fakeAwork({
      aufgaben: { "task-1": aworkAufgabe("task-1", { taskStatusId: STATUS.fertig.id, taskStatus: STATUS.fertig }) },
      wechselWirkt: false,
    });
    const { dienst, cacheVerwerfen } = baueDienst({ awork, karten: [] });
    const vorgang = legeVorgangAn({ userId: nutzer.id });

    expect(await dienst.macheRueckgaengig({ vorgangId: vorgang.id, userId: nutzer.id })).toEqual({
      ok: false,
      fehler: "nicht_gewechselt",
    });
    expect(store.finde(vorgang.id)!.rueckgaengigAm).toBeNull();
    expect(cacheVerwerfen).not.toHaveBeenCalled();
  });

  it("(h6) schreibt den alten Status zurück, markiert den Vorgang und verwirft den Board-Cache", async () => {
    const nutzer = neuerNutzer();
    const { awork } = fakeAwork({
      aufgaben: { "task-1": aworkAufgabe("task-1", { taskStatusId: STATUS.fertig.id, taskStatus: STATUS.fertig }) },
    });
    const { dienst, cacheVerwerfen } = baueDienst({ awork, karten: [] });
    const vorgang = legeVorgangAn({ userId: nutzer.id, alterStatusId: STATUS.arbeit.id });

    expect(await dienst.macheRueckgaengig({ vorgangId: vorgang.id, userId: nutzer.id })).toEqual({ ok: true });
    expect(awork.changeTaskStatus).toHaveBeenCalledWith("task-1", STATUS.arbeit.id);
    expect(store.finde(vorgang.id)!.rueckgaengigAm).not.toBeNull();
    expect(cacheVerwerfen).toHaveBeenCalledTimes(1);
  });

  // ─── schreibeFaelligeKommentare ────────────────────────────────

  it("(i1) kommentiert nur fällige, nicht widerrufene Vorgänge und markiert sie als kommentiert", async () => {
    const nutzer = neuerNutzer();
    const { awork } = fakeAwork();
    const { dienst } = baueDienst({ awork, karten: [] });
    const faellig = legeVorgangAn({
      userId: nutzer.id,
      taskId: "task-faellig",
      jetzt: new Date(Date.now() - UNDO_FENSTER_MS - KOMMENTAR_KARENZ_MS - 1_000),
    });
    const frisch = legeVorgangAn({ userId: nutzer.id, taskId: "task-frisch" });
    const widerrufen = legeVorgangAn({
      userId: nutzer.id,
      taskId: "task-widerrufen",
      jetzt: new Date(Date.now() - UNDO_FENSTER_MS - KOMMENTAR_KARENZ_MS - 1_000),
    });
    store.markiereRueckgaengig(widerrufen.id);

    const ergebnis = await dienst.schreibeFaelligeKommentare();

    expect(ergebnis).toEqual({ geschrieben: 1, fehlgeschlagen: 0 });
    expect(awork.createTaskComment).toHaveBeenCalledTimes(1);
    expect(awork.createTaskComment).toHaveBeenCalledWith(
      "task-faellig",
      "Erledigt über das Teamboard.",
      "aw-lea",
    );
    expect(store.finde(faellig.id)!.kommentarAm).not.toBeNull();
    expect(store.finde(frisch.id)!.kommentarAm).toBeNull();
    expect(store.finde(widerrufen.id)!.kommentarAm).toBeNull();
  });

  it("(i1b) wartet über das Undo-Fenster hinaus die Karenz ab — ein Vorgang am Fensterrand bekommt noch keinen Kommentar (I1)", async () => {
    const nutzer = neuerNutzer();
    const { awork } = fakeAwork();
    const { dienst } = baueDienst({ awork, karten: [] });
    // Genau der Vorgang aus dem Befund: das Undo-Fenster ist gerade vorbei,
    // der Undo-Roundtrip nach awork kann aber noch unterwegs sein.
    const amRand = legeVorgangAn({
      userId: nutzer.id,
      taskId: "task-rand",
      jetzt: new Date(Date.now() - UNDO_FENSTER_MS - 1_000),
    });

    expect(await dienst.schreibeFaelligeKommentare()).toEqual({ geschrieben: 0, fehlgeschlagen: 0 });
    expect(awork.createTaskComment).not.toHaveBeenCalled();
    expect(store.finde(amRand.id)!.kommentarAm).toBeNull();
    // Gegenprobe: der Store selbst hält ihn längst für fällig — die Karenz
    // sitzt im Dienst, nicht in der Abfrage.
    expect(
      store.offeneKommentare(UNDO_FENSTER_MS, MAX_KOMMENTAR_FEHLVERSUCHE).map((e) => e.id),
    ).toContain(amRand.id);
  });

  it("(i1c) schreibt keinen Kommentar mehr, wenn der Vorgang zwischen Auswahl und awork-Aufruf widerrufen wurde (I1, zweite Hälfte)", async () => {
    const nutzer = neuerNutzer();
    const { awork } = fakeAwork();
    const { dienst } = baueDienst({ awork, karten: [] });
    const vorgang = legeVorgangAn({
      userId: nutzer.id,
      jetzt: new Date(Date.now() - UNDO_FENSTER_MS - KOMMENTAR_KARENZ_MS - 1_000),
    });
    // Der Undo-Pfad markiert, während der Kommentarlauf den Vorgang bereits
    // ausgewählt hat und in awork hängt.
    awork.createTaskComment.mockImplementation(async () => {
      store.markiereRueckgaengig(vorgang.id);
    });

    await dienst.schreibeFaelligeKommentare();

    // Der Vorgang darf NICHT als kommentiert gelten: er ist widerrufen.
    expect(store.finde(vorgang.id)!.kommentarAm).toBeNull();
    expect(store.finde(vorgang.id)!.rueckgaengigAm).not.toBeNull();
  });

  it("(i2) zählt bei einem awork-Fehler einen Fehlversuch und lässt den Vorgang stehen", async () => {
    const nutzer = neuerNutzer();
    const { awork } = fakeAwork();
    awork.createTaskComment.mockRejectedValue(new Error("awork API 500 Internal Server Error"));
    const { dienst } = baueDienst({ awork, karten: [] });
    const vorgang = legeVorgangAn({
      userId: nutzer.id,
      jetzt: new Date(Date.now() - UNDO_FENSTER_MS - KOMMENTAR_KARENZ_MS - 1_000),
    });
    const stillerLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const ergebnis = await dienst.schreibeFaelligeKommentare();
    stillerLog.mockRestore();

    expect(ergebnis).toEqual({ geschrieben: 0, fehlgeschlagen: 1 });
    const nachher = store.finde(vorgang.id)!;
    expect(nachher.fehlversuche).toBe(1);
    expect(nachher.kommentarAm).toBeNull();
  });

  it("(i3) überspringt Vorgänge, die die Fehlversuchsgrenze erreicht haben", async () => {
    const nutzer = neuerNutzer();
    const { awork } = fakeAwork();
    const { dienst } = baueDienst({ awork, karten: [] });
    const vorgang = legeVorgangAn({
      userId: nutzer.id,
      jetzt: new Date(Date.now() - UNDO_FENSTER_MS - KOMMENTAR_KARENZ_MS - 1_000),
    });
    const stillerLog = vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i < MAX_KOMMENTAR_FEHLVERSUCHE; i++) store.zaehleFehlversuch(vorgang.id);
    stillerLog.mockRestore();

    const ergebnis = await dienst.schreibeFaelligeKommentare();

    expect(ergebnis).toEqual({ geschrieben: 0, fehlgeschlagen: 0 });
    expect(awork.createTaskComment).not.toHaveBeenCalled();
  });
});
