import type { AworkClient } from "../awork.js";
import {
  MAX_KOMMENTAR_FEHLVERSUCHE,
  UNDO_FENSTER_MS,
  type TeamboardErledigungenStore,
} from "../../core/teamboard-erledigungen.js";
import type { AufgabenKarte } from "./board.js";
import type { BoardLader } from "./daten.js";

// ─── Fehlerarten ─────────────────────────────────────────────────

export type ErledigenFehler =
  | "nicht_gefunden" // Aufgabe weder im Board noch in awork auffindbar
  | "keine_berechtigung" // Member, aber nicht unter den Zuständigen
  | "schon_erledigt" // awork zeigt beim Vorher-Lesen bereits type==='done' (jemand war schneller)
  | "laeuft_bereits" // für diese Aufgabe ist ein Vorgang offen (Doppelklick / zwei Personen)
  | "nicht_erledigbar" // Aufgabe ohne projectId oder ohne taskStatusId — kein Undo möglich
  | "kein_done_status" // Projekt hat keinen Status mit type==='done'
  | "nicht_gewechselt"; // awork meldete keinen Fehler, Nachlesen zeigt aber kein done

/**
 * Eigener Typ — der Undo-Pfad hat zwei Fehler, die es beim Erledigen nicht
 * gibt. Die Textzuordnung der Route braucht beide Unions getrennt; ein Record
 * über nur ErledigenFehler würde beim Zugriff mit einem Undo-Fehler unter tsc
 * strict nicht kompilieren.
 */
export type RueckgaengigFehler =
  | "nicht_gefunden"
  | "keine_berechtigung"
  | "fenster_abgelaufen"
  | "schon_rueckgaengig"
  | "nicht_gewechselt";

/** Zurechnungskommentar, den awork nach Ablauf des Undo-Fensters bekommt. */
const KOMMENTAR_TEXT = "Erledigt über das Teamboard.";

/**
 * Zusätzliche Wartezeit über UNDO_FENSTER_MS hinaus, bevor ein Vorgang
 * kommentiert wird.
 *
 * Ein Undo-Klick in der letzten Sekunde des Fensters besteht die
 * Fensterprüfung, braucht danach aber noch zwei awork-Runden
 * (changeTaskStatus + Nachlesen), bis `rueckgaengig_am` gesetzt ist. In
 * dieser Spanne sähe der Minutenlauf den Vorgang als offen und fällig und
 * schriebe den Kommentar für eine Erledigung, die gerade widerrufen wird —
 * Spec §2 sagt aber ausdrücklich: bei Rückgängig entsteht in awork gar kein
 * Kommentar. Die Karenz deckt diese zwei Roundtrips ab; der dadurch
 * entstehende Zeitversatz (Fenster + Karenz + bis zu einer Minute Takt)
 * bleibt in dem von der Spec erlaubten Rahmen.
 */
export const KOMMENTAR_KARENZ_MS = 15_000;

/**
 * Pause vor dem zweiten Blick auf die Aufgabe nach dem Statuswechsel. awork
 * bestätigt den Wechsel mit 204; das unmittelbar folgende GET /tasks/{id}
 * ist eine eigene HTTP-Anfrage und kann noch den alten Stand liefern
 * (Read-after-Write über zwei Anfragen ist nirgends zugesichert). Kurz
 * genug, dass der Klick sich weiterhin unmittelbar anfühlt.
 */
const NACHLESE_WARTE_MS = 500;

// ─── Dienst ──────────────────────────────────────────────────────

