import type { BoardStand } from "./daten.js";
import type { AufgabenKarte, Board, Lane } from "./board.js";

/**
 * Reine Client-Funktionen (P1): als exportierte TS-Funktionen definiert,
 * damit vitest sie direkt und mit echten Grenzfällen prüfen kann — im
 * bisherigen Template-String liefen sie nie unter Test und rendern bei
 * kaputten Daten "NaN:NaN:NaN" bzw. "NaN.NaN.". String(fn) unten bettet sie
 * ins Client-Skript ein: tsx kompiliert diese Datei vor der Ausführung zu
 * reinem JS (Typannotationen fallen weg), String(fn) liefert genau dieses
 * JS als Text. Deshalb bewusst OHNE Closures (keine Referenz auf etwas
 * außerhalb der eigenen Parameter — im Browser gäbe es den hiesigen
 * Modul-Scope nicht) und nur mit browser-sicheren APIs.
 *
 * FALLE: verschachtelte BENANNTE Funktionsdeklarationen (z. B. ein lokaler
 * `function pad(n) {...}` innerhalb einer dieser drei) lässt esbuilds
 * keepNames-Transform einen Aufruf `__name(pad, "pad")` einbauen — `__name`
 * gibt es im Browser nicht, das würde beim ersten Aufruf einen
 * ReferenceError werfen. String(fn) prüft das nicht, die Text-Assertions
 * unten auch nicht (empirisch gegen `npx tsx` verifiziert). Padding deshalb
 * über String.prototype.padStart, keine verschachtelten Helfer mehr.
 */
export function uhrText(sekunden: number): string {
  if (!Number.isFinite(sekunden)) return "";
  var s = Math.max(0, Math.floor(sekunden));
  var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h + ":" + String(m).padStart(2, "0") + ":" + String(r).padStart(2, "0");
}

export function datumKurz(isoDatum: string): string {
  var d = new Date(isoDatum);
  if (Number.isNaN(d.getTime())) return "";
  return String(d.getUTCDate()).padStart(2, "0") + "." + String(d.getUTCMonth() + 1).padStart(2, "0") + ".";
}

/** null = kein Banner, sonst der Text. Schwelle unverändert bei > 120 s. */
export function bannerText(alterSekunden: number): string | null {
  if (!Number.isFinite(alterSekunden) || alterSekunden <= 120) return null;
  return "awork nicht erreichbar — Stand: vor " + Math.round(alterSekunden / 60) + " Minuten";
}

/**
 * Initialen-Fallback fürs Avatar-Bild (bei Ladefehler): erster Buchstabe
 * von Vor- und Nachname aus lane.name. Bei nur einem Namensteil (z. B.
 * "Gabi" ohne Nachname) dessen erster Buchstabe allein.
 */
export function initialen(name: string): string {
  var teile = name.trim().split(/\s+/).filter(Boolean);
  if (teile.length === 0) return "";
  if (teile.length === 1) return teile[0].charAt(0);
  return teile[0].charAt(0) + teile[teile.length - 1].charAt(0);
}

/**
 * P1-Muster fortgeführt (Task 9): H:MM ohne führende Nullen bei den Stunden,
 * Minuten immer zweistellig, Sekunden abgeschnitten statt gerundet — 59 s
 * ⇒ "0:00", genau wie die volle Sekundenanzeige in uhrText.
 */
export function formatiereZeit(sekunden: number): string {
  if (!Number.isFinite(sekunden) || sekunden < 0) return "";
  var minuten = Math.floor(sekunden / 60);
  var h = Math.floor(minuten / 60), m = minuten % 60;
  return h + ":" + String(m).padStart(2, "0");
}

/**
 * "Heute 1:02 · Vortag 7:45 · Woche 21:03" — Zeitsummen-Zeile unter dem
 * Lane-Namen (Task 9). Ruft formatiereZeit als Geschwister-Funktion auf
 * derselben Einbettungsebene auf — keine Closure, beide Funktionen landen
 * über String(fn) im selben Client-Skript-Scope.
 */
export function zeitZeile(z: { heuteSekunden: number; vortagSekunden: number; wocheSekunden: number }): string {
  return (
    "Heute " + formatiereZeit(z.heuteSekunden) +
    " · Vortag " + formatiereZeit(z.vortagSekunden) +
    " · Woche " + formatiereZeit(z.wocheSekunden)
  );
}

/**
 * Distinct-Projektliste aus allen Timern und Aufgaben des Boards,
 * alphabetisch sortiert (de) — füllt den Projekt-Filter im Kopfbereich
 * (Task 9). Karten ohne Projekt (projektId null) bleiben außen vor.
 */
export function projekteAusBoard(board: Board): { id: string; name: string }[] {
  var karte: Record<string, string> = {};
  board.lanes.forEach(function (lane) {
    if (lane.timer && lane.timer.projektId) {
      karte[lane.timer.projektId] = lane.timer.projektName || lane.timer.projektId;
    }
    lane.aufgaben.forEach(function (aufgabe) {
      if (aufgabe.projektId) {
        karte[aufgabe.projektId] = aufgabe.projektName || aufgabe.projektId;
      }
    });
  });
  var liste: { id: string; name: string }[] = [];
  for (var id in karte) {
    if (Object.prototype.hasOwnProperty.call(karte, id)) {
      liste.push({ id: id, name: karte[id] });
    }
  }
  liste.sort(function (a, b) {
    return a.name.localeCompare(b.name, "de");
  });
  return liste;
}

/**
 * Wendet den Projekt-Filter auf die Lanes an (Task 9): projektId null lässt
 * die Lanes unverändert (dieselbe Referenz zurück). Sonst bleibt eine Lane
 * nur, wenn ihr Timer im gewählten Projekt läuft ODER mindestens eine
 * Aufgabe darin liegt; die Aufgabenliste wird auf das Projekt gefiltert, die
 * Timer-Karte nur behalten, wenn ihr eigenes Projekt zum Filter passt (sonst
 * timer: null — ein Timer in einem fremden Projekt verschwindet auch dann,
 * wenn die Lane wegen einer passenden Aufgabe bleibt).
 */
export function wendeProjektFilterAn(lanes: Lane[], projektId: string | null): Lane[] {
  if (projektId === null) return lanes;
  var ergebnis: Lane[] = [];
  lanes.forEach(function (lane) {
    var timerPasst = lane.timer !== null && lane.timer.projektId === projektId;
    var gefilterteAufgaben = lane.aufgaben.filter(function (a) {
      return a.projektId === projektId;
    });
    if (!timerPasst && gefilterteAufgaben.length === 0) return;
    ergebnis.push({
      userId: lane.userId,
      name: lane.name,
      timer: timerPasst ? lane.timer : null,
      aufgaben: gefilterteAufgaben,
    });
  });
  return ergebnis;
}

