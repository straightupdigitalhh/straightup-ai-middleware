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
 * Die drei Felder des Instrumentenbretts in der Kopfbox (Facelift,
 * 28.08.2026): HEUTE / GESTERN / WOCHE mit H:MM-Werten. Ersetzt die
 * frühere Fließtext-Zeile zeitZeile ("Heute 1:02 · Vortag 7:45 · …") —
 * die drei Werte stehen jetzt beschriftet nebeneinander statt in einem
 * Satz. Ruft formatiereZeit als Geschwister-Funktion auf derselben
 * Einbettungsebene auf — keine Closure, beide Funktionen landen über
 * String(fn) im selben Client-Skript-Scope.
 */
export function zeitFelder(
  z: { heuteSekunden: number; vortagSekunden: number; wocheSekunden: number }
): { label: string; wert: string }[] {
  return [
    { label: "HEUTE", wert: formatiereZeit(z.heuteSekunden) },
    { label: "GESTERN", wert: formatiereZeit(z.vortagSekunden) },
    { label: "WOCHE", wert: formatiereZeit(z.wocheSekunden) },
  ];
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
 * derselben Einbettungsebene auf (kein Closure, wie zeitFelder).
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

// ─── Marke: Wortmarke und Favicon ────────────────────────────────────────
//
// Beide Dateien stammen 1:1 von straightup-digital.de (übernommen am
// 28.08.2026) und liegen bewusst als Konstanten hier statt als statische
// Datei: die Seite wird als ein einziges Dokument ausgeliefert, ein
// zweiter Request wäre ein zweiter Weg, auf dem sie kaputtgehen könnte.

/**
 * Wortmarke „straightup digital" als Inline-SVG, gegenüber der Vorlage nur
 * auf `fill: currentColor` umgestellt: sie färbt sich damit über die
 * Textfarbe und stimmt in beiden Farbschemata ohne eigene Regel.
 *
 * Der <style>-Block stammt aus der Vorlage und bleibt IM SVG. Er landet
 * damit im Body, nicht im Stylesheet-Block der Seite — sein </style>
 * beendet also nichts, was die Seite selbst geöffnet hat. Inhaltlich
 * definiert er nur .cls-1 (die Pfade der Wortmarke); Skript-Anteile,
 * Event-Attribute oder ein </script> enthält das SVG nicht (per Test
 * gepinnt: </script>-Zähler 2, </style>-Zähler 2, keine on…=-Attribute).
 */
const LOGO_SVG = `<svg class="logo" role="img" aria-label="straightup digital" id="Ebene_2" data-name="Ebene 2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 802.7 173.05">
  <defs>
    <style>
      .cls-1 {
        fill: currentColor;
        stroke-width: 0px;
      }
    </style>
  </defs>
  <g id="Ebene_1-2" data-name="Ebene 1">
    <g>
      <path class="cls-1" d="m761.37,0c-22.77.06-41.18,18.57-41.12,41.34.06,22.77,18.57,41.18,41.34,41.12,22.77-.06,41.18-18.57,41.12-41.34C802.64,18.35,784.14-.06,761.37,0Zm.41,53.11l-19.25,9.67,19.18-48.21,19.36,48.14-19.29-9.6Z"/>
      <g>
        <path class="cls-1" d="m0,81.8c0-10.39,9.64-20.03,26.7-20.03,13.36,0,23.74,4.45,23.74,4.45l-1.49,20.77h-5.19s-5.2-5.94-6.68-16.32c0,0-4.46-1.48-10.39-1.48-8.9,0-13.35,4.45-13.35,10.39,0,14.1,40.8,11.87,40.8,35.61,0,11.87-10.39,22.26-28.93,22.26-14.1,0-25.22-5.94-25.22-5.94l1.48-20.77h5.2s5.19,5.94,6.68,16.32c0,0,5.2,2.97,11.87,2.97,9.64,0,14.84-5.19,14.84-12.61,0-13.35-40.06-14.1-40.06-35.61Z"/>
        <path class="cls-1" d="m63.81,71.41l-.75-4.45s5.2-4.46,13.36-5.94v-16.32h13.35v18.55h19.29v8.16h-19.29v49.71c0,4.45,2.97,7.42,7.42,7.42,6.68,0,14.1-5.19,14.1-5.19l2.97,5.19s-8.9,8.91-21.51,8.91c-9.65,0-16.32-6.68-16.32-16.32v-49.71h-12.61Z"/>
        <path class="cls-1" d="m154.33,74.38l-6.68,8.16v44.51c6.68,1.48,11.13,4.45,11.13,4.45l-.75,4.45h-34.12l-.75-4.45s4.46-2.97,11.13-4.45v-53.42h-12.61l-.75-5.2s5.94-5.94,15.58-5.94c5.94,0,9.65,2.23,9.65,2.23v10.39h.74s6.68-13.36,19.29-13.36c5.2,0,8.91,2.23,8.91,2.23v10.39h-20.78Z"/>
        <path class="cls-1" d="m200.33,71.41l-1.49,16.32h-10.39s-2.23-2.97-2.23-7.42c0-8.16,10.39-18.55,27.45-18.55,19.29,0,28.19,8.9,28.19,25.22v38.58h12.61l.75,5.19s-5.94,5.94-15.58,5.94c-5.94,0-9.65-2.23-9.65-2.23v-9.64h-.74s-9.65,12.61-24.48,12.61c-13.35,0-21.51-8.16-21.51-20.03,0-11.13,10.39-21.51,32.64-21.51,5.94,0,12.61.74,12.61.74v-9.65c0-11.87-5.94-17.8-15.58-17.8-7.42,0-12.61,2.23-12.61,2.23Zm28.19,45.99v-14.1h-11.13c-14.09,0-20.03,5.94-20.03,13.36s4.45,11.87,11.87,11.87c11.13,0,19.29-11.13,19.29-11.13Z"/>
        <path class="cls-1" d="m289.37,127.05c6.68,1.48,11.13,4.45,11.13,4.45l-.75,4.45h-34.12l-.75-4.45s4.46-2.97,11.13-4.45v-53.42h-12.61l-.75-5.2s5.94-5.94,17.07-5.94c5.93,0,9.64,2.23,9.64,2.23v62.32Zm-6.68-94.96c5.2,0,8.9,3.71,8.9,8.9s-3.71,8.9-8.9,8.9-8.9-3.71-8.9-8.9,3.71-8.9,8.9-8.9Z"/>
        <path class="cls-1" d="m344.28,61.77c5.2,0,11.13,1.49,11.13,1.49,0,0,1.48-11.13,15.58-11.13,5.94,0,8.9,2.23,8.9,2.23v10.39h-20.77v.75s15.58,4.45,15.58,23c0,13.35-11.87,25.22-30.42,25.22-9.65,0-15.58-3.71-15.58-3.71v14.1h23.74c21.52,0,30.42,8.91,30.42,23,0,13.36-12.61,25.97-36.35,25.97-25.22,0-36.35-11.13-36.35-23,0-12.61,13.35-17.06,13.35-17.06,0,0-5.94-4.46-5.94-12.62s6.68-12.61,6.68-12.61c0,0-10.39-6.68-10.39-20.03,0-14.1,11.87-25.97,30.42-25.97Zm-6.68,75.67c-5.2,0-8.9-1.49-8.9-1.49,0,0-5.94,4.45-5.94,12.61s8.16,16.32,24.48,16.32,24.48-7.42,24.48-16.32c0-6.68-4.45-11.13-19.29-11.13h-14.84Zm6.68-68.25c-9.65,0-16.32,6.68-16.32,18.55s6.68,18.55,16.32,18.55,16.32-6.68,16.32-18.55-6.68-18.55-16.32-18.55Z"/>
        <path class="cls-1" d="m416.25,81.8v45.25c5.94,1.48,8.91,4.45,8.91,4.45l-.75,4.45h-31.9l-.75-4.45s4.46-2.97,11.13-4.45V34.32h-12.61l-.75-5.2s5.94-5.94,17.07-5.94c5.93,0,9.64,2.23,9.64,2.23v39.32l-1.48,9.65h.74s9.65-12.61,24.48-12.61c13.35,0,22.26,8.9,22.26,23.74v41.54c6.68,1.48,11.13,4.45,11.13,4.45l-.74,4.45h-31.9l-.74-4.45s2.97-2.97,8.9-4.45v-41.54c0-9.65-5.19-14.84-13.35-14.84-11.13,0-19.29,11.13-19.29,11.13Z"/>
        <path class="cls-1" d="m476.36,71.41l-.74-4.45s5.19-4.46,13.35-5.94v-16.32h13.36v18.55h19.29v8.16h-19.29v49.71c0,4.45,2.97,7.42,7.42,7.42,6.68,0,14.1-5.19,14.1-5.19l2.97,5.19s-8.9,8.91-21.51,8.91c-9.65,0-16.32-6.68-16.32-16.32v-49.71h-12.61Z"/>
        <path class="cls-1" d="m618.81,125.57l.75,5.19s-5.94,5.94-15.58,5.94c-5.94,0-9.65-2.23-9.65-2.23v-9.64h-.74s-9.65,12.61-24.48,12.61c-13.35,0-22.26-8.91-22.26-23.74v-40.06h-12.61l-.74-5.2s5.94-5.94,17.06-5.94c5.94,0,9.65,2.23,9.65,2.23v48.97c0,9.65,5.19,14.84,13.35,14.84,11.13,0,19.29-11.13,19.29-11.13v-43.77h-12.62l-.74-5.2s5.94-5.94,17.06-5.94c5.94,0,9.65,2.23,9.65,2.23v60.84h12.61Z"/>
        <path class="cls-1" d="m648.49,74.38s9.65-12.61,24.48-12.61c17.8,0,31.16,13.36,31.16,37.09s-15.58,38.58-34.13,38.58c-14.84,0-21.51-8.91-21.51-8.91h-.74l1.48,9.65v23.74c7.42,2.23,11.87,5.19,11.87,5.19l-.74,4.45h-34.87l-.75-4.45s4.46-2.97,11.13-5.19v-88.28h-12.61l-.75-5.2s5.94-5.94,15.58-5.94c5.94,0,9.65,2.23,9.65,2.23v9.65h.74Zm.74,34.87c0,12.61,7.42,20.03,19.29,20.03,11.13,0,20.77-9.65,20.77-29.68s-9.65-28.93-20.77-28.93-19.29,11.13-19.29,11.13v27.45Z"/>
      </g>
    </g>
  </g>
</svg>`;

/**
 * Favicon (PNG, 203×203) derselben Herkunft, als data:-URL im Head. Die
 * CSP erlaubt data: für Bilder bereits (index.ts, imgSrc) — an ihr ändert
 * sich dafür nichts.
 */
const FAVICON_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAMsAAADLCAYAAADA+2czAAAACXBIWXMAAAsTAAALEwEAmpwYAAAF6mlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPD94cGFja2V0IGJlZ2luPSLvu78iIGlkPSJXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQiPz4gPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iQWRvYmUgWE1QIENvcmUgNi4wLWMwMDIgNzkuMTY0NDg4LCAyMDIwLzA3LzEwLTIyOjA2OjUzICAgICAgICAiPiA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPiA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtbG5zOnhtcE1NPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvbW0vIiB4bWxuczpzdFJlZj0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL3NUeXBlL1Jlc291cmNlUmVmIyIgeG1sbnM6c3RFdnQ9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZUV2ZW50IyIgeG1sbnM6ZGM9Imh0dHA6Ly9wdXJsLm9yZy9kYy9lbGVtZW50cy8xLjEvIiB4bWxuczpwaG90b3Nob3A9Imh0dHA6Ly9ucy5hZG9iZS5jb20vcGhvdG9zaG9wLzEuMC8iIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIDIyLjAgKFdpbmRvd3MpIiB4bXA6Q3JlYXRlRGF0ZT0iMjAyMC0xMi0wOVQwOTo0MzozMSswMTowMCIgeG1wOk1vZGlmeURhdGU9IjIwMjAtMTItMTFUMDk6NDk6MDErMDE6MDAiIHhtcDpNZXRhZGF0YURhdGU9IjIwMjAtMTItMTFUMDk6NDk6MDErMDE6MDAiIHhtcE1NOkluc3RhbmNlSUQ9InhtcC5paWQ6YzNmZjM0Y2EtNWY4ZC00NDJjLWI4YTMtMzU3NjAzZTJiY2VmIiB4bXBNTTpEb2N1bWVudElEPSJ4bXAuZGlkOjlEN0UxMzJFMzlGQTExRUI4RkRDOTQxMTdCMzdCNDk3IiB4bXBNTTpPcmlnaW5hbERvY3VtZW50SUQ9InhtcC5kaWQ6OUQ3RTEzMkUzOUZBMTFFQjhGREM5NDExN0IzN0I0OTciIGRjOmZvcm1hdD0iaW1hZ2UvcG5nIiBwaG90b3Nob3A6Q29sb3JNb2RlPSIzIiBwaG90b3Nob3A6SUNDUHJvZmlsZT0ic1JHQiBJRUM2MTk2Ni0yLjEiPiA8eG1wTU06RGVyaXZlZEZyb20gc3RSZWY6aW5zdGFuY2VJRD0ieG1wLmlpZDo5RDdFMTMyQjM5RkExMUVCOEZEQzk0MTE3QjM3QjQ5NyIgc3RSZWY6ZG9jdW1lbnRJRD0ieG1wLmRpZDo5RDdFMTMyQzM5RkExMUVCOEZEQzk0MTE3QjM3QjQ5NyIvPiA8eG1wTU06SGlzdG9yeT4gPHJkZjpTZXE+IDxyZGY6bGkgc3RFdnQ6YWN0aW9uPSJzYXZlZCIgc3RFdnQ6aW5zdGFuY2VJRD0ieG1wLmlpZDpjM2ZmMzRjYS01ZjhkLTQ0MmMtYjhhMy0zNTc2MDNlMmJjZWYiIHN0RXZ0OndoZW49IjIwMjAtMTItMTFUMDk6NDk6MDErMDE6MDAiIHN0RXZ0OnNvZnR3YXJlQWdlbnQ9IkFkb2JlIFBob3Rvc2hvcCAyMi4wIChNYWNpbnRvc2gpIiBzdEV2dDpjaGFuZ2VkPSIvIi8+IDwvcmRmOlNlcT4gPC94bXBNTTpIaXN0b3J5PiA8L3JkZjpEZXNjcmlwdGlvbj4gPC9yZGY6UkRGPiA8L3g6eG1wbWV0YT4gPD94cGFja2V0IGVuZD0iciI/PqOEYhQAAA8xSURBVHic7d0tf+RKdsfx3/UGZJA9r8A9LGwUtmy07LLpRUnQ1bCwOK9gO68gCkrY1kVZFpmF3TZbdttsWWQW2M1uWEBZ1z2aVuuhqnSqpPP9fPyZfpTO2P676uih9d379+9RQdwBGbB5/WruN899nLjcF6B+vX0Ajq/3z79UAN9pWJzdYUPQfG2AT1LFvHrGhuYA7HkLlXKgYRlvA+SvXxnTR4i5vfAWnv3rbTWChqXfHbDlLSD3cqV4dcKGpnr9t5YrJQ0alss22IAUpDNyuHrGhsago85F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";

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
<link rel="icon" href="data:image/png;base64,${FAVICON_BASE64}">
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
  * { box-sizing: border-box; min-width: 0; }
  body {
    margin: 0; background: var(--grund); color: var(--tinte);
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }
  /* ─── Kopfbereich: Wortmarke, Bereichsname, Bedienelemente ─── */
  .top {
    display: flex; align-items: center; gap: 14px;
    padding: 18px 24px 6px;
  }
  .logo { height: 34px; width: auto; color: var(--tinte); flex: none; }
  .top .bereich {
    margin: 0; color: var(--gedeckt); font-size: 13px; font-weight: 400;
    border-left: 1px solid var(--linie); padding-left: 14px;
  }
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
    display: none; margin: 0 24px; padding: 8px 12px; border-radius: 8px;
    background: var(--warn); color: #fff; font-size: 13px;
  }
  #zeiten-hinweis {
    display: none; margin: 0 24px; padding: 4px 0; color: var(--gedeckt); font-size: 12px;
  }
  #ausgeblendet-liste {
    display: none; margin: 0 24px 8px; padding: 8px 12px; border-radius: 8px;
    background: var(--karte); border: 1px solid var(--linie); font-size: 13px;
  }
  .ausgeblendet-zeile { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 2px 0; }
  .einblenden-btn {
    border: 0; background: none; color: var(--aktiv); font: inherit; font-size: 12px;
    cursor: pointer; padding: 0; text-decoration: underline;
  }
  .chip {
    font-size: 11px; padding: 1px 7px; border-radius: 99px; background: var(--chip);
    color: var(--gedeckt); white-space: nowrap;
  }
  #lanes {
    display: flex; gap: 22px; align-items: flex-start;
    padding: 14px 24px 40px; overflow-x: auto;
  }
  /* Die Lane hat keine eigene Umrandungs-Box mehr: Kopfbox, Timer und
     Karten stehen als eigenständige Flächen auf --grund, der gap hält sie
     auseinander. min-width: 0 bleibt trotz der globalen Regel stehen — es
     ist der gepinnte Schutz gegen die flex-min-width:auto-Falle, die sonst
     genau die Lane mit einem langen Wort breiter zöge als alle anderen. */
  .lane { flex: 0 0 300px; min-width: 0; display: flex; flex-direction: column; gap: 14px; }
  @media (max-width: 480px) { .lane { flex-basis: 86vw; } }

  /* ─── Kopfbox der Lane: Avatar, Name, Ausblenden, Instrumentenbrett ─── */
  .kopfbox {
    display: grid; grid-template-columns: auto 1fr auto; align-items: center;
    column-gap: 12px; row-gap: 12px; padding: 14px 16px;
    background: var(--chip); border-radius: 12px;
  }
  .avatar {
    width: 40px; height: 40px; border-radius: 50%; flex: none;
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; font-weight: 700; letter-spacing: 0.02em; object-fit: cover;
    color: var(--tinte); background: var(--karte); border: 1px solid var(--linie);
  }
  .kopfbox .name { margin: 0; font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
  .ausblenden-btn {
    border: 0; background: none; color: var(--gedeckt); font: inherit;
    font-size: 16px; line-height: 1; cursor: pointer; padding: 0 2px; align-self: start;
  }
  .zeitenreihe {
    grid-column: 1 / -1; display: grid; grid-template-columns: repeat(3, 1fr);
    border-top: 1px solid var(--linie); padding-top: 10px;
  }
  .zeit-feld { padding: 0 12px; }
  .zeit-feld:first-child { padding-left: 0; }
  .zeit-feld + .zeit-feld { border-left: 1px solid var(--linie); }
  .zeit-label { font-size: 10px; font-weight: 600; letter-spacing: 0.05em; color: var(--gedeckt); }
  .zeit-wert { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; margin-top: 2px; }

  /* ─── Timer-Karte: den Laufend-Zustand trägt jetzt sie, nicht die Lane ─── */
  .timer {
    background: var(--aktiv-grund); border-radius: 16px; padding: 18px 18px 16px;
    display: flex; flex-direction: column; gap: 4px;
    box-shadow: 0 1px 3px color-mix(in srgb, var(--tinte) 6%, transparent);
  }
  .timer.pausiert { background: var(--pause-grund); }
  .timer-zeile { display: flex; align-items: center; gap: 12px; }
  .puls {
    width: 10px; height: 10px; border-radius: 50%; flex: none; background: var(--aktiv);
    animation: puls 1.6s ease-out infinite;
  }
  @keyframes puls {
    0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--aktiv) 45%, transparent); }
    70% { box-shadow: 0 0 0 9px transparent; }
    100% { box-shadow: 0 0 0 0 transparent; }
  }
  @media (prefers-reduced-motion: reduce) { .puls { animation: none; } }
  .timer-zeit {
    font-size: 30px; font-weight: 650; line-height: 1.1;
    font-variant-numeric: tabular-nums; letter-spacing: 0.01em;
  }
  .pausiert-chip {
    font-size: 11px; padding: 2px 9px; border-radius: 99px;
    background: var(--chip); color: var(--gedeckt);
  }
  .timer-aufgabe { font-size: 14px; font-weight: 600; line-height: 1.4; margin-top: 6px; overflow-wrap: break-word; }
  .timer-meta { font-size: 12px; color: var(--gedeckt); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }

  /* ─── Aufgabenkarten: Luft und Fläche, Badge über dem Titel ─── */
  .karten { display: flex; flex-direction: column; gap: 14px; }
  .karte {
    background: var(--karte); border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--linie) 60%, transparent);
    box-shadow: 0 1px 2px color-mix(in srgb, var(--tinte) 5%, transparent),
                0 4px 10px color-mix(in srgb, var(--tinte) 5%, transparent),
                0 14px 30px color-mix(in srgb, var(--tinte) 4%, transparent);
    padding: 14px 16px; cursor: pointer;
  }
  .badge {
    display: inline-flex; align-items: center; padding: 3px 9px; border-radius: 999px;
    font-size: 11px; font-weight: 600; letter-spacing: 0.02em;
    background: var(--chip); color: var(--gedeckt);
  }
  .badge-progress { background: var(--aktiv-grund); color: var(--aktiv); }
  .aufgabe-titel { margin: 8px 0 0; font-size: 14px; font-weight: 600; line-height: 1.4; overflow-wrap: break-word; }
  .aufgabe-meta {
    margin-top: 9px; display: flex; flex-wrap: wrap; align-items: center;
    gap: 6px 10px; font-size: 12px; color: var(--gedeckt); overflow-wrap: anywhere;
  }
  .chip-datum {
    display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px;
    background: var(--chip); color: var(--gedeckt);
    font-variant-numeric: tabular-nums; white-space: nowrap;
  }
  .chip-warn { background: color-mix(in srgb, var(--warn) 12%, transparent); color: var(--warn); font-weight: 600; }
  .prio { color: var(--warn); font-weight: 600; white-space: nowrap; }
  .mehr {
    width: 100%; border: 0; background: transparent; color: var(--gedeckt);
    font: inherit; font-size: 13px; font-weight: 600; padding: 9px 10px;
    border-radius: 10px; cursor: pointer; text-align: center;
  }
  .mehr:hover { background: color-mix(in srgb, var(--tinte) 5%, transparent); color: var(--tinte); }
  .leer { color: var(--gedeckt); font-size: 13px; padding: 4px 2px; }
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
<header class="top">
${LOGO_SVG}
  <h1 class="bereich">Teamboard</h1>
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

  // P1 fortgeführt (Task 9): formatiereZeit/zeitFelder/projekteAusBoard/
  // wendeProjektFilterAn sind oben ebenfalls als exportierte, testbare
  // TS-Funktionen definiert und werden hier eingebettet.
  ${String(formatiereZeit)}

  ${String(zeitFelder)}

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
      var box = el("section", "lane");
      // Kopfbox (Facelift): Avatar, Name, Ausblenden-× und darunter das
      // Instrumentenbrett — sie ist auch der neue Griff fürs Drag-and-drop.
      var kopf = el("header", "kopfbox");
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
      kopf.appendChild(el("h2", "name", lane.name));
      var ausblenden = el("button", "ausblenden-btn", "×");
      ausblenden.type = "button";
      ausblenden.title = "Ausblenden";
      ausblenden.addEventListener("click", function () {
        blendeAus(lane.userId);
      });
      kopf.appendChild(ausblenden);
      // Instrumentenbrett: HEUTE/GESTERN/WOCHE als drei beschriftete Felder
      // in derselben Kopfbox — aber nur, wenn für diese userId überhaupt
      // Zeiten geliefert wurden (eigene Lane bzw. Admin). Sonst endet die
      // Kopfbox nach der Namenszeile; keine leeren Felder, keine Nullen für
      // fremde Lanes.
      if (zeitenProNutzer[lane.userId]) {
        var reihe = el("div", "zeitenreihe");
        zeitFelder(zeitenProNutzer[lane.userId]).forEach(function (f) {
          var feld = el("div", "zeit-feld");
          feld.appendChild(el("div", "zeit-label", f.label));
          feld.appendChild(el("div", "zeit-wert", f.wert));
          reihe.appendChild(feld);
        });
        kopf.appendChild(reihe);
      }
      box.appendChild(kopf);
      if (lane.timer) {
        // Timer-Karte (Facelift): eigene Fläche statt Rand an der Lane —
        // der Laufend-Zustand hängt jetzt an ihr, nicht mehr am Grünrand
        // der Spalte (der ist ersatzlos entfallen).
        var t = el("div", "timer" + (lane.timer.pausiert ? " pausiert" : ""));
        var timerZeile = el("div", "timer-zeile");
        if (!lane.timer.pausiert) {
          var puls = el("span", "puls");
          // Rein dekorativ — der Zustand steht als Text daneben.
          puls.setAttribute("aria-hidden", "true");
          timerZeile.appendChild(puls);
        }
        // Träger der Uhr-Attribute bleibt genau ein Element; ticke() findet
        // es unverändert über [data-uhr].
        var zahl = el("span", "timer-zeit", "");
        zahl.setAttribute("data-uhr", String(lane.timer.sekunden));
        zahl.setAttribute("data-pausiert", lane.timer.pausiert ? "1" : "0");
        timerZeile.appendChild(zahl);
        if (lane.timer.pausiert) timerZeile.appendChild(el("span", "chip pausiert-chip", "pausiert"));
        t.appendChild(timerZeile);
        t.appendChild(el("div", "timer-aufgabe", lane.timer.aufgabenName || "(ohne Aufgabe)"));
        var wo = [lane.timer.aufgabenKennung, lane.timer.projektName].filter(Boolean).join(" · ");
        if (wo) t.appendChild(el("div", "timer-meta", wo));
        box.appendChild(t);
      }
      if (lane.aufgaben.length === 0 && !lane.timer) {
        box.appendChild(el("div", "leer", "nichts Offenes"));
      }
      var aufgeklappt = aufgeklappteLanes.has(lane.userId);
      var liste = el("div", "karten");
      box.appendChild(liste);
      lane.aufgaben.forEach(function (a, i) {
        var k = el("article", "karte");
        if (i >= MAX_KARTEN && !aufgeklappt) k.hidden = true;
        // Badge ÜBER dem Titel, nie daneben: der Titel bekommt die volle
        // Breite der Karte (Facelift).
        k.appendChild(el("span", "badge" + (a.statusTyp === "progress" ? " badge-progress" : ""), a.statusName));
        k.appendChild(el("h3", "aufgabe-titel", a.name));
        var meta = el("div", "aufgabe-meta");
        var unten = [a.kennung, a.projektName].filter(Boolean).join(" · ");
        if (unten) meta.appendChild(el("span", null, unten));
        // Fälligkeit als Datums-Chip. Überfällig steht zusätzlich als Wort
        // da: vorher trug das allein die rote Schrift, und Farbe allein ist
        // auf dem Wandmonitor wie für Farbfehlsichtige keine Aussage.
        if (a.faelligAm) {
          meta.appendChild(el(
            "span",
            "chip-datum" + (a.ueberfaellig ? " chip-warn" : ""),
            datumKurz(a.faelligAm) + (a.ueberfaellig ? " · überfällig" : "")
          ));
        }
        if (a.istPrio) meta.appendChild(el("span", "prio", "Prio"));
        if (meta.childNodes.length > 0) k.appendChild(meta);
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
    // Die Zeit-Spans oben sind absichtlich leer aufgebaut; ihren Text setzt
    // ausschließlich ticke() über [data-uhr]. Ohne diesen Aufruf bliebe das
    // größte Element der Lane nach JEDEM Neuaufbau bis zum nächsten
    // Sekundentick leer — beim 10-s-Poll, nach /zeiten und /einstellungen,
    // beim Aus-/Einblenden und nach jedem Drop. ticke() ist idempotent und
    // liest nur den aktuellen Stand, deshalb steht der Aufruf hier statt an
    // acht Aufruforten (wo er zwangsläufig irgendwann einer vergisst).
    ticke();
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
        stand = neu; empfangenUm = Date.now(); zeichne(); ladeZeiten();
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