export function erstelleErledigenDienst(opts: {
  awork: Pick<AworkClient, "getTaskStatuses" | "changeTaskStatus" | "getTask" | "createTaskComment">;
  store: TeamboardErledigungenStore;
  ladeBoard: BoardLader;
  cacheVerwerfen: () => void;
}): {
  erledige(a: { taskId: string; userId: string; aworkUserId: string; istAdmin: boolean }): Promise<
    { ok: true; vorgangId: number } | { ok: false; fehler: ErledigenFehler }
  >;
  macheRueckgaengig(a: { vorgangId: number; userId: string }): Promise<
    { ok: true } | { ok: false; fehler: RueckgaengigFehler }
  >;
  schreibeFaelligeKommentare(): Promise<{ geschrieben: number; fehlgeschlagen: number }>;
} {
  /**
   * done-Status je Projekt, prozessweit und ohne Ablauf: Status-Objekte eines
   * awork-Projekts ändern sich praktisch nie, und jede Auflösung kostet sonst
   * einen zusätzlichen API-Gang pro Klick. Gescheiterte Auflösungen kommen
   * NICHT hinein — sonst bliebe ein nachträglich angelegter done-Status für
   * die Laufzeit des Prozesses unsichtbar.
   */
  const doneStatusCache = new Map<string, string>();

  /**
   * taskIds, für die gerade ein erledige() zwischen Prüfung und store.anlegen
   * hängt. Der DB-Blick allein reicht nicht: zwischen findeOffenenVorgang und
   * anlegen liegen mehrere await, zwei gleichzeitige Anfragen sähen also beide
   * keinen offenen Vorgang und legten beide einen an — mit zwei Zurechnungs-
   * kommentaren in awork für dieselbe Aufgabe als Folge.
   */
  const laufendeAufgaben = new Set<string>();

  async function loeseDoneStatus(projectId: string): Promise<string | null> {
    const gemerkt = doneStatusCache.get(projectId);
    if (gemerkt) return gemerkt;
    const statuses = await opts.awork.getTaskStatuses(projectId);
    const done = statuses.find((s) => s.type === "done");
    if (!done) return null;
    doneStatusCache.set(projectId, done.id);
    return done.id;
  }

  function findeKarte(taskId: string, lanes: { aufgaben: AufgabenKarte[] }[]): AufgabenKarte | undefined {
    for (const lane of lanes) {
      const treffer = lane.aufgaben.find((a) => a.id === taskId);
      if (treffer) return treffer;
    }
    return undefined;
  }

  async function erledige(a: {
    taskId: string;
    userId: string;
    aworkUserId: string;
    istAdmin: boolean;
  }): Promise<{ ok: true; vorgangId: number } | { ok: false; fehler: ErledigenFehler }> {
    // 1. Die Board-Karte entscheidet AUSSCHLIESSLICH die Berechtigung. Der
    //    Board-Cache ist bis zu 30s alt und der Client zeichnet nur alle 30s
    //    neu — real bis zu einer Minute Versatz. Jeder Wert, der später
    //    zurückgeschrieben wird, kommt darum aus getTask (Schritt 3).
    const { board } = await opts.ladeBoard();
    const karte = findeKarte(a.taskId, board.lanes);
    if (!karte) return { ok: false, fehler: "nicht_gefunden" };
    if (!a.istAdmin && !karte.assigneeIds.includes(a.aworkUserId)) {
      return { ok: false, fehler: "keine_berechtigung" };
    }

    // 2. Doppelklick-Schutz: ein offener Vorgang würde sonst zu zwei
    //    Kommentaren für dieselbe Aufgabe führen. Prüfen und Eintragen laufen
    //    ohne dazwischenliegendes await — nur so fängt der Schutz auch zwei
    //    echt gleichzeitige Anfragen ab.
    if (
      opts.store.findeOffenenVorgang(a.taskId, MAX_KOMMENTAR_FEHLVERSUCHE) ||
      laufendeAufgaben.has(a.taskId)
    ) {
      return { ok: false, fehler: "laeuft_bereits" };
    }
    laufendeAufgaben.add(a.taskId);
    try {
      return await erledigeGeprueft(a);
    } finally {
      laufendeAufgaben.delete(a.taskId);
    }
  }

  /** Schritte 3–6 — läuft nur mit Eintrag in laufendeAufgaben. */
  async function erledigeGeprueft(a: {
    taskId: string;
    userId: string;
    aworkUserId: string;
  }): Promise<{ ok: true; vorgangId: number } | { ok: false; fehler: ErledigenFehler }> {
    // 3. Echter Vorher-Zustand — VOR jedem Schreibaufruf.
    const vorher = await opts.awork.getTask(a.taskId);
    if (!vorher) return { ok: false, fehler: "nicht_gefunden" };
    if (vorher.taskStatus?.type === "done") return { ok: false, fehler: "schon_erledigt" };
    // Ohne taskStatus ließe sich schon_erledigt gar nicht entscheiden, ohne
    // projectId/taskStatusId gäbe es später kein Undo.
    if (!vorher.projectId || !vorher.taskStatusId || !vorher.taskStatus) {
      return { ok: false, fehler: "nicht_erledigbar" };
    }
    const alterStatusId = vorher.taskStatusId;

    // 4. done-Status des Projekts auflösen.
    const doneStatusId = await loeseDoneStatus(vorher.projectId);
    if (!doneStatusId) return { ok: false, fehler: "kein_done_status" };

    // 5. Schreiben und nachlesen: changeTaskStatus antwortet 204 mit leerem
    //    Body — ein ausbleibender Fehler beweist den Wechsel NICHT.
    await opts.awork.changeTaskStatus(a.taskId, doneStatusId);
    let nachlese = await leseNach(a.taskId);
    if (!nachlese.gescheitert && nachlese.aufgabe?.taskStatus?.type !== "done") {
      // Der Wechsel kann angenommen und trotzdem noch nicht sichtbar sein:
      // 204 und das folgende GET sind zwei getrennte HTTP-Anfragen. Ein
      // vorschnelles nicht_gewechselt hiesse hier: Aufgabe in awork erledigt,
      // aber kein Vorgang, kein Undo, kein Kommentar, keine Protokollzeile —
      // genau der Zustand, den dieses Feature verhindern soll. Darum ein
      // zweiter Blick nach kurzer Pause.
      await new Promise((fertig) => setTimeout(fertig, NACHLESE_WARTE_MS));
      nachlese = await leseNach(a.taskId);
    }
    if (!nachlese.gescheitert && nachlese.aufgabe?.taskStatus?.type !== "done") {
      // Auch der zweite Blick zeigt kein done — awork hat den Wechsel wirklich
      // nicht übernommen.
      return { ok: false, fehler: "nicht_gewechselt" };
    }

    // 6. Protokollieren (mit der in Schritt 3 gelesenen alten Status-ID) und
    //    den Board-Cache verwerfen.
    const vorgang = opts.store.anlegen({
      taskId: a.taskId,
      taskName: vorher.name,
      projectId: vorher.projectId,
      alterStatusId,
      userId: a.userId,
      aworkUserId: a.aworkUserId,
    });
    opts.cacheVerwerfen();
    return { ok: true, vorgangId: vorgang.id };
  }

  /**
   * Nachlesen nach dem Statuswechsel. Wirft getTask, ist der Wechsel bereits
   * raus und nur die Bestätigung fehlt: abzubrechen hiesse Aufgabe in awork
   * womöglich erledigt, aber kein Vorgang gespeichert — also kein Undo und
   * nie ein Kommentar. Ein still verlorenes Undo wiegt schwerer als ein
   * unbestätigter Wechsel, darum meldet der Fehlerfall `gescheitert` und der
   * Aufrufer legt den Vorgang trotzdem an.
   */
  async function leseNach(taskId: string): Promise<{
    gescheitert: boolean;
    aufgabe: Awaited<ReturnType<typeof opts.awork.getTask>>;
  }> {
    try {
      return { gescheitert: false, aufgabe: await opts.awork.getTask(taskId) };
    } catch (fehler) {
      console.error(
        `teamboard: Nachlesen nach Statuswechsel an Aufgabe ${taskId} fehlgeschlagen —`,
        fehler instanceof Error ? fehler.message : String(fehler),
      );
      return { gescheitert: true, aufgabe: null };
    }
  }

  async function macheRueckgaengig(a: {
    vorgangId: number;
    userId: string;
  }): Promise<{ ok: true } | { ok: false; fehler: RueckgaengigFehler }> {
    const vorgang = opts.store.finde(a.vorgangId);
    if (!vorgang) return { ok: false, fehler: "nicht_gefunden" };
    // Nur der Urheber — auch ein Admin nimmt fremde Klicks nicht zurück.
    if (vorgang.userId !== a.userId) return { ok: false, fehler: "keine_berechtigung" };
    // >= statt >: offeneKommentare() greift ab erledigt_am <= jetzt - vorMs.
    // Bei exakt erreichter Grenze wären sonst Undo und Kommentarschreiben
    // gleichzeitig zulässig.
    if (Date.now() - Date.parse(vorgang.erledigtAm) >= UNDO_FENSTER_MS) {
      return { ok: false, fehler: "fenster_abgelaufen" };
    }
    if (vorgang.rueckgaengigAm !== null) return { ok: false, fehler: "schon_rueckgaengig" };

    await opts.awork.changeTaskStatus(vorgang.taskId, vorgang.alterStatusId);
    // Auch der Rückwechsel wird nachgelesen. Bleibt der Vorgang bei einem
    // stillen Fehlschlag UNMARKIERT: als widerrufen markiert unterbliebe der
    // Kommentar für immer und das Protokoll behauptete eine Rücknahme, die
    // nie stattfand.
    const nachher = await opts.awork.getTask(vorgang.taskId);
    if (nachher?.taskStatusId !== vorgang.alterStatusId) {
      return { ok: false, fehler: "nicht_gewechselt" };
    }

    opts.store.markiereRueckgaengig(vorgang.id);
    opts.cacheVerwerfen();
    return { ok: true };
  }

  async function schreibeFaelligeKommentare(): Promise<{ geschrieben: number; fehlgeschlagen: number }> {
    const faellige = opts.store.offeneKommentare(
      UNDO_FENSTER_MS + KOMMENTAR_KARENZ_MS,
      MAX_KOMMENTAR_FEHLVERSUCHE,
    );
    let geschrieben = 0;
    let fehlgeschlagen = 0;
    for (const vorgang of faellige) {
      try {
        await opts.awork.createTaskComment(vorgang.taskId, KOMMENTAR_TEXT, vorgang.aworkUserId);
        opts.store.markiereKommentiert(vorgang.id);
        geschrieben += 1;
      } catch (fehler) {
        // Der Vorgang bleibt stehen und wird beim nächsten Lauf erneut
        // versucht — bis zur Fehlversuchsgrenze.
        opts.store.zaehleFehlversuch(vorgang.id);
        fehlgeschlagen += 1;
        console.error(
          `teamboard: Kommentar für Erledigung ${vorgang.id} (Aufgabe ${vorgang.taskId}) fehlgeschlagen —`,
          fehler instanceof Error ? fehler.message : String(fehler),
        );
      }
    }
    return { geschrieben, fehlgeschlagen };
  }

  return { erledige, macheRueckgaengig, schreibeFaelligeKommentare };
}