/**
 * Wendet die persönlichen Einstellungen (Reihenfolge/Ausblenden) auf die
 * Lanes an (Task 10). Läuft in zeichne() VOR wendeProjektFilterAn.
 *
 * reihenfolge === null ⇒ alphabetische Bestandsreihenfolge (nach lane.name,
 * "de"). Sonst bestimmen die gelisteten awork-User-IDs die Reihenfolge der
 * ersten Lanes; IDs ohne passende Lane werden ignoriert (keine Platzhalter);
 * Lanes ohne Eintrag in reihenfolge landen dahinter, wieder alphabetisch.
 * Ausgeblendete Lanes (per userId in e.ausgeblendet) fehlen komplett in
 * "sichtbar", kommen aber vollständig in "ausgeblendet" zurück — die Seite
 * braucht sie dort für den "N ausgeblendet"-Chip samt Namen.
 */
export function wendeEinstellungenAn(
  lanes: Lane[],
  e: { reihenfolge: string[] | null; ausgeblendet: string[] }
): { sichtbar: Lane[]; ausgeblendet: Lane[] } {
  var ausgeblendetKarte: Record<string, boolean> = {};
  e.ausgeblendet.forEach(function (id) {
    ausgeblendetKarte[id] = true;
  });

  var sichtbareLanes: Lane[] = [];
  var ausgeblendeteLanes: Lane[] = [];
  lanes.forEach(function (lane) {
    if (ausgeblendetKarte[lane.userId]) {
      ausgeblendeteLanes.push(lane);
    } else {
      sichtbareLanes.push(lane);
    }
  });

  var alphabetisch = sichtbareLanes.slice().sort(function (a, b) {
    return a.name.localeCompare(b.name, "de");
  });

  if (e.reihenfolge === null) {
    return { sichtbar: alphabetisch, ausgeblendet: ausgeblendeteLanes };
  }

  var nachId: Record<string, Lane> = {};
  sichtbareLanes.forEach(function (lane) {
    nachId[lane.userId] = lane;
  });
  var verwendet: Record<string, boolean> = {};
  var geordnet: Lane[] = [];
  e.reihenfolge.forEach(function (id) {
    var lane = nachId[id];
    if (lane && !verwendet[id]) {
      geordnet.push(lane);
      verwendet[id] = true;
    }
  });
  alphabetisch.forEach(function (lane) {
    if (!verwendet[lane.userId]) {
      geordnet.push(lane);
    }
  });

  return { sichtbar: geordnet, ausgeblendet: ausgeblendeteLanes };
}

/**
 * Die sechs Zeilen des Detail-Panels (Task 7) in fester Reihenfolge:
 * Zuständig, Projekt, Status, Fällig, Kennung, Priorität. Fehlende, leere
 * und null-Werte werden zu "—", damit im Panel nie eine leere Zeile oder
 * gar "undefined" steht. Ruft datumKurz als Geschwister-Funktion auf
 * derselben Einbettungsebene auf (kein Closure, wie zeitZeile).
 */
export function panelFelder(
  a: AufgabenKarte,
  laneName: string
): { label: string; wert: string }[] {
  var faellig = a.faelligAm ? datumKurz(a.faelligAm) : "";
  return [
    { label: "Zuständig", wert: laneName || "—" },
    { label: "Projekt", wert: a.projektName || "—" },
    { label: "Status", wert: a.statusName || "—" },
    { label: "Fällig", wert: faellig || "—" },
    { label: "Kennung", wert: a.kennung || "—" },
    { label: "Priorität", wert: a.istPrio ? "ja" : "—" },
  ];
}

/**
 * Wer den Erledigt-Knopf im Panel sieht (Task 8). Die Reihenfolge der drei
 * Zweige ist nicht beliebig:
 *  1. Ohne eigene awork-ID ⇒ false, AUCH für Admins: der Server braucht die
 *     ID für den Zurechnungskommentar, /erledigen antwortet ohne sie
 *     garantiert mit 403 — ein Knopf dort wäre ein toter Knopf.
 *  2. Admin ⇒ true, auch auf fremden Aufgaben.
 *  3. Sonst nur, wenn die eigene awork-ID unter den Zuständigen steht.
 * Wie die übrigen P1-Funktionen ohne Closure und nur mit browser-sicheren
 * APIs — sie wird unten per String(...) ins Client-Skript eingebettet.
 */
export function darfErledigen(
  a: { assigneeIds: string[] },
  eigeneAworkId: string | null,
  istAdmin: boolean
): boolean {
  if (!eigeneAworkId) return false;
  if (istAdmin) return true;
  return a.assigneeIds.indexOf(eigeneAworkId) !== -1;
}

/**
 * Wer gerade zusieht (Task 8). Steht bewusst NICHT im BoardStand: der
 * Board-Cache ist für alle Betrachter derselbe und darf keine Identität
 * tragen. Die Route hängt den Betrachter nutzerabhängig an — an die
 * /board-Antwort wie an die gerenderte Seite. null bei via === 'api-key'
 * (der Master-Key hat keine Nutzeridentität).
 */
export interface Betrachter {
  aworkUserId: string | null;
  istAdmin: boolean;
}

/**
 * Rendert das komplette HTML-Dokument. Nutzerdaten (Namen, Aufgabentitel)
 * stehen NUR im JSON-Datenblock — dort wird "<" zu <, damit ein
 * "</script>" in einem Aufgabennamen den Block nicht beenden kann. Das
 * Client-Skript baut alles mit createElement/textContent auf; es gibt
 * keinen Pfad, auf dem Daten als HTML interpretiert werden.
 */
