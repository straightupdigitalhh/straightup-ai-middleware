import type { BoardStand } from "./daten.js";
import type { Board, Lane } from "./board.js";

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
 * Rendert das komplette HTML-Dokument. Nutzerdaten (Namen, Aufgabentitel)
 * stehen NUR im JSON-Datenblock — dort wird "<" zu <, damit ein
 * "</script>" in einem Aufgabennamen den Block nicht beenden kann. Das
 * Client-Skript baut alles mit createElement/textContent auf; es gibt
 * keinen Pfad, auf dem Daten als HTML interpretiert werden.
 */
export function renderSeite(stand: BoardStand): string {
  const daten = JSON.stringify(stand).replace(/</g, "\\u003c");
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
    margin-bottom: 8px;
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
  // exakt, auch wenn die Antwort aus dem 30-s-Cache kam.
  var empfangenUm = Date.now();
  // Lane-IDs mit aufgeklapptem "+n weitere" — außerhalb von zeichne(), damit
  // der alle 30s komplette Neuaufbau sie nicht vergisst.
  var aufgeklappteLanes = new Set();
  // Projekt-Filter-Auswahl (Task 9) — ebenfalls außerhalb von zeichne(),
  // überlebt den 30-s-Refresh wie Scroll/Aufklappen. Wird NICHT gespeichert
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
  // außerhalb von zeichne(), damit der 30-s-Neuaufbau sie nicht zuklappt.
  var ausgeblendetOffen = false;
  // Von der letzten zeichne()-Runde übrig: die sichtbaren Lanes VOR dem
  // Projekt-Filter (Basis für die Drag-Neuordnung) und die ausgeblendeten
  // Lanes (Basis für die Ausgeblendet-Liste im Chip).
  var letzteSichtbareLanes = [];
  var letzteAusgeblendeteLanes = [];

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
      // same-origin — der Browser schickt die bereits vorhandenen
      // Basic-Auth-Credentials automatisch mit; der awork-Token bleibt
      // serverseitig (Proxy-Route, siehe teamboard/server.ts).
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
          // Login; sofort stoppen, sonst zählt jeder 30-s-Poll in die
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
          // abgelaufen — sofort stoppen, sonst zählt jeder 30-s-Poll in die
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

  // Projekt-Filter-Auswahl: Änderung landet in der Client-Variable, kein
  // Speichern (Spec §6). Der Listener wird nur einmal gesetzt — die
  // <option>-Kinder werden bei jedem aktualisiereKopf() neu aufgebaut, das
  // <select>-Element selbst bleibt dabei erhalten.
  document.getElementById("projekt-filter").addEventListener("change", function (ev) {
    ausgewaehltesProjekt = ev.target.value || null;
    zeichne();
  });

  zeichne();
  ticke();
  ladeZeiten();
  ladeEinstellungen();
  setInterval(ticke, 1000);
  setInterval(nachladen, 30000);
})();
</script>
</body>
</html>
`;
}