export function renderSeite(stand: BoardStand, betrachter: Betrachter | null): string {
  const daten = JSON.stringify({ ...stand, betrachter }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="de">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Teamboard</title>
<style>
  :root {
    --grund: #f5f6f8; --karte: #ffffff; --tinte: #1c2733; --gedeckt: #6b7a89;
    --linie: #e3e7ec; --aktiv: #0b7a45; --aktiv-grund: #e6f5ed;
    --pause-grund: #eef1f4; --warn: #c0392b; --chip: #eef1f4;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --grund: #14181d; --karte: #1d232b; --tinte: #e8edf2; --gedeckt: #93a1af;
      --linie: #2a323c; --aktiv: #3fbf7f; --aktiv-grund: #17342a;
      --pause-grund: #232a33; --warn: #e07064; --chip: #232a33;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--grund); color: var(--tinte);
    font: 15px/1.45 -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  }
  header {
    display: flex; align-items: baseline; gap: 12px; padding: 14px 20px 6px;
  }
  header h1 { margin: 0; font-size: 18px; letter-spacing: .2px; }
  #stand { color: var(--gedeckt); font-size: 13px; }
  #projekt-filter {
    font: inherit; font-size: 13px; color: var(--tinte); background: var(--karte);
    border: 1px solid var(--linie); border-radius: 6px; padding: 2px 6px;
  }
  .chip-aufheben {
    border: 0; background: none; color: var(--gedeckt); font: inherit; font-size: 11px;
    cursor: pointer; padding: 0; margin-left: 4px; text-decoration: underline;
  }
  #banner {
    display: none; margin: 0 20px; padding: 8px 12px; border-radius: 8px;
    background: var(--warn); color: #fff; font-size: 13px;
  }
  #zeiten-hinweis {
    display: none; margin: 0 20px; padding: 4px 0; color: var(--gedeckt); font-size: 12px;
  }
  #ausgeblendet-liste {
    display: none; margin: 0 20px 8px; padding: 8px 12px; border-radius: 8px;
    background: var(--karte); border: 1px solid var(--linie); font-size: 13px;
  }
  .ausgeblendet-zeile { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 2px 0; }
  .einblenden-btn {
    border: 0; background: none; color: var(--aktiv); font: inherit; font-size: 12px;
    cursor: pointer; padding: 0; text-decoration: underline;
  }
  .zeiten { color: var(--gedeckt); font-size: 12px; margin-top: 2px; }
  #lanes {
    display: flex; gap: 14px; padding: 12px 20px 24px; overflow-x: auto;
    align-items: flex-start;
  }
  .lane {
    flex: 0 0 300px; min-width: 0; background: var(--karte); border: 1px solid var(--linie);
    border-radius: 12px; padding: 12px;
  }
  .lane.aktiv { border-color: var(--aktiv); }
  .lane-kopf { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  .lane-kopf h2 { margin: 0; font-size: 17px; }
  .ausblenden-btn {
    border: 0; background: none; color: var(--gedeckt); font: inherit; font-size: 16px;
    line-height: 1; cursor: pointer; padding: 0 2px; margin-left: auto;
  }
  .avatar {
    width: 36px; height: 36px; border-radius: 50%; flex: none;
    object-fit: cover; background: var(--chip);
  }
  .avatar-initialen {
    display: flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: 700; color: var(--gedeckt);
  }
  .timer {
    border-radius: 10px; padding: 10px; margin-bottom: 12px;
    background: var(--aktiv-grund); border: 1px solid var(--aktiv);
    border-left-width: 4px;
  }
  .timer.pausiert { background: var(--pause-grund); border-color: var(--linie); }
  .timer .uhr { font-variant-numeric: tabular-nums; font-weight: 700; font-size: 27px; }
  .timer .punkt {
    display: inline-block; width: 8px; height: 8px; border-radius: 50%;
    background: var(--aktiv); margin-right: 6px; animation: puls 2s infinite;
  }
  @keyframes puls { 50% { opacity: .25; } }
  .timer .was { margin-top: 2px; font-weight: 600; overflow-wrap: anywhere; }
  .trenner { height: 1px; background: var(--linie); margin: 2px 0 12px; }
  .zeile { color: var(--gedeckt); font-size: 13px; overflow-wrap: anywhere; }
  .karte {
    border: 1px solid var(--linie); border-radius: 10px; padding: 8px 10px;
    margin-bottom: 8px; cursor: pointer;
  }
  .karte .kopf { display: flex; gap: 6px; align-items: baseline; }
  .karte .name { font-weight: 600; flex: 1; overflow-wrap: anywhere; }
  .chip {
    font-size: 11px; padding: 1px 7px; border-radius: 99px; background: var(--chip);
    color: var(--gedeckt); white-space: nowrap;
  }
  .chip.progress { background: var(--aktiv-grund); color: var(--aktiv); }
  .faellig.rot { color: var(--warn); font-weight: 600; }
  .prio { color: var(--warn); font-weight: 700; }
  .mehr {
    width: 100%; border: 0; background: none; color: var(--gedeckt);
    font: inherit; font-size: 13px; cursor: pointer; padding: 4px; text-align: left;
  }
  .leer { color: var(--gedeckt); font-size: 13px; font-style: italic; }
  /* Detail-Panel (Task 7): rechts angedockt, volle Höhe, über dem Board.
     Es fährt über die transform-Klasse .offen ein; ohne sie steht es
     außerhalb des Sichtfelds. Farben ausschließlich über die vorhandenen
     Tokens, damit beide Farbschemata ohne Zusatzregel stimmen. */
  #panel {
    position: fixed; top: 0; right: 0; width: 380px; height: 100%; z-index: 20;
    background: var(--karte); border-left: 1px solid var(--linie);
    padding: 16px 18px; overflow-y: auto;
    transform: translateX(100%); transition: transform .2s ease-out;
  }
  #panel.offen { transform: translateX(0); }
  .panel-kopf { display: flex; align-items: baseline; gap: 8px; margin-bottom: 10px; }
  .panel-titel { margin: 0; font-size: 17px; flex: 1; overflow-wrap: anywhere; }
  .panel-schliessen {
    border: 0; background: none; color: var(--gedeckt); font: inherit; font-size: 20px;
    line-height: 1; cursor: pointer; padding: 0 2px;
  }
  .panel-zeile { display: flex; gap: 10px; padding: 6px 0; border-top: 1px solid var(--linie); }
  .panel-label { color: var(--gedeckt); font-size: 13px; flex: 0 0 90px; }
  .panel-wert { font-size: 13px; flex: 1; min-width: 0; overflow-wrap: anywhere; }
  /* Aktionsbereich des Panels (Task 8): Erledigt-Knopf, Undo-Countdown,
     Hinweis- und Fehlertext. Wieder nur die vorhandenen Farb-Tokens. */
  .panel-aktion { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--linie); }
  .erledigt-btn {
    width: 100%; font: inherit; font-weight: 600; cursor: pointer;
    padding: 8px 10px; border-radius: 8px;
    border: 1px solid var(--aktiv); background: var(--aktiv-grund); color: var(--aktiv);
  }
  .panel-erledigt { font-size: 13px; margin-bottom: 6px; }
  .panel-hinweis { color: var(--gedeckt); font-size: 12px; }
  .panel-fehler { color: var(--warn); font-size: 13px; margin-bottom: 8px; }
  @media (max-width: 560px) { #panel { width: 100%; border-left: 0; } }
</style>
<body>
<header>
  <h1>Teamboard</h1>
  <span id="stand"></span>
  <select id="projekt-filter"></select>
  <span id="projekt-chip"></span>
  <span id="ausgeblendet-chip"></span>
</header>
<div id="banner"></div>
<div id="zeiten-hinweis"></div>
<div id="ausgeblendet-liste"></div>
<div id="lanes"></div>
<div id="panel" hidden></div>
<script id="board-daten" type="application/json">${daten}</script>
<script>
(function () {
  "use strict";
  var MAX_KARTEN = 10;
  var stand;
  try {
    stand = JSON.parse(document.getElementById("board-daten").textContent);
  } catch (fehler) {
    // Kaputte Bootstrap-Daten dürfen nicht zu einer dauerhaft weißen Seite
    // ohne jeden Hinweis auf dem unbeaufsichtigten Monitor führen.
    console.error("teamboard: Bootstrap fehlgeschlagen", fehler);
    document.body.textContent = "Teamboard: Laden fehlgeschlagen — bitte Seite neu laden.";
    return;
  }
  // Bezugszeit: Serverstand + bereits bekanntes Alter → die Uhren starten
  // exakt, auch wenn die Antwort aus dem 10-s-Cache kam.
  var empfangenUm = Date.now();
  // Lane-IDs mit aufgeklapptem "+n weitere" — außerhalb von zeichne(), damit
  // der alle 10s komplette Neuaufbau sie nicht vergisst.
  var aufgeklappteLanes = new Set();
  // Projekt-Filter-Auswahl (Task 9) — ebenfalls außerhalb von zeichne(),
  // überlebt den 10-s-Refresh wie Scroll/Aufklappen. Wird NICHT gespeichert
  // (Spec §6) — reine Client-Variable.
  var ausgewaehltesProjekt = null;
  // Zuletzt geladene Zeitsummen je awork-userId + Hinweis (Task 9) — vom
  // separaten /zeiten-Fetch befüllt, unabhängig vom Board-Stand.
  var zeitenProNutzer = {};
  var zeitenHinweis = null;
  // Persönliche Einstellungen (Reihenfolge/Ausblenden, Task 10) — vom
  // /einstellungen-Fetch beim Start befüllt, danach lokal bei jeder
  // Drag-/Ausblenden-Aktion sofort weitergeschrieben und per PUT gesichert.
  var einstellungen = { reihenfolge: null, ausgeblendet: [] };
  // Ob die Ausgeblendet-Liste unter dem Chip gerade aufgeklappt ist —
  // außerhalb von zeichne(), damit der 10-s-Neuaufbau sie nicht zuklappt.
  var ausgeblendetOffen = false;
  // Von der letzten zeichne()-Runde übrig: die sichtbaren Lanes VOR dem
  // Projekt-Filter (Basis für die Drag-Neuordnung) und die ausgeblendeten
  // Lanes (Basis für die Ausgeblendet-Liste im Chip).
  var letzteSichtbareLanes = [];
  var letzteAusgeblendeteLanes = [];
  // Detail-Panel (Task 7): welche Aufgabe gerade offen ist — außerhalb von
  // zeichne(), damit der 10-s-Neuaufbau das Panel nicht vergisst. Die Lane
  // gehört dazu, weil eine Aufgabe mehrere Zuständige haben kann: ohne sie
  // spränge die Zeile "Zuständig" beim Neubefüllen auf eine fremde Lane.
  var offeneAufgabeId = null;
  var offeneLaneId = null;
  // Laufender Erledigen-Vorgang mit offenem Undo-Fenster (Task 8) — ebenfalls
  // außerhalb von zeichne(). null = kein Vorgang, sonst
  // { aufgabeId, aufgabe, laneName, vorgangId, restSekunden }. Die Kopie der
  // Aufgabe gehört dazu: der Erledigen-Dienst verwirft den Board-Cache, das
  // nächste Nachladen kennt sie nicht mehr — ohne die Kopie zöge sich das
  // Panel noch im Undo-Fenster unter dem Rückgängig-Knopf weg.
  var erledigt = null;
  var undoTicker = null;
  // Läuft gerade ein /erledigen-POST? Sperrt den Knopf gegen Doppelklick:
  // der zweite Versuch bekäme "laeuft_bereits" und schriebe seinen
  // Fehlertext über einen laufenden, funktionierenden Countdown.
  var erledigenLaeuft = false;
  // Läuft gerade ein /rueckgaengig-POST? Dasselbe Muster, aus demselben
  // Grund: bei einem Doppelklick träfe die Erfolgsantwort des ersten POST
  // zuerst ein und gäbe den Vorgang frei; der Fehler-Handler des zweiten
  // liefe danach in einen TypeError auf dem bereits genullten Objekt, den
  // das .catch() lautlos verschluckt.
  var rueckgaengigLaeuft = false;
  // Text der letzten Fehlerantwort — IMMER die message aus der Serverantwort,
  // nie ein im Client erfundener Text. Einzige Ausnahme: kam gar keine
  // Antwort an (Netzwerkfehler im .catch), gibt es keine message, und ohne
  // eigenen Text stünde der Knopf stumm deaktiviert da.
  var panelFehlerText = null;

  function el(tag, klasse, text) {
    var e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // P1: uhrText/datumKurz/bannerText sind oben als exportierte, testbare
  // TS-Funktionen definiert und werden hier als kompiliertes JS eingebettet
  // — Quelle und Client-Laufzeit sind so garantiert identisch.
  ${String(uhrText)}

  ${String(datumKurz)}

  ${String(bannerText)}

  ${String(initialen)}

  // P1 fortgeführt (Task 9): formatiereZeit/zeitZeile/projekteAusBoard/
  // wendeProjektFilterAn sind oben ebenfalls als exportierte, testbare
  // TS-Funktionen definiert und werden hier eingebettet.
  ${String(formatiereZeit)}

  ${String(zeitZeile)}

  ${String(projekteAusBoard)}

  ${String(wendeProjektFilterAn)}

  // Task 10: wendeEinstellungenAn ebenfalls oben als exportierte, testbare
  // TS-Funktion definiert und hier eingebettet.
  ${String(wendeEinstellungenAn)}

  // Task 7: panelFelder ebenfalls oben als exportierte, testbare TS-Funktion
  // definiert und hier eingebettet — ohne diese Zeile gäbe es die Funktion
  // im Browser gar nicht.
  ${String(panelFelder)}

  // Task 8: darfErledigen ebenfalls oben als exportierte, testbare TS-Funktion
  // definiert und hier eingebettet — ohne diese Zeile gäbe es die Funktion im
  // Browser gar nicht.
  ${String(darfErledigen)}

  function extraSekunden() {
    // Wie lange der empfangene Stand schon alt ist (Cache-Alter + Zeit seit Empfang).
    return stand.alterSekunden + (Date.now() - empfangenUm) / 1000;
  }

  function zeichne() {
    var wurzel = document.getElementById("lanes");
    // #lanes scrollt horizontal (mehr Lanes als Bildschirmbreite) — das
    // Leeren würde scrollLeft sonst auf 0 zurückwerfen.
    var scrollLeft = wurzel.scrollLeft;
    wurzel.textContent = "";
    // Erst die persönlichen Einstellungen (Reihenfolge/Ausblenden) anwenden,
    // dann den Projekt-Filter, dann zeichnen (Task 10 — Anwendungsreihenfolge
    // aus Task 9 fortgeführt).
    var angewendet = wendeEinstellungenAn(stand.board.lanes, einstellungen);
    letzteSichtbareLanes = angewendet.sichtbar;
    letzteAusgeblendeteLanes = angewendet.ausgeblendet;
    var lanes = wendeProjektFilterAn(angewendet.sichtbar, ausgewaehltesProjekt);
    lanes.forEach(function (lane) {
      var box = el("section", "lane" + (lane.timer && !lane.timer.pausiert ? " aktiv" : ""));
      var kopf = el("div", "lane-kopf");
      // Ziehbar für die Drag-and-drop-Neuordnung (Task 10). "draggable" ist
      // ein normales HTML-Attribut, kein Event-Handler-Attribut — von der
      // CSP (script-src-attr 'none') nicht betroffen. Die drei Drag-Events
      // selbst laufen ausschließlich über addEventListener, nie über
      // inline onXxx-Attribute.
      kopf.setAttribute("draggable", "true");
      kopf.addEventListener("dragstart", function (ev) {
        ev.dataTransfer.setData("text/plain", lane.userId);
      });
      kopf.addEventListener("dragover", function (ev) {
        // Ohne preventDefault() erlaubt der Browser hier keinen Drop.
        ev.preventDefault();
      });
      kopf.addEventListener("drop", function (ev) {
        ev.preventDefault();
        var gezogeneId = ev.dataTransfer.getData("text/plain");
        if (!gezogeneId || gezogeneId === lane.userId) return;
        einstellungen = {
          reihenfolge: berechneNeueReihenfolge(gezogeneId, lane.userId),
          ausgeblendet: einstellungen.ausgeblendet,
        };
        zeichne();
        speichereEinstellungen();
      });
      var bild = document.createElement("img");
      bild.className = "avatar";
      bild.alt = "";
      // same-origin — der Browser schickt das Session-Cookie automatisch
      // mit; der awork-Token bleibt serverseitig (Route siehe
      // src/routes/teamboard.ts, GET /api/teamboard/avatar/:userId).
      bild.src = "/api/teamboard/avatar/" + lane.userId;
      bild.addEventListener("error", function () {
        var kreis = el("div", "avatar avatar-initialen", initialen(lane.name));
        bild.replaceWith(kreis);
      });
      kopf.appendChild(bild);
      kopf.appendChild(el("h2", null, lane.name));
      var ausblenden = el("button", "ausblenden-btn", "×");
      ausblenden.type = "button";
      ausblenden.title = "Ausblenden";
      ausblenden.addEventListener("click", function () {
        blendeAus(lane.userId);
      });
      kopf.appendChild(ausblenden);
      box.appendChild(kopf);
      if (zeitenProNutzer[lane.userId]) {
        box.appendChild(el("div", "zeiten", zeitZeile(zeitenProNutzer[lane.userId])));
      }
      if (lane.timer) {
        var t = el("div", "timer" + (lane.timer.pausiert ? " pausiert" : ""));
        var uhr = el("div", "uhr");
        if (!lane.timer.pausiert) uhr.appendChild(el("span", "punkt"));
        var zahl = el("span", null, "");
        zahl.setAttribute("data-uhr", String(lane.timer.sekunden));
        zahl.setAttribute("data-pausiert", lane.timer.pausiert ? "1" : "0");
        uhr.appendChild(zahl);
        if (lane.timer.pausiert) uhr.appendChild(el("span", "chip pausiert-chip", "pausiert"));
        t.appendChild(uhr);
        t.appendChild(el("div", "was", lane.timer.aufgabenName || "(ohne Aufgabe)"));
        var wo = [lane.timer.aufgabenKennung, lane.timer.projektName].filter(Boolean).join(" · ");
        if (wo) t.appendChild(el("div", "zeile", wo));
        box.appendChild(t);
        // Sichtbare Trennung zur Aufgabenliste darunter: "das ist der
        // laufende Timer" und "das sind die offenen Aufgaben" als zwei
        // erkennbare Zonen (Jans Wunsch nach der Abnahme, 26.08.2026).
        box.appendChild(el("div", "trenner"));
      }
      if (lane.aufgaben.length === 0 && !lane.timer) {
        box.appendChild(el("div", "leer", "nichts Offenes"));
      }
      var aufgeklappt = aufgeklappteLanes.has(lane.userId);
      var liste = el("div");
      box.appendChild(liste);
      lane.aufgaben.forEach(function (a, i) {
        var k = el("article", "karte");
        if (i >= MAX_KARTEN && !aufgeklappt) k.hidden = true;
        var kopf = el("div", "kopf");
        if (a.istPrio) kopf.appendChild(el("span", "prio", "!"));
        kopf.appendChild(el("span", "name", a.name));
        kopf.appendChild(el("span", "chip" + (a.statusTyp === "progress" ? " progress" : ""), a.statusName));
        k.appendChild(kopf);
        var unten = [a.kennung, a.projektName].filter(Boolean).join(" · ");
        var zeile = el("div", "zeile");
        if (unten) zeile.appendChild(el("span", null, unten + (a.faelligAm ? " · " : "")));
        if (a.faelligAm) zeile.appendChild(el("span", "faellig" + (a.ueberfaellig ? " rot" : ""), "fällig " + datumKurz(a.faelligAm)));
        if (unten || a.faelligAm) k.appendChild(zeile);
        // Klick auf die Karte öffnet das Detail-Panel (Task 7) — per
        // addEventListener wie alles andere hier, nie über ein
        // onclick-Attribut (CSP: script-src-attr 'none').
        k.addEventListener("click", function () {
          oeffnePanel(a.id, lane.userId);
        });
        liste.appendChild(k);
      });
      if (lane.aufgaben.length > MAX_KARTEN && !aufgeklappt) {
        var mehr = el("button", "mehr", "+" + (lane.aufgaben.length - MAX_KARTEN) + " weitere");
        mehr.addEventListener("click", function () {
          aufgeklappteLanes.add(lane.userId);
          liste.querySelectorAll("[hidden]").forEach(function (n) { n.hidden = false; });
          mehr.remove();
        });
        box.appendChild(mehr);
      }
      wurzel.appendChild(box);
    });
    wurzel.scrollLeft = scrollLeft;
    aktualisiereKopf();
    // Ein offenes Panel aus den frischen Daten neu befüllen (Task 7) — es
    // liegt außerhalb von #lanes und überlebt das Leeren oben.
    fuellePanel();
  }

  function aktualisiereKopf() {
    var alter = extraSekunden();
    var banner = document.getElementById("banner");
    var text = bannerText(alter);
    if (text !== null) {
      banner.style.display = "block";
      banner.textContent = text;
    } else {
      banner.style.display = "none";
    }
    var zeit = new Date(Date.parse(stand.board.stand));
    document.getElementById("stand").textContent =
      "Stand " + zeit.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " Uhr";

    // Hinweis auf fehlendes awork-Mapping — dezent, einmal im Kopfbereich,
    // kein Wiederholen pro Lane (Spec §5, Task 9).
    var hinweisEl = document.getElementById("zeiten-hinweis");
    if (zeitenHinweis === "kein_mapping") {
      hinweisEl.style.display = "block";
      hinweisEl.textContent =
        "Zeiten: kein awork-Mapping hinterlegt — ein Admin kann es in der Nutzerverwaltung verknüpfen";
    } else {
      hinweisEl.style.display = "none";
    }

    // Projekt-Filter neu befüllen (Task 9) — Board-Projekte können sich mit
    // jedem Nachladen ändern; die Auswahl selbst bleibt in
    // ausgewaehltesProjekt erhalten (Client-Variable, kein Speichern).
    var projekte = projekteAusBoard(stand.board);
    var filterSelect = document.getElementById("projekt-filter");
    filterSelect.textContent = "";
    var alleOption = document.createElement("option");
    alleOption.value = "";
    alleOption.textContent = "Alle Projekte";
    filterSelect.appendChild(alleOption);
    projekte.forEach(function (p) {
      var option = document.createElement("option");
      option.value = p.id;
      option.textContent = p.name;
      filterSelect.appendChild(option);
    });
    filterSelect.value = ausgewaehltesProjekt || "";

    // Aktiver Filter als Chip mit "Filter aufheben"-Button.
    var chipEl = document.getElementById("projekt-chip");
    chipEl.textContent = "";
    if (ausgewaehltesProjekt !== null) {
      var gefunden = projekte.find(function (p) { return p.id === ausgewaehltesProjekt; });
      chipEl.appendChild(el("span", "chip", gefunden ? gefunden.name : ausgewaehltesProjekt));
      var aufheben = el("button", "chip-aufheben", "Filter aufheben");
      aufheben.addEventListener("click", function () {
        ausgewaehltesProjekt = null;
        zeichne();
      });
      chipEl.appendChild(aufheben);
    }

    // "N ausgeblendet"-Chip mit aufklappbarer Liste + "einblenden"-Buttons
    // (Task 10) — beides per createElement gebaut, keine Inline-Handler.
    var ausgeblendetChipEl = document.getElementById("ausgeblendet-chip");
    ausgeblendetChipEl.textContent = "";
    var ausgeblendetListeEl = document.getElementById("ausgeblendet-liste");
    ausgeblendetListeEl.textContent = "";
    if (letzteAusgeblendeteLanes.length === 0) {
      ausgeblendetOffen = false;
      ausgeblendetListeEl.style.display = "none";
    } else {
      var ausgeblendetBtn = el("button", "chip-aufheben", letzteAusgeblendeteLanes.length + " ausgeblendet");
      ausgeblendetBtn.type = "button";
      ausgeblendetBtn.addEventListener("click", function () {
        ausgeblendetOffen = !ausgeblendetOffen;
        aktualisiereKopf();
      });
      ausgeblendetChipEl.appendChild(ausgeblendetBtn);
      if (ausgeblendetOffen) {
        letzteAusgeblendeteLanes.forEach(function (verborgeneLane) {
          var zeile = el("div", "ausgeblendet-zeile");
          zeile.appendChild(el("span", null, verborgeneLane.name));
          var einblenden = el("button", "einblenden-btn", "einblenden");
          einblenden.type = "button";
          einblenden.addEventListener("click", function () {
            blendeEin(verborgeneLane.userId);
          });
          zeile.appendChild(einblenden);
          ausgeblendetListeEl.appendChild(zeile);
        });
        ausgeblendetListeEl.style.display = "block";
      } else {
        ausgeblendetListeEl.style.display = "none";
      }
    }
  }

  function ticke() {
    var zusatz = extraSekunden() - stand.alterSekunden;
    document.querySelectorAll("[data-uhr]").forEach(function (n) {
      var basis = Number(n.getAttribute("data-uhr"));
      var pausiert = n.getAttribute("data-pausiert") === "1";
      n.textContent = uhrText(pausiert ? basis : basis + stand.alterSekunden + zusatz);
    });
  }

  function nachladen() {
    fetch("/api/teamboard/board", { cache: "no-store" })
      .then(function (res) {
        if (res.status === 401) {
          // Session abgelaufen — Reload landet über den Guard auf dem
          // Login; sofort stoppen, sonst zählt jeder 10-s-Poll in die
          // Brute-Force-Bremse (Karte Risiko 6).
          location.reload();
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then(function (neu) {
        if (!neu) return;
        stand = neu; empfangenUm = Date.now(); zeichne(); ticke(); ladeZeiten();
      })
      .catch(function (fehler) {
        console.warn("teamboard: Nachladen fehlgeschlagen", fehler);
        aktualisiereKopf();
      });
  }

  function ladeZeiten() {
    fetch("/api/teamboard/zeiten", { cache: "no-store" })
      .then(function (res) {
        if (res.status === 401) {
          // Gleiche Behandlung wie beim Board-Fetch (nachladen): Session
          // abgelaufen — sofort stoppen, sonst zählt jeder 10-s-Poll in die
          // Brute-Force-Bremse (Karte Risiko 6).
          location.reload();
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then(function (antwort) {
        if (!antwort) return;
        zeitenProNutzer = antwort.zeiten;
        zeitenHinweis = antwort.hinweis;
        zeichne();
      })
      .catch(function (fehler) {
        console.warn("teamboard: Zeiten laden fehlgeschlagen", fehler);
      });
  }

  // ── Task 10: Persönliche Einstellungen (Reihenfolge/Ausblenden) ─────────
  // Im Gegensatz zum Projekt-Filter (Task 9, nur Client-Variable) werden
  // diese drei Funktionen serverseitig per PUT gesichert.

  function ladeEinstellungen() {
    fetch("/api/teamboard/einstellungen", { cache: "no-store" })
      .then(function (res) {
        if (res.status === 401) {
          // Gleiche Behandlung wie bei Board/Zeiten: Session abgelaufen —
          // sofort stoppen, sonst zählt jeder Versuch in die
          // Brute-Force-Bremse (Karte Risiko 6).
          location.reload();
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then(function (antwort) {
        if (!antwort) return;
        einstellungen = antwort;
        zeichne();
      })
      .catch(function (fehler) {
        console.warn("teamboard: Einstellungen laden fehlgeschlagen", fehler);
      });
  }

  function speichereEinstellungen() {
    fetch("/api/teamboard/einstellungen", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(einstellungen),
    })
      .then(function (res) {
        if (res.status === 401) {
          location.reload();
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
      })
      .catch(function (fehler) {
        console.warn("teamboard: Einstellungen speichern fehlgeschlagen", fehler);
      });
  }

  /**
   * Neue Reihenfolge nach einem Drop: die zuletzt gezeichneten sichtbaren
   * Lanes (VOR dem Projekt-Filter — der darf die gespeicherte Reihenfolge
   * nicht auf eine Teilmenge zusammenstauchen), die gezogene ID entfernt
   * und direkt hinter der Ziel-ID wieder eingefügt.
   */
  function berechneNeueReihenfolge(gezogeneId, zielId) {
    var aktuell = letzteSichtbareLanes.map(function (l) { return l.userId; });
    var ohneGezogene = aktuell.filter(function (id) { return id !== gezogeneId; });
    var zielIndex = ohneGezogene.indexOf(zielId);
    if (zielIndex === -1) return aktuell;
    return ohneGezogene.slice(0, zielIndex + 1).concat([gezogeneId], ohneGezogene.slice(zielIndex + 1));
  }

  function blendeAus(userId) {
    if (einstellungen.ausgeblendet.indexOf(userId) !== -1) return;
    einstellungen = {
      reihenfolge: einstellungen.reihenfolge,
      ausgeblendet: einstellungen.ausgeblendet.concat([userId]),
    };
    zeichne();
    speichereEinstellungen();
  }

  function blendeEin(userId) {
    einstellungen = {
      reihenfolge: einstellungen.reihenfolge,
      ausgeblendet: einstellungen.ausgeblendet.filter(function (id) { return id !== userId; }),
    };
    zeichne();
    speichereEinstellungen();
  }

  // ─── Task 7: Detail-Panel ───────────────────────────────────────────────

  function oeffnePanel(aufgabeId, laneId) {
    offeneAufgabeId = aufgabeId;
    offeneLaneId = laneId;
    // Fehlertext und Erledigen-Zustand gehören zur zuvor gezeigten Aufgabe —
    // nicht mit ins frisch geöffnete Panel schleppen. Bliebe die Kopie einer
    // anderen Aufgabe liegen, fiele fuellePanel() später auf sie zurück.
    panelFehlerText = null;
    if (erledigt !== null && erledigt.aufgabeId !== aufgabeId) beendeUndo();
    var panel = document.getElementById("panel");
    panel.hidden = false;
    fuellePanel();
    // Erst im nächsten Frame einfahren lassen: direkt aus display:none
    // heraus gäbe es keinen Übergang, das Panel stünde schlagartig da.
    requestAnimationFrame(function () {
      if (!panel.hidden) panel.classList.add("offen");
    });
  }

  function schliessePanel() {
    offeneAufgabeId = null;
    offeneLaneId = null;
    panelFehlerText = null;
    // Der Erledigen-Zustand darf die Panel-Ansicht nicht überleben: sonst
    // bliebe die eingefrorene Kartenkopie für immer liegen (der Fehlerpfad
    // des Undo erreicht beendeUndo() sonst nie), fuellePanel() fiele
    // dauerhaft darauf zurück und der Ticker liefe für ein fremdes Panel.
    beendeUndo();
    var panel = document.getElementById("panel");
    panel.classList.remove("offen");
    panel.hidden = true;
    panel.textContent = "";
  }

  /**
   * Befüllt ein offenes Panel aus dem aktuellen Board-Stand — nach jedem
   * zeichne() erneut, damit Status und Fälligkeit nach dem 10-s-Nachladen
   * stimmen. Gesucht wird im rohen Stand, nicht in den gefilterten Lanes:
   * ein Projekt-Filter soll das Panel nicht schließen. Ist die Aufgabe gar
   * nicht mehr im Board (erledigt, umverteilt), schließt es sich.
   */
  function fuellePanel() {
    if (offeneAufgabeId === null) return;
    var gefundeneLane = null;
    var gefundeneAufgabe = null;
    stand.board.lanes.forEach(function (l) {
      if (l.userId !== offeneLaneId) return;
      l.aufgaben.forEach(function (a) {
        if (a.id === offeneAufgabeId) { gefundeneLane = l; gefundeneAufgabe = a; }
      });
    });
    var laneName = gefundeneLane === null ? "" : gefundeneLane.name;
    if (gefundeneAufgabe === null) {
      // Gerade erledigt: das nachgeladene Board kennt die Aufgabe nicht mehr
      // (der Dienst verwirft den Cache). Solange der Vorgang zu genau dieser
      // Aufgabe läuft, bleibt das Panel mit der Kopie stehen — sonst
      // verschwände der Rückgängig-Knopf noch im Undo-Fenster.
      if (erledigt !== null && erledigt.aufgabeId === offeneAufgabeId) {
        gefundeneAufgabe = erledigt.aufgabe;
        laneName = erledigt.laneName;
      } else {
        schliessePanel();
        return;
      }
    }
    var panel = document.getElementById("panel");
    panel.textContent = "";
    var kopf = el("div", "panel-kopf");
    kopf.appendChild(el("h2", "panel-titel", gefundeneAufgabe.name));
    var schliessen = el("button", "panel-schliessen", "×");
    schliessen.type = "button";
    schliessen.title = "Schließen";
    schliessen.addEventListener("click", function () {
      schliessePanel();
    });
    kopf.appendChild(schliessen);
    panel.appendChild(kopf);
    panelFelder(gefundeneAufgabe, laneName).forEach(function (f) {
      var zeile = el("div", "panel-zeile");
      zeile.appendChild(el("span", "panel-label", f.label));
      zeile.appendChild(el("span", "panel-wert", f.wert));
      panel.appendChild(zeile);
    });
    panel.appendChild(baueErledigenBereich(gefundeneAufgabe, laneName));
  }

  // ─── Task 8: Erledigen mit Undo-Fenster ─────────────────────────────────

  /**
   * Der Aktionsbereich unten im Panel: erst der Fehlertext des letzten
   * Versuchs (immer der Text aus der Serverantwort), dann entweder der
   * laufende Undo-Countdown, der Erledigt-Knopf oder der Hinweis, warum es
   * hier keinen Knopf gibt.
   */
  function baueErledigenBereich(aufgabe, laneName) {
    var bereich = el("div", "panel-aktion");
    if (panelFehlerText) {
      bereich.appendChild(el("div", "panel-fehler", panelFehlerText));
    }
    // Der frühe Ausstieg hängt an der Kartenzugehörigkeit, NICHT an der
    // vorgangId: nach Fensterablauf oder gescheitertem Undo bliebe es sonst
    // bei einem aktiven Erledigt-Knopf für eine bereits erledigte Aufgabe.
    if (erledigt !== null && erledigt.aufgabeId === aufgabe.id) {
      bereich.appendChild(el("div", "panel-erledigt", "Als erledigt gemeldet."));
      if (erledigt.vorgangId !== null) {
        // Die Restdauer stammt ausschließlich aus der Serverantwort
        // (undoSekunden) — im Client steht keine Fensterlänge.
        var zurueck = el("button", "erledigt-btn", "Rückgängig (" + erledigt.restSekunden + " s)");
        zurueck.type = "button";
        // Sperre überlebt ein Neuzeichnen während des laufenden POST — der
        // Ticker baut das Panel jede Sekunde neu auf.
        zurueck.disabled = rueckgaengigLaeuft;
        zurueck.addEventListener("click", function () {
          zurueck.disabled = true;
          macheRueckgaengig();
        });
        bereich.appendChild(zurueck);
      }
      return bereich;
    }
    // Der Betrachter hängt an den Board-Daten (Route, nicht Cache); via
    // api-key gibt es keinen — dann bleibt es beim Hinweis.
    var betrachter = stand.betrachter || null;
    var eigeneAworkId = betrachter ? betrachter.aworkUserId : null;
    var istAdmin = betrachter ? betrachter.istAdmin : false;
    if (darfErledigen(aufgabe, eigeneAworkId, istAdmin)) {
      var knopf = el("button", "erledigt-btn", "Erledigt");
      knopf.type = "button";
      // Sperre überlebt ein Neuzeichnen während des laufenden POST.
      knopf.disabled = erledigenLaeuft;
      knopf.addEventListener("click", function () {
        knopf.disabled = true;
        erledige(aufgabe, laneName);
      });
      bereich.appendChild(knopf);
      return bereich;
    }
    bereich.appendChild(el("div", "panel-hinweis", eigeneAworkId
      ? "Nur Zuständige können diese Aufgabe erledigen."
      : "Erledigen geht nur mit hinterlegtem awork-Mapping — ein Admin kann es in der Nutzerverwaltung verknüpfen."));
    return bereich;
  }

  function beendeUndo() {
    if (undoTicker !== null) {
      clearInterval(undoTicker);
      undoTicker = null;
    }
    erledigt = null;
  }

  function tickeUndo() {
    if (erledigt === null) return;
    // Gehört der Vorgang nicht mehr zur offenen Aufgabe, hier aufräumen —
    // sonst baute der Ticker jede Sekunde ein fremdes Panel neu auf
    // (Fokus- und Auswahlverlust).
    if (erledigt.aufgabeId !== offeneAufgabeId) {
      beendeUndo();
      return;
    }
    erledigt.restSekunden = erledigt.restSekunden - 1;
    if (erledigt.restSekunden > 0) {
      fuellePanel();
      return;
    }
    // Fenster abgelaufen: zurück in den normalen Zustand. Das frische Board
    // kennt die Aufgabe nicht mehr, das Panel schließt sich in fuellePanel.
    beendeUndo();
    fuellePanel();
    nachladen();
  }

  function erledige(aufgabe, laneName) {
    if (erledigenLaeuft) return;
    erledigenLaeuft = true;
    panelFehlerText = null;
    fetch("/api/teamboard/erledigen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: aufgabe.id }),
    })
      .then(function (res) {
        if (res.status === 401) {
          // Gleiche Behandlung wie beim Board-Fetch (nachladen): Session
          // abgelaufen — der Reload landet über den Guard auf dem Login.
          location.reload();
          return null;
        }
        return res.json().then(function (koerper) {
          return { ok: res.ok, koerper: koerper };
        });
      })
      .then(function (antwort) {
        erledigenLaeuft = false;
        if (!antwort) return;
        if (!antwort.ok) {
          panelFehlerText = antwort.koerper.message;
          fuellePanel();
          return;
        }
        erledigt = {
          aufgabeId: aufgabe.id,
          aufgabe: aufgabe,
          laneName: laneName,
          vorgangId: antwort.koerper.vorgangId,
          // Eine Sekunde unter dem Serverfenster: bis diese Antwort eintrifft,
          // ist die Roundtrip-Zeit schon vergangen, der Server rechnet aber
          // ab seinem eigenen erledigt_am. Ohne den Abzug zeigte der
          // Countdown in seiner letzten Sekunde ein Fenster an, dessen
          // Rückgängig-Klick serverseitig zu spät käme.
          restSekunden: antwort.koerper.undoSekunden - 1,
        };
        if (undoTicker !== null) clearInterval(undoTicker);
        undoTicker = setInterval(tickeUndo, 1000);
        fuellePanel();
      })
      .catch(function (fehler) {
        erledigenLaeuft = false;
        // Ohne Text und Neuzeichnen bliebe der Knopf nach einem
        // Netzwerkfehler deaktiviert und ohne Erklärung stehen, bis der
        // nächste Poll ihn zufällig neu zeichnet. Der Text sagt bewusst
        // nicht, dass nichts passiert sei: die Anfrage kann den Server
        // erreicht haben, nur die Antwort kam nicht an.
        panelFehlerText =
          "Verbindung zum Server unterbrochen — bitte neu laden und nachsehen, ob die Aufgabe erledigt ist.";
        fuellePanel();
        console.warn("teamboard: Erledigen fehlgeschlagen", fehler);
      });
  }

  function macheRueckgaengig() {
    if (erledigt === null || erledigt.vorgangId === null) return;
    if (rueckgaengigLaeuft) return;
    rueckgaengigLaeuft = true;
    panelFehlerText = null;
    fetch("/api/teamboard/rueckgaengig", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vorgangId: erledigt.vorgangId }),
    })
      .then(function (res) {
        if (res.status === 401) {
          location.reload();
          return null;
        }
        return res.json().then(function (koerper) {
          return { ok: res.ok, koerper: koerper };
        });
      })
      .then(function (antwort) {
        rueckgaengigLaeuft = false;
        if (!antwort) return;
        if (!antwort.ok) {
          // Servertext zeigen und den Countdown beenden: die Aufgabe bleibt
          // erledigt, ein zweiter Versuch scheiterte genauso. Die Kopie
          // bleibt stehen, damit der Text im Panel sichtbar bleibt.
          panelFehlerText = antwort.koerper.message;
          if (undoTicker !== null) {
            clearInterval(undoTicker);
            undoTicker = null;
          }
          // Der Vorgang kann inzwischen weg sein (Schließen-Knopf während des
          // laufenden POST ruft beendeUndo) — ohne die Prüfung stünde hier
          // ein TypeError, den das .catch() lautlos schluckt.
          if (erledigt !== null) erledigt.vorgangId = null;
          fuellePanel();
          return;
        }
        // Die Aufgabe steht wieder offen — frisches Board holen, dessen
        // zeichne() das Panel aus den echten Daten neu befüllt.
        beendeUndo();
        nachladen();
      })
      .catch(function (fehler) {
        rueckgaengigLaeuft = false;
        console.warn("teamboard: Rückgängig fehlgeschlagen", fehler);
      });
  }

  // Escape schließt das Panel — ein einziger dokumentweiter Listener,
  // gesetzt wie alle anderen per addEventListener. Solange ein Undo-Fenster
  // läuft, bleibt Escape aber wirkungslos: es ist der reflexhafteste
  // Tastendruck überhaupt, und schliessePanel() ruft beendeUndo() — ein
  // Fehlgriff kostete also unwiderruflich das Rückgängigmachen, während der
  // Zurechnungskommentar in awork trotzdem entstünde. Der Schließen-Knopf
  // schließt weiterhin: das ist eine bewusste Entscheidung des Nutzers.
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape") return;
    if (erledigt !== null && erledigt.vorgangId !== null) return;
    schliessePanel();
  });

  // Projekt-Filter-Auswahl: Änderung landet in der Client-Variable, kein
  // Speichern (Spec §6). Der Listener wird nur einmal gesetzt — die
  // <option>-Kinder werden bei jedem aktualisiereKopf() neu aufgebaut, das
  // <select>-Element selbst bleibt dabei erhalten.
  document.getElementById("projekt-filter").addEventListener("change", function (ev) {
    ausgewaehltesProjekt = ev.target.value || null;
    zeichne();
  });

  // Sofortiges Nachladen beim Tab-Wechsel (Stufe 3, Task 9): Rückkehr in
  // den Tab soll nicht erst auf den nächsten 10-s-Poll warten. Ruft
  // dieselbe nachladen() wie das Intervall auf, samt ihrer
  // 401-Behandlung — kein eigener Fetch-Pfad daneben.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") nachladen();
  });

  zeichne();
  ticke();
  ladeZeiten();
  ladeEinstellungen();
  setInterval(ticke, 1000);
  setInterval(nachladen, 10000);
})();
</script>
</body>
</html>
`;
}
