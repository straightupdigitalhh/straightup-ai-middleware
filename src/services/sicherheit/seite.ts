import { DARSTELLUNG_FUNKTIONEN } from './darstellung.js';

// ─── Die Seite /sicherheit (Teil 1) ──────────────────────────────
//
// Das Dashboard der Sicherheitsplattform nach der Anprobe vom 23.10.2026
// (vorhaben/security-plattform/anprobe/index.html in ~/web-projekte): Kopfzeile,
// die Reiter Lage, Flotte, Abdeckung, Aufräumen und Wächter, die Akte einer Site
// als Seitenleiste. Statt der Artifact-Laufzeit der Anprobe (dash.*, --cds-*)
// rendert das Skript der Seite selbst aus GET /api/sicherheit/stand, mit eigenen
// Farben für hell und dunkel.
//
// Das Dokument enthält keine Daten: Kundennamen, Sites und Befunde kommen nur
// über die API (Cache-Control: no-store) und werden mit textContent eingesetzt,
// nie als HTML. Aufträge schickt das Skript per fetch, so trägt jede Anfrage die
// echte Origin, die POST /api/sicherheit/auftraege verlangt. Unter der CSP der
// App (index.ts): Inline-Skript und -Stil, Aufrufe nur an die eigene Origin,
// keine fremden Fonts, das Favicon als data:-URL.
//
// Zwei Skript-Blöcke: `darstellung` trägt die reinen Funktionen aus
// darstellung.ts (dort getestet und per String(fn) eingebettet), der zweite das
// Rendern und die Aufträge. Der zweite ist reines JavaScript in einem
// Template-String: darin keine Backticks, kein Dollar mit geschweifter Klammer
// und keine Backslashes, sonst änderte TypeScript den Text.

/** Wohin der Link „Code eingeben" führt und das Ziel der Anmeldung (wie createPageAuth(sessions, '/app/') in index.ts). */
const ANMELDEN = '/app/?next=%2Fsicherheit';

const FAVICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
  + '<path d="M16 2 4 6.5v8.4c0 7.2 5 13.2 12 15.1 7-1.9 12-7.9 12-15.1V6.5z" fill="#1f1e1b"/>'
  + '<path d="M16 7 8.5 9.8v5.1c0 4.8 3.2 8.9 7.5 10.4 4.3-1.5 7.5-5.6 7.5-10.4V9.8z" fill="#c8453b"/></svg>';
const FAVICON = `data:image/svg+xml;base64,${Buffer.from(FAVICON_SVG).toString('base64')}`;

const STIL = `
:root {
  color-scheme: light dark;
  --bg: #ffffff; --panel: #f6f5f1; --fg: #1f1e1b; --fg-muted: #66645e; --line: #e2e0d8;
  --bad: #b3261e; --warn: #935600; --ok: #2e7d32;
  --balken-alarm: #c8453b; --balken-befund: #b38a36; --balken-leise: #b4b2aa; --schatten: rgba(0, 0, 0, .14);
  --serif: ui-serif, Georgia, "Times New Roman", serif;
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1b1b19; --panel: #252522; --fg: #ecebe5; --fg-muted: #a6a49c; --line: #3a3934;
    --bad: #f2867c; --warn: #e5b05c; --ok: #7cc47f;
    --balken-alarm: #e0675d; --balken-befund: #c9a25a; --balken-leise: #6f6d66; --schatten: rgba(0, 0, 0, .5);
  }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { margin: 0; }
body { background: var(--bg); color: var(--fg); font: 15px/1.5 var(--sans); }
a { color: inherit; }
:focus-visible { outline: 2px solid var(--fg); outline-offset: 2px; }
.sl { container-type: inline-size; display: grid; gap: 22px; max-width: 1480px; margin: 0 auto; padding: 24px 24px 64px; }
@media (max-width: 640px) { .sl { padding: 16px 16px 48px; } }
.sl h1, .sl h2, .sl h3, .sl p, .sl-akte h2, .sl-akte h3, .sl-akte p { margin: 0; }
.sl-kopf { display: grid; gap: 6px; }
.sl-kopfzeile { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; flex-wrap: wrap; }
.sl-kopf h1 { font-family: var(--serif); font-weight: 400; font-size: 2rem; line-height: 1.15; text-wrap: balance; }
.sl-links a { color: var(--fg-muted); font-size: .85rem; }
.sl-kernsatz { font-size: 1.05rem; max-width: 72ch; }
.sl-stand, .sl-notiz { color: var(--fg-muted); font-size: .85rem; max-width: 92ch; }
.sl-stand .sl-rot { font-weight: 600; }
#ansichten { display: grid; gap: 22px; }
.sl-hinweis { border: 1px solid color-mix(in srgb, var(--bad) 45%, var(--line)); background: color-mix(in srgb, var(--bad) 8%, var(--bg)); border-radius: 10px; padding: 10px 14px; }
.sl-hinweis a { font-weight: 600; }
.sl-tabs { display: flex; flex-wrap: wrap; gap: 6px; border-bottom: 1px solid var(--line); }
.sl-tab { appearance: none; background: none; border: 0; border-bottom: 2px solid transparent; margin-bottom: -1px; padding: 8px 14px; font: inherit; color: var(--fg-muted); cursor: pointer; }
.sl-tab[aria-selected="true"] { color: var(--fg); border-bottom-color: var(--fg); }
.sl-seite { display: grid; gap: 16px; }
.sl-karte { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 20px; min-width: 0; display: grid; gap: 10px; align-content: start; }
.sl-karte h2 { font-size: 1.15rem; font-weight: 600; text-wrap: balance; }
.sl-akte h3 { font-size: 1rem; font-weight: 600; margin-top: 8px; }
.sl-kacheln { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 10rem), 1fr)); }
.sl-kachel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px 20px; display: grid; gap: 6px; align-content: start; min-width: 0; }
.sl-zahl { font-family: var(--serif); font-size: 2rem; line-height: 1.1; font-variant-numeric: tabular-nums; }
.sl-label { color: var(--fg-muted); font-size: .85rem; overflow-wrap: anywhere; }
.sl-schlecht .sl-zahl { color: var(--bad); }
.sl-warnung .sl-zahl { color: var(--warn); }
.sl-kachel-grau .sl-zahl { color: var(--fg-muted); font-family: var(--sans); font-size: 1.05rem; line-height: 2.2rem; }
.sl-zwei { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 30rem), 1fr)); }
.sl-balken { display: grid; gap: 10px; }
.sl-bz { display: grid; grid-template-columns: minmax(0, 24rem) minmax(0, 1fr) 7.5rem; gap: 10px; align-items: center; }
@container (max-width: 640px) {
  .sl-bz { grid-template-columns: minmax(0, 1fr) 7.5rem; }
  .sl-bz .sl-bl { grid-column: 1 / -1; }
}
.sl-bl { min-width: 0; font-size: .85rem; display: grid; }
.sl-haupt { font-weight: 600; overflow-wrap: anywhere; }
.sl-neben { color: var(--fg-muted); overflow-wrap: anywhere; }
.sl-spur { height: .7rem; border-radius: 999px; background: color-mix(in srgb, var(--fg) 7%, transparent); overflow: hidden; }
.sl-fuell { height: 100%; min-width: 3px; border-radius: 999px; }
.sl-f-alarm { background: var(--balken-alarm); }
.sl-f-befund { background: var(--balken-befund); }
.sl-f-stumm { background: var(--balken-leise); }
.sl-bw { text-align: right; font-size: .85rem; font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--fg-muted); }
.sl-filter { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.sl-eingabe { font: inherit; font-size: .85rem; padding: 3px 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--fg); min-width: 0; }
input.sl-eingabe[type="search"], input.sl-eingabe[type="text"] { width: min(100%, 18rem); }
.sl-chips { display: inline-flex; flex-wrap: wrap; gap: 6px; }
.sl-chip { font: inherit; font-size: .85rem; border: 1px solid var(--line); border-radius: 999px; padding: 1px 10px; background: var(--bg); color: var(--fg); cursor: pointer; display: inline-flex; gap: 6px; align-items: center; font-variant-numeric: tabular-nums; }
.sl-chip[aria-pressed="true"] { border-color: var(--fg); background: color-mix(in srgb, var(--fg) 8%, var(--bg)); }
.sl-punkt { width: .5rem; height: .5rem; border-radius: 50%; background: currentColor; display: inline-block; }
.sl-rahmen { overflow: auto; max-height: 38rem; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); }
.sl-tabelle { border-collapse: collapse; width: 100%; font-size: .85rem; font-variant-numeric: tabular-nums; }
.sl-tabelle th { position: sticky; top: 0; z-index: 1; background: var(--panel); text-align: left; font-weight: 600; border-bottom: 1px solid var(--line); white-space: nowrap; padding: 0; }
.sl-tabelle th button, .sl-tabelle th .sl-th { all: unset; display: block; box-sizing: border-box; width: 100%; padding: 5px 8px; cursor: pointer; }
.sl-tabelle th .sl-th { cursor: default; }
.sl-tabelle th button:focus-visible { outline: 2px solid var(--fg); outline-offset: -2px; }
.sl-tabelle th[aria-sort="ascending"] button::after { content: " ↑"; }
.sl-tabelle th[aria-sort="descending"] button::after { content: " ↓"; }
.sl-tabelle td { padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
.sl-tabelle .sl-num { text-align: right; }
.sl-tabelle .sl-nw, .sl-zeilen > span, .sl-tabelle td > .sl-grau { white-space: nowrap; }
.sl-zeilen > span { display: block; }
.sl-klickbar tbody tr { cursor: pointer; }
.sl-klickbar tbody tr:hover { background: color-mix(in srgb, var(--fg) 5%, transparent); }
.sl-tabelle tbody tr[aria-selected="true"] { background: color-mix(in srgb, var(--fg) 10%, transparent); }
.sl-tabelle tbody tr:focus-visible { outline-offset: -2px; }
.sl-zeile-stumm td { background: color-mix(in srgb, var(--warn) 8%, transparent); }
.sl-mitglieder td { background: color-mix(in srgb, var(--fg) 3%, transparent); }
.sl-mitglieder ul { margin: 4px 0 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 4px 14px; }
@container (max-width: 860px) { .sl-nb { display: none; } }
.sl-leer { color: var(--fg-muted); font-size: .85rem; padding: 12px; margin: 0; }
.sl-pill { display: inline-flex; align-items: center; padding: 0 .5rem; border-radius: 999px; line-height: 1.6; white-space: nowrap; background: color-mix(in srgb, currentColor 13%, transparent); }
.sl-rot { color: var(--bad); }
.sl-gelb { color: var(--warn); }
.sl-gruen { color: var(--ok); }
.sl-grau { color: var(--fg-muted); }
.sl-text { color: var(--fg-muted); display: block; max-width: 64ch; }
.sl-knopf { font: inherit; font-size: .8rem; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--fg); padding: 2px 8px; cursor: pointer; white-space: nowrap; }
.sl-knopf:hover:not(:disabled) { border-color: var(--fg-muted); }
.sl-knopf:disabled { opacity: .5; cursor: default; }
.sl-link { all: unset; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.sl-link:focus-visible { outline: 2px solid var(--fg); outline-offset: 2px; }
.sl-aktionen { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.sl-rueck { font-size: .8rem; margin: 4px 0 0; max-width: 52ch; }
.sl-rueck-laeuft { color: var(--fg-muted); font-style: italic; }
.sl-rueckliste { margin: 0; padding-left: 1.1rem; display: grid; gap: 4px; font-size: .85rem; }
.sl-regeln { margin: 0; padding-left: 1.1rem; display: grid; gap: 6px; }
.sl-akte { position: fixed; top: 0; right: 0; bottom: 0; width: min(42rem, 100vw); background: var(--bg); border-left: 1px solid var(--line); box-shadow: -16px 0 40px var(--schatten); overflow-y: auto; padding: 20px 22px 48px; z-index: 20; display: grid; gap: 12px; align-content: start; }
@media (max-width: 640px) { .sl-akte { padding: 16px 16px 40px; } }
.sl-akte-kopf { display: flex; justify-content: space-between; gap: 16px; align-items: start; }
.sl-akte-kopf h2 { font-family: var(--serif); font-weight: 400; font-size: 1.5rem; overflow-wrap: anywhere; }
.sl-akte-kopf h2:focus { outline: none; }
.sl-akte-inhalt { display: grid; gap: 10px; }
.sl-felder { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 16px; margin: 0; font-size: .85rem; }
.sl-felder dt { color: var(--fg-muted); }
.sl-felder dd { margin: 0; overflow-wrap: anywhere; }
.sl-inst { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; display: grid; gap: 8px; background: var(--panel); }
.sl-inst-kopf { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-weight: 600; overflow-wrap: anywhere; }
.sl-eintrag { border-top: 1px solid var(--line); padding-top: 10px; display: grid; gap: 4px; font-size: .85rem; }
.sl-form { display: grid; gap: 10px; font-size: .85rem; }
.sl-form-zeile { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.sl-form-zeile > .sl-name { color: var(--fg-muted); min-width: 6.5rem; }
`;

/** Die Seite ohne Daten; alles Weitere holt ihr Skript. */
export function renderSicherheitSeite(opts: { zweiterFaktorPfad: string }): string {
  const funktionen = DARSTELLUNG_FUNKTIONEN.map(String).join('\n');
  if (funktionen.includes('</script')) throw new Error('darstellung.ts enthält "</script" und lässt sich nicht einbetten.');
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<link rel="icon" href="${FAVICON}">
<title>Sicherheitslage · straightup</title>
<style>${STIL}</style>
</head>
<body>
<div class="sl">
  <header class="sl-kopf">
    <div class="sl-kopfzeile">
      <h1>Sicherheitslage Flotte</h1>
      <nav class="sl-links" aria-label="Navigation"><a href="/app/">zum Hub</a></nav>
    </div>
    <p class="sl-kernsatz" id="kernsatz">Der Stand wird geladen.</p>
    <p class="sl-stand"><span id="stand-alter"></span> <button type="button" class="sl-knopf" id="neu-laden">neu laden</button></p>
    <p class="sl-stand" id="waechter-zeile"></p>
  </header>

  <div class="sl-hinweis" id="hinweis" role="alert" hidden></div>

  <section class="sl-karte" id="rueckmeldungen" aria-live="polite" hidden>
    <h2>Aufträge aus dieser Sitzung</h2>
    <ul class="sl-rueckliste" id="rueck-liste"></ul>
  </section>

  <div id="ansichten" hidden>
    <nav class="sl-tabs" role="tablist" aria-label="Ansichten">
      <button type="button" class="sl-tab" role="tab" id="tab-lage" data-seite="lage" aria-controls="lage">Lage</button>
      <button type="button" class="sl-tab" role="tab" id="tab-flotte" data-seite="flotte" aria-controls="flotte">Flotte</button>
      <button type="button" class="sl-tab" role="tab" id="tab-abdeckung" data-seite="abdeckung" aria-controls="abdeckung">Abdeckung</button>
      <button type="button" class="sl-tab" role="tab" id="tab-aufraeumen" data-seite="aufraeumen" aria-controls="aufraeumen">Aufräumen</button>
      <button type="button" class="sl-tab" role="tab" id="tab-waechter" data-seite="waechter" aria-controls="waechter">Wächter</button>
    </nav>

    <section class="sl-seite" id="lage" role="tabpanel" aria-labelledby="tab-lage">
      <div class="sl-kacheln" id="lage-kacheln"></div>
      <article class="sl-karte">
        <h2>Was liegt, und seit wann</h2>
        <p class="sl-notiz">Jeder Eintrag der Lage, nach Liegezeit sortiert. Rot sind offene Alarme, gelb offene Befunde, grau stumm geschaltete Einträge. Was im Slack nur einmal auftaucht, steht hier, bis es erledigt ist.</p>
        <div class="sl-balken" id="lage-balken"></div>
      </article>
      <article class="sl-karte">
        <h2>Offene Einträge</h2>
        <p class="sl-notiz">Ein Urteil geht als Auftrag an den Kern; bis seine Quittung da ist, steht dort „wird übernommen“. Sammel- und Quellenalarme lassen sich nur erledigen oder stumm schalten, ihre Sites klappen auf. Eine Zeile anklicken öffnet die Akte der Site.</p>
        <div class="sl-rahmen" id="lage-tabelle"></div>
      </article>
    </section>

    <section class="sl-seite" id="flotte" role="tabpanel" aria-labelledby="tab-flotte" hidden>
      <article class="sl-karte">
        <h2>Jede Installation</h2>
        <p class="sl-notiz">Grün nur, wenn von innen geprüft und sauber; das prüft erst Teil 2, bis dahin ist nichts grün. Grau heißt: nicht geprüft, der Grund steht in der Akte. Die grauen Spalten füllen Teil 2 und Teil 3. Eine Zeile anklicken öffnet die Akte der Site.</p>
        <div class="sl-filter">
          <input class="sl-eingabe" type="search" id="f-suche" placeholder="Suchen" aria-label="Installationen durchsuchen">
          <div class="sl-chips" id="f-ampel" role="group" aria-label="Nach Ampel filtern"></div>
          <select class="sl-eingabe" id="f-welt" aria-label="Nach Welt filtern"></select>
          <select class="sl-eingabe" id="f-stufe" aria-label="Nach Stufe filtern"></select>
        </div>
        <p class="sl-notiz" id="flotte-anzahl"></p>
        <div class="sl-rahmen" id="flotte-tabelle"></div>
      </article>
    </section>

    <section class="sl-seite" id="abdeckung" role="tabpanel" aria-labelledby="tab-abdeckung" hidden>
      <div class="sl-kacheln" id="abdeckung-kacheln"></div>
      <div class="sl-zwei">
        <article class="sl-karte">
          <h2>Neu, noch keiner Stufe zugeordnet</h2>
          <p class="sl-notiz">Sites, die der Wächter neu im Inventar gefunden hat. Nach sieben Tagen ohne Stufe wird daraus ein Alarm. Die Stufe setzt du in der Akte.</p>
          <div class="sl-rahmen" id="abdeckung-neu"></div>
        </article>
        <article class="sl-karte">
          <h2>Premium laut Abo-Text, unbestätigt</h2>
          <p class="sl-notiz">Der Wächter hat Premium aus dem Text eines Wartungs-Abos gelesen. Erst deine Bestätigung macht die Stufe fest.</p>
          <div class="sl-rahmen" id="abdeckung-premium"></div>
        </article>
      </div>
      <article class="sl-karte">
        <h2>Mit Wartungsstufe, aber ohne mySites</h2>
        <p class="sl-notiz">Für diese Sites laufen keine Audits, Backups und Updates über mySites.</p>
        <div class="sl-rahmen" id="abdeckung-ohne-mysites"></div>
      </article>
      <article class="sl-karte">
        <h2>Widersprüche zwischen Vertrag und Einordnung</h2>
        <p class="sl-notiz">Ausgelaufene Verträge bei Sites, die wir weiter hosten (I4), und laufende Verträge bei Sites, die nicht überwacht werden (I9).</p>
        <div class="sl-rahmen" id="abdeckung-widersprueche"></div>
      </article>
      <article class="sl-karte">
        <h2>Nicht überwacht</h2>
        <p class="sl-notiz">Sites, die bewusst aus der Überwachung genommen sind, mit Grund und Datum. „durchgesehen“ vermerkt, dass der Grund noch stimmt; „zurückholen“ nimmt die Site wieder in die Überwachung.</p>
        <div class="sl-rahmen" id="abdeckung-nicht-ueberwacht"></div>
      </article>
    </section>

    <section class="sl-seite" id="aufraeumen" role="tabpanel" aria-labelledby="tab-aufraeumen" hidden>
      <div class="sl-kacheln" id="aufraeumen-kacheln"></div>
      <article class="sl-karte">
        <h2>Kandidaten</h2>
        <p class="sl-notiz">Installationen, die in keiner Quelle mehr stehen, und Installationen von Sites mit Stufe intern. „aufgeräumt“ schließt den Aufräum-Eintrag (I6); der Kern nimmt dann die verschwundenen Installationen aus seinem Inventar. Auf den Servern wird nichts gelöscht. Ein interner Eintrag kommt wieder, solange die Site intern ist; „stumm bis“ stellt ihn zurück.</p>
        <div class="sl-filter"><input class="sl-eingabe" type="search" id="r-suche" placeholder="Suchen" aria-label="Kandidaten durchsuchen"></div>
        <div class="sl-rahmen" id="aufraeumen-tabelle"></div>
      </article>
    </section>

    <section class="sl-seite" id="waechter" role="tabpanel" aria-labelledby="tab-waechter" hidden>
      <article class="sl-karte">
        <h2>Runden</h2>
        <p class="sl-notiz" id="waechter-zustand"></p>
        <p class="sl-notiz">Die letzten beendeten Runden, die jüngste zuerst. Der Wächter läuft stündlich.</p>
        <div class="sl-rahmen" id="waechter-runden"></div>
      </article>
      <article class="sl-karte">
        <h2>Quellen der letzten Runde</h2>
        <p class="sl-notiz">Was der Wächter in der letzten Runde abgefragt hat, mit Dauer und Ausfällen in Folge.</p>
        <div class="sl-rahmen" id="waechter-quellen"></div>
      </article>
      <article class="sl-karte">
        <h2>So entsteht die Ampel</h2>
        <ul class="sl-regeln">
          <li><span class="sl-pill sl-rot">rot</span> ein Alarm liegt offen.</li>
          <li><span class="sl-pill sl-gelb">gelb</span> ein Befund liegt offen, oder ein Alarm ist stumm geschaltet.</li>
          <li><span class="sl-pill sl-gruen">grün</span> von innen geprüft und sauber. Das prüft erst Teil 2; bis dahin ist nichts grün.</li>
          <li><span class="sl-pill sl-grau">grau</span> von innen noch nicht geprüft, oder die Site wird nicht überwacht. Der Grund steht in der Akte.</li>
        </ul>
      </article>
    </section>
  </div>
</div>

<aside class="sl-akte" id="akte" aria-labelledby="akte-titel" hidden>
  <div class="sl-akte-kopf"><h2 id="akte-titel" tabindex="-1"></h2><button type="button" class="sl-knopf" id="akte-zu">Akte schließen</button></div>
  <div class="sl-akte-inhalt" id="akte-inhalt"></div>
</aside>

<script id="darstellung">
${funktionen}
</script>
<script>
${skript(opts.zweiterFaktorPfad)}
</script>
</body>
</html>
`;
}

function skript(zweiterFaktorPfad: string): string {
  return `(function () {
  'use strict';

  var ZWEITER_FAKTOR = ${JSON.stringify(zweiterFaktorPfad)};
  var ANMELDEN = ${JSON.stringify(ANMELDEN)};
  var SEITEN = ['lage', 'flotte', 'abdeckung', 'aufraeumen', 'waechter'];
  var STUFEN = ['premium', 'standard', 'ohne', 'bewusst-ohne', 'intern', 'neu'];
  var MERKER = [['vip', 'VIP'], ['fremdhosting', 'Fremdhosting'], ['kein_ssh_moeglich', 'kein SSH möglich']];
  var AMPEL_KLASSE = { 'rot': 'sl-rot', 'gelb': 'sl-gelb', 'grün': 'sl-gruen', 'grau': 'sl-grau' };
  var URTEIL_TEXT = { 'erledigt': 'erledigt', 'stumm': 'stumm bis', 'stimmt': 'stimmt', 'kein-hack': 'kein Hack' };
  /** So oft fragt die Seite den Verlauf, solange ein Auftrag läuft (die Obergrenze steht in auftragNachVerlauf). */
  var TAKT_MS = 10000;
  /** So lange lädt sie nach einer Quittung den Stand nach, bis der neue da ist. */
  var STAND_WARTEN_MS = 2 * 60 * 1000;

  var st = {
    antwort: null, geladenMs: 0, laedt: null,
    seite: 'lage', akte: null,
    filter: { ampel: 'alle', welt: 'alle', stufe: 'alle', suche: '' },
    rsuche: '', sort: {}, offen: {}, eingaben: {},
    auftraege: [], takt: null, standFrischAb: null, standFrist: 0
  };

  // ─── Bausteine ───

  function el(tag, klasse, text) {
    var e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }
  function pille(text, klasse) { return el('span', 'sl-pill ' + (klasse || ''), text); }
  function ampelPille(ampel) { var w = ampelText(ampel); return pille(w, AMPEL_KLASSE[w]); }
  function leise(text) { return el('span', 'sl-grau', text); }
  function liste(x) { return Array.isArray(x) ? x : []; }
  function stand() { return st.antwort && st.antwort.stand ? st.antwort.stand : null; }
  function knopf(text, beiKlick, aus) {
    var b = el('button', 'sl-knopf', text);
    b.type = 'button';
    b.disabled = !!aus;
    b.addEventListener('click', function (e) { e.stopPropagation(); beiKlick(); });
    return b;
  }
  function inTagen(n) { return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10); }
  function uhrzeit(ms) { return new Date(ms).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }); }
  function serverText(z) { return [z.server, z.account].filter(Boolean).join(' · '); }
  function eingabe(schluessel, standard) {
    return Object.prototype.hasOwnProperty.call(st.eingaben, schluessel) ? st.eingaben[schluessel] : standard;
  }
  /** Eingaben überleben das Neuzeichnen (etwa wenn die Quittung eines anderen Auftrags kommt). */
  function merke(feld, schluessel) {
    function sichern() { feld.setCustomValidity(''); st.eingaben[schluessel] = feld.value; }
    feld.addEventListener('input', sichern);
    feld.addEventListener('change', sichern);
    feld.addEventListener('click', function (e) { e.stopPropagation(); });
    feld.addEventListener('keydown', function (e) { e.stopPropagation(); });
  }
  function pflicht(feld, text) {
    feld.setCustomValidity(text);
    feld.reportValidity();
    feld.focus();
  }
  function datumsfeld(schluessel, standard, aus) {
    var f = el('input', 'sl-eingabe');
    f.type = 'date';
    f.min = inTagen(0);
    f.value = eingabe(schluessel, standard);
    f.disabled = !!aus;
    f.setAttribute('aria-label', 'Datum');
    merke(f, schluessel);
    return f;
  }
  function mitRueck(inhalt, ziel) {
    var box = el('div');
    box.append(inhalt);
    var r = rueckKnoten(ziel);
    if (r) box.append(r);
    return box;
  }

  // ─── Laden ───

  /** fetch mit JSON: ok nur bei 2xx UND lesbarem JSON-Objekt; Status 0 ohne Verbindung. */
  function holeJson(url, koerper) {
    var init = { credentials: 'same-origin', headers: { 'Accept': 'application/json' } };
    if (koerper !== undefined) {
      init.method = 'POST';
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(koerper);
    }
    return fetch(url, init).then(function (res) {
      return res.text().then(function (text) {
        var daten = null;
        try { daten = JSON.parse(text); } catch (e) { daten = null; }
        if (daten === null || typeof daten !== 'object' || Array.isArray(daten)) daten = null;
        return { ok: res.ok && daten !== null, status: res.status, koerper: daten };
      });
    }).catch(function () { return { ok: false, status: 0, koerper: null }; });
  }

  function linkZu(ziel) {
    var a = null;
    if (ziel === 'zweiter-faktor') { a = el('a', null, 'Code eingeben'); a.href = ZWEITER_FAKTOR; }
    if (ziel === 'anmelden') { a = el('a', null, 'Neu anmelden'); a.href = ANMELDEN; }
    return a;
  }
  function zeigeHinweis(text, ziel) {
    var box = document.getElementById('hinweis');
    box.replaceChildren(el('span', null, text));
    var link = linkZu(ziel);
    if (link) box.append(' ', link);
    box.removeAttribute('data-von');
    box.hidden = false;
  }

  function ladeStand() {
    if (st.laedt) return st.laedt;
    st.laedt = holeJson('/api/sicherheit/stand').then(function (r) {
      st.laedt = null;
      if (!r.ok) {
        var f = apiFehlerText(r.status, r.koerper);
        zeigeHinweis('Der Stand ließ sich nicht laden. ' + f.text, f.ziel);
        if (!st.antwort) document.getElementById('kernsatz').textContent = 'Kein Stand geladen.';
        return;
      }
      st.antwort = r.koerper;
      st.geladenMs = Date.now();
      document.getElementById('hinweis').hidden = true;
      zeichne();
    });
    return st.laedt;
  }

  // ─── Aufträge und Rückmeldung ───

  function letzterAuftrag(ziel) {
    for (var i = st.auftraege.length - 1; i >= 0; i -= 1) if (st.auftraege[i].ziel === ziel) return st.auftraege[i];
    return null;
  }
  function laeuft(ziel) { var a = letzterAuftrag(ziel); return a !== null && a.status === 'laeuft'; }
  function rueckText(a) {
    if (a.status === 'laeuft') return 'wird übernommen';
    if (a.status === 'angewandt') return 'Übernommen: ' + a.text;
    if (a.status === 'fehler') return (a.abgewiesen ? 'Nicht angenommen: ' : 'Nicht übernommen: ') + a.text;
    return a.text;
  }
  function rueckKlasse(a) {
    if (a.status === 'laeuft') return 'sl-rueck-laeuft';
    if (a.status === 'fehler') return 'sl-rot';
    if (a.status === 'still') return 'sl-gelb';
    return '';
  }
  function rueckKnoten(ziel) {
    var a = letzterAuftrag(ziel);
    if (a === null) return null;
    var p = el('p', 'sl-rueck ' + rueckKlasse(a), rueckText(a));
    p.setAttribute('role', 'status');
    var link = a.linkZiel ? linkZu(a.linkZiel) : null;
    if (link) p.append(' ', link);
    return p;
  }

  /** Schickt einen Auftrag. Bis die Quittung des Kerns da ist, steht am Ziel „wird übernommen“. */
  function sende(koerper, ziel, was) {
    if (laeuft(ziel)) return;
    var a = { id: null, ziel: ziel, was: was, gesendetMs: Date.now(), erstelltIso: null, status: 'laeuft', text: 'wird übernommen', quittiertIso: null };
    st.auftraege.push(a);
    zeichne();
    holeJson('/api/sicherheit/auftraege', koerper).then(function (r) {
      if (r.ok && typeof r.koerper.id === 'string') {
        a.id = r.koerper.id;
        planeTakt(1000);
      } else {
        var f = apiFehlerText(r.status, r.koerper);
        a.status = 'fehler';
        a.abgewiesen = true;
        a.text = f.text;
        a.linkZiel = f.ziel;
      }
      zeichne();
    });
  }

  function planeTakt(ms) {
    if (st.takt !== null) return;
    st.takt = setTimeout(takt, ms);
  }
  /** Ein Schritt der Rückmeldung. Er plant den nächsten nur, solange ein Auftrag läuft oder ein Stand aussteht: nie ohne Ende. */
  function takt() {
    st.takt = null;
    var url = verlaufAnfrage(st.auftraege.filter(function (a) { return a.id !== null; }));
    var standFehlt = st.standFrischAb !== null && Date.now() < st.standFrist;
    if (url === null && !standFehlt) { st.standFrischAb = null; return; }
    var arbeit = [];
    if (url !== null) arbeit.push(holeJson(url).then(verlaufAuswerten));
    if (standFehlt) arbeit.push(standNachQuittung());
    Promise.all(arbeit).then(function () { planeTakt(TAKT_MS); });
  }
  function verlaufAuswerten(r) {
    var jetzt = Date.now();
    var jeId = {};
    var hinweis = document.getElementById('hinweis');
    if (r.ok && Array.isArray(r.koerper.auftraege)) {
      r.koerper.auftraege.forEach(function (e) { if (e && typeof e.id === 'string') jeId[e.id] = e; });
      if (hinweis.getAttribute('data-von') === 'verlauf') hinweis.hidden = true;
    } else {
      // Ohne Verlauf läuft die Frist weiter; der Hinweis sagt, dass es an der Verbindung liegt und nicht am Kern.
      var f = apiFehlerText(r.status, r.koerper);
      zeigeHinweis('Der Verlauf der Aufträge ließ sich nicht lesen. ' + f.text, f.ziel);
      hinweis.setAttribute('data-von', 'verlauf');
    }
    var geaendert = false;
    var quittiert = null;
    st.auftraege.forEach(function (a) {
      if (a.id === null || a.status !== 'laeuft') return;
      var neu = auftragNachVerlauf(a, jeId[a.id], jetzt);
      if (neu.status !== a.status) {
        geaendert = true;
        if (neu.status === 'angewandt' && neu.quittiertIso && (quittiert === null || neu.quittiertIso > quittiert)) quittiert = neu.quittiertIso;
      }
      Object.assign(a, neu);
    });
    if (quittiert !== null) {
      if (st.standFrischAb === null || quittiert > st.standFrischAb) st.standFrischAb = quittiert;
      st.standFrist = jetzt + STAND_WARTEN_MS;
      return standNachQuittung();
    }
    if (geaendert) zeichne();
  }
  /** Bei „angewandt“ den Stand neu laden; der Kern schiebt ihn gleich nach der Quittung, also kann er noch ein paar Sekunden alt sein. */
  function standNachQuittung() {
    return ladeStand().then(function () {
      if (st.antwort && st.standFrischAb !== null && st.antwort.empfangenIso && st.antwort.empfangenIso >= st.standFrischAb) st.standFrischAb = null;
      zeichne();
    });
  }

  // ─── Zeichnen ───

  function zeichne() {
    var s = stand();
    document.getElementById('ansichten').hidden = !s;
    zeichneKopf();
    zeichneRueckmeldungen();
    if (s) {
      zeichneLage(s);
      zeichneFlotte(s);
      zeichneAbdeckung(s);
      zeichneAufraeumen(s);
      zeichneWaechter(s);
    }
    zeichneAkte();
  }

  function zeichneKopf() {
    if (!st.antwort) return;
    var s = stand();
    var kern = document.getElementById('kernsatz');
    var alter = document.getElementById('stand-alter');
    var waechter = document.getElementById('waechter-zeile');
    if (!s) {
      kern.textContent = 'Der Wächter hat noch keinen Stand geschickt. Sobald der erste da ist, steht er hier.';
      alter.textContent = standAlterText(null).text + '.';
      alter.className = 'sl-rot';
      waechter.textContent = '';
      return;
    }
    kern.textContent = kopfSatz(s.kennzahlen);
    var a = standAlterText(st.antwort.alterMinuten + (Date.now() - st.geladenMs) / 60000);
    alter.textContent = a.text + ' (' + zeitText(st.antwort.empfangenIso) + ')' + (a.rot ? '. Der Kern schickt sonst alle fünf Minuten einen neuen.' : '.');
    alter.className = a.rot ? 'sl-rot' : '';
    var w = waechterText(s.runde, s.waechter ? s.waechter.quellen : []);
    waechter.textContent = w.text;
    waechter.className = 'sl-stand' + (w.warnung ? ' sl-gelb' : '');
  }

  function zeichneRueckmeldungen() {
    var letzte = st.auftraege.slice(-6).reverse();
    document.getElementById('rueckmeldungen').hidden = letzte.length === 0;
    document.getElementById('rueck-liste').replaceChildren.apply(document.getElementById('rueck-liste'), letzte.map(function (a) {
      var li = el('li');
      li.append(el('span', 'sl-grau', uhrzeit(a.gesendetMs) + ' · ' + a.was + ': '), el('span', rueckKlasse(a), rueckText(a)));
      var link = a.linkZiel ? linkZu(a.linkZiel) : null;
      if (link) li.append(' ', link);
      return li;
    }));
  }

  function kacheln(id, eintraege) {
    var box = document.getElementById(id);
    box.replaceChildren.apply(box, eintraege.map(function (k) {
      var n = typeof k.zahl === 'number' ? k.zahl : null;
      var klasse = 'sl-kachel';
      if (k.grau) klasse += ' sl-kachel-grau';
      else if (k.art === 'schlecht' && n > 0) klasse += ' sl-schlecht';
      else if (k.art === 'warnung' && n > 0) klasse += ' sl-warnung';
      var kachel = el('div', klasse);
      var label = Array.isArray(k.label) ? k.label[n === 1 ? 0 : 1] : k.label;
      kachel.append(el('span', 'sl-zahl', k.grau ? k.grau : n === null ? '' : String(n)), el('span', 'sl-label', label));
      return kachel;
    }));
  }

  function vergleiche(x, y) {
    var leerX = x === null || x === undefined || x === '';
    var leerY = y === null || y === undefined || y === '';
    if (leerX || leerY) return leerX === leerY ? 0 : leerX ? 1 : -1;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x).localeCompare(String(y), 'de');
  }

  /**
   * Eine Tabelle in den Rahmen mit dieser ID. Spalten: titel, wert (sortiert und, ohne zelle, angezeigt),
   * zelle (Knoten oder Text), klasse, grau (Text für Spalten, die erst ein späterer Teil füllt).
   */
  function tabelle(id, spalten, zeilen, opt) {
    var rahmen = document.getElementById(id);
    if (zeilen.length === 0) { rahmen.replaceChildren(el('p', 'sl-leer', opt.leer || 'Keine Einträge.')); return; }
    var s = st.sort[id];
    var t = el('table', 'sl-tabelle' + (opt.klick ? ' sl-klickbar' : ''));
    var kopf = el('tr');
    spalten.forEach(function (sp, i) {
      var th = el('th', sp.klasse || null);
      th.setAttribute('scope', 'col');
      if (sp.wert) {
        var b = el('button', null, sp.titel);
        b.type = 'button';
        b.addEventListener('click', function () {
          var alt = st.sort[id];
          st.sort[id] = { i: i, ab: alt && alt.i === i ? !alt.ab : true };
          tabelle(id, spalten, zeilen, opt);
        });
        th.append(b);
        th.setAttribute('aria-sort', s && s.i === i ? (s.ab ? 'ascending' : 'descending') : 'none');
      } else {
        th.append(el('span', 'sl-th', sp.titel));
      }
      kopf.append(th);
    });
    var thead = el('thead');
    thead.append(kopf);
    var reihe = zeilen.slice();
    if (s) reihe.sort(function (a, b) { var r = vergleiche(spalten[s.i].wert(a), spalten[s.i].wert(b)); return s.ab ? r : -r; });
    else if (opt.ordnung) reihe.sort(opt.ordnung);
    var body = el('tbody');
    reihe.forEach(function (r) {
      var tr = el('tr', opt.zeilenKlasse ? opt.zeilenKlasse(r) : null);
      spalten.forEach(function (sp) {
        var td = el('td', sp.klasse || null);
        if (sp.grau) td.append(leise(sp.grau));
        else {
          var inhalt = sp.zelle ? sp.zelle(r) : sp.wert(r);
          if (inhalt instanceof Node) td.append(inhalt);
          else if (inhalt !== null && inhalt !== undefined) td.textContent = String(inhalt);
        }
        tr.append(td);
      });
      if (opt.klick) {
        tr.tabIndex = 0;
        if (opt.gewaehlt && opt.gewaehlt(r)) tr.setAttribute('aria-selected', 'true');
        tr.addEventListener('click', function (e) {
          if (e.target.closest && e.target.closest('button, input, select, a, label')) return;
          opt.klick(r);
        });
        tr.addEventListener('keydown', function (e) {
          if (e.target !== tr) return;
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opt.klick(r); }
        });
      }
      body.append(tr);
      if (opt.nachZeile) {
        var extra = opt.nachZeile(r, spalten.length);
        if (extra) body.append(extra);
      }
    });
    t.append(thead, body);
    rahmen.replaceChildren(t);
  }

  // ─── Lage ───

  function artPille(z) {
    if (z.status === 'stumm') return pille(z.klasse === 'alarm' ? 'Alarm, stumm' : 'Befund, stumm', 'sl-gelb');
    return z.klasse === 'alarm' ? pille('Alarm', 'sl-rot') : pille('Befund', 'sl-gelb');
  }
  function statusText(z) { return z.status === 'stumm' ? 'stumm bis ' + tagText(z.stummBisIso) : 'offen'; }
  function wasZelle(z) {
    var box = el('div');
    box.append(el('span', 'sl-haupt', z.titel), el('span', 'sl-text', z.text));
    return box;
  }
  function siteZelle(z) {
    if (z.site !== '_alle') return siteText(z.site);
    var auf = !!st.offen[z.befundId];
    var b = el('button', 'sl-link', zahlWort(liste(z.mitglieder).length, 'Site', 'Sites') + (auf ? ' ▾' : ' ▸'));
    b.type = 'button';
    b.setAttribute('aria-expanded', String(auf));
    b.addEventListener('click', function (e) { e.stopPropagation(); st.offen[z.befundId] = !auf; zeichneLage(stand()); });
    var box = el('div');
    box.append(leise('Sammelalarm: '), b);
    return box;
  }
  function mitgliederZeile(z, spalten) {
    var tr = el('tr', 'sl-mitglieder');
    var td = el('td');
    td.colSpan = spalten;
    var ul = el('ul');
    liste(z.mitglieder).forEach(function (m) {
      var li = el('li');
      var b = el('button', 'sl-link', m);
      b.type = 'button';
      b.addEventListener('click', function (e) { e.stopPropagation(); oeffneAkte(akteSiteFuer(m)); });
      li.append(b);
      ul.append(li);
    });
    td.append(leise('Sites in diesem Sammelalarm, ein Klick öffnet ihre Akte:'), ul);
    tr.append(td);
    return tr;
  }
  /** Die Urteile einer Zeile der Lage; Sammel- und Quellenzeilen nur erledigt und stumm (urteileFuerLage). */
  function urteile(z) {
    var ziel = 'lage:' + z.befundId;
    var aus = laeuft(ziel);
    var box = el('div', 'sl-aktionen');
    urteileFuerLage(z).forEach(function (art) {
      if (art === 'stumm') {
        var feld = datumsfeld('stumm:' + z.befundId, inTagen(7), aus);
        box.append(feld, knopf(URTEIL_TEXT[art], function () {
          if (!feld.value) { pflicht(feld, 'Bitte ein Datum wählen.'); return; }
          sende(auftragFuerLage(z, 'stumm', feld.value), ziel, 'stumm bis ' + tagText(feld.value) + ': ' + siteText(z.site) + ', ' + z.typ);
        }, aus));
      } else {
        box.append(knopf(URTEIL_TEXT[art], function () {
          sende(auftragFuerLage(z, art), ziel, URTEIL_TEXT[art] + ': ' + siteText(z.site) + ', ' + z.typ);
        }, aus));
      }
    });
    return mitRueck(box, ziel);
  }
  function zeichneBalken(lage) {
    var box = document.getElementById('lage-balken');
    if (lage.length === 0) { box.replaceChildren(el('p', 'sl-leer', 'Nichts liegt offen.')); return; }
    var max = Math.max.apply(null, [1].concat(lage.map(function (z) { return z.liegezeitTage || 0; })));
    var reihe = lage.slice().sort(function (a, b) { return b.liegezeitTage - a.liegezeitTage; });
    box.replaceChildren.apply(box, reihe.map(function (z) {
      var zeile = el('div', 'sl-bz');
      var label = el('div', 'sl-bl');
      var neben = [z.typ, 'seit ' + datumText(z.seitIso), z.status === 'stumm' ? 'stumm bis ' + tagText(z.stummBisIso) : ''].filter(Boolean).join(' · ');
      label.append(el('span', 'sl-haupt', siteText(z.site) + ' · ' + z.titel), el('span', 'sl-neben', neben));
      var spur = el('div', 'sl-spur');
      var fuell = el('div', 'sl-fuell ' + (z.status !== 'offen' ? 'sl-f-stumm' : z.klasse === 'alarm' ? 'sl-f-alarm' : 'sl-f-befund'));
      fuell.style.width = (Math.max(0, z.liegezeitTage || 0) / max) * 100 + '%';
      spur.append(fuell);
      zeile.append(label, spur, el('div', 'sl-bw', liegezeitText(z.liegezeitTage)));
      return zeile;
    }));
  }
  function zeichneLage(s) {
    var lage = liste(s.lage);
    var k = s.kennzahlen || {};
    var aeltester = lage.filter(function (z) { return z.status === 'offen'; }).sort(function (a, b) { return b.liegezeitTage - a.liegezeitTage; })[0];
    kacheln('lage-kacheln', [
      { zahl: k.alarmeOffen, label: ['Alarm liegt offen', 'Alarme liegen offen'], art: 'schlecht' },
      { zahl: k.befundeOffen, label: ['Befund liegt offen', 'Befunde liegen offen'], art: 'warnung' },
      { zahl: k.aeltesteLiegezeitTage, label: ['Tag', 'Tage'].map(function (w) { return w + ' liegt der älteste offene Eintrag' + (aeltester ? ': ' + siteText(aeltester.site) : ''); }), art: 'warnung' }
    ]);
    zeichneBalken(lage);
    tabelle('lage-tabelle', [
      { titel: 'Art', wert: function (z) { return z.status === 'stumm' ? 2 : z.klasse === 'alarm' ? 0 : 1; }, zelle: artPille },
      { titel: 'Regel', wert: function (z) { return z.typ; } },
      { titel: 'Site', wert: function (z) { return siteText(z.site); }, zelle: siteZelle, klasse: 'sl-nw' },
      { titel: 'Was', wert: function (z) { return z.titel; }, zelle: wasZelle },
      { titel: 'Seit', wert: function (z) { return z.seitIso; }, zelle: function (z) { return datumText(z.seitIso); }, klasse: 'sl-nw' },
      { titel: 'Tage', wert: function (z) { return z.liegezeitTage; }, klasse: 'sl-num' },
      { titel: 'Status', wert: statusText },
      { titel: 'Urteil', zelle: urteile }
    ], lage, {
      leer: 'Nichts liegt offen.',
      zeilenKlasse: function (z) { return z.status === 'stumm' ? 'sl-zeile-stumm' : null; },
      klick: function (z) { oeffneAkte(akteSiteFuer(z.site)); },
      gewaehlt: function (z) { return st.akte !== null && akteSiteFuer(z.site) === st.akte; },
      nachZeile: function (z, n) { return z.site === '_alle' && st.offen[z.befundId] ? mitgliederZeile(z, n) : null; }
    });
  }

  // ─── Flotte ───

  function auswahl(id, optionen, wert) {
    var sel = document.getElementById(id);
    sel.replaceChildren.apply(sel, optionen.map(function (o) { var opt = el('option', null, o[1]); opt.value = o[0]; return opt; }));
    sel.value = optionen.some(function (o) { return o[0] === wert; }) ? wert : 'alle';
  }
  function zeichneFilter(flotte) {
    var zahl = { 'alle': flotte.length, 'rot': 0, 'gelb': 0, 'grün': 0, 'grau': 0 };
    flotte.forEach(function (z) { zahl[ampelText(z.ampel)] += 1; });
    var chips = document.getElementById('f-ampel');
    chips.replaceChildren.apply(chips, ['alle', 'rot', 'gelb', 'grün', 'grau'].map(function (wert) {
      var c = el('button', 'sl-chip');
      c.type = 'button';
      c.setAttribute('aria-pressed', String(st.filter.ampel === wert));
      if (wert !== 'alle') c.append(el('span', 'sl-punkt ' + AMPEL_KLASSE[wert]));
      c.append(wert + ' ' + zahl[wert]);
      c.addEventListener('click', function () { st.filter.ampel = wert; zeichneFlotte(stand()); });
      return c;
    }));
    var welten = {};
    flotte.forEach(function (z) { welten[z.welt] = (welten[z.welt] || 0) + 1; });
    auswahl('f-welt', [['alle', 'jede Welt']].concat(Object.keys(welten).sort().map(function (w) {
      return [w, weltText(w) + ' (' + welten[w] + ')'];
    })), st.filter.welt);
    var stufen = {};
    flotte.forEach(function (z) { var k = z.stufe || 'keine'; stufen[k] = (stufen[k] || 0) + 1; });
    auswahl('f-stufe', [['alle', 'jede Stufe']].concat(STUFEN.concat(['keine']).filter(function (k) { return stufen[k]; }).map(function (k) {
      return [k, stufeName(k === 'keine' ? null : k) + ' (' + stufen[k] + ')'];
    })), st.filter.stufe);
  }
  function stufeZelle(z) {
    var box = el('div');
    box.append(el('span', z.stufe ? null : 'sl-grau', stufeName(z.stufe)));
    if (z.stufe) box.append(el('span', 'sl-text', quelleText(z.stufeQuelle)));
    if (z.stufe && !z.bestaetigt) box.append(pille('unbestätigt', 'sl-gelb'));
    return box;
  }
  /** Zwei Zeilen statt einer langen: oben das Wichtige, darunter leise der Rest. */
  function zweiZeilen(oben, unten, klasse) {
    var box = el('div', 'sl-zeilen');
    box.append(el('span', klasse || null, oben));
    if (unten) box.append(el('span', 'sl-grau', unten));
    return box;
  }
  function offenZelle(z) {
    var box = el('div', 'sl-zeilen');
    if (z.alarme) box.append(el('span', 'sl-rot', zahlWort(z.alarme, 'Alarm', 'Alarme')));
    if (z.befunde) box.append(el('span', 'sl-gelb', zahlWort(z.befunde, 'Befund', 'Befunde')));
    if (!z.alarme && !z.befunde) box.append(leise('keine'));
    return box;
  }
  function mysitesZelle(z) {
    if (!z.mysites || !z.mysites.verbunden) return leise(mysitesText(z.mysites));
    return zweiZeilen('verbunden', z.mysites.letztesAuditIso ? 'Audit ' + zeitText(z.mysites.letztesAuditIso) : 'noch kein Audit');
  }
  function backupZelle(z) {
    if (!z.backup) return leise(backupText(z.backup));
    if (!z.backup.letztesOkIso) return zweiZeilen('kein erfolgreiches', z.backup.ziel || '', 'sl-gelb');
    return zweiZeilen(zeitText(z.backup.letztesOkIso), z.backup.ziel || '');
  }
  function gesehenZelle(z) {
    return z.verschwunden ? zweiZeilen('verschwunden', zeitText(z.zuletztGesehenIso), 'sl-gelb') : zweiZeilen(zeitText(z.zuletztGesehenIso), '');
  }
  function zeichneFlotte(s) {
    var flotte = liste(s.flotte);
    var geladen = s.vertraegeGeladen;
    zeichneFilter(flotte);
    var zeilen = flotte.filter(function (z) { return flottePasst(z, st.filter, geladen); });
    document.getElementById('flotte-anzahl').textContent = zeilen.length === flotte.length
      ? zahlWort(flotte.length, 'Installation', 'Installationen')
      : zeilen.length + ' von ' + zahlWort(flotte.length, 'Installation', 'Installationen');
    tabelle('flotte-tabelle', [
      { titel: 'Ampel', wert: function (z) { return ampelRang(z.ampel); }, zelle: function (z) { var p = ampelPille(z.ampel); p.title = z.grund || ''; return p; } },
      { titel: 'Site', wert: function (z) { return z.site; }, klasse: 'sl-nw' },
      { titel: 'Kunde', wert: function (z) { return kundeText(z.kunde, geladen); }, zelle: function (z) {
        return z.kunde && geladen !== false ? zweiZeilen(z.kunde.firma, z.kunde.kundeNr) : leise(kundeText(z.kunde, geladen));
      } },
      { titel: 'Stufe', wert: function (z) { return stufeText(z.stufe, z.stufeQuelle, z.bestaetigt); }, zelle: stufeZelle },
      { titel: 'Merker', wert: function (z) { return merkerText(z.merker); } },
      { titel: 'Welt', wert: function (z) { return weltText(z.welt); }, klasse: 'sl-nw' },
      { titel: 'Server/Projekt', wert: serverText, klasse: 'sl-nw' },
      { titel: 'Pfad', wert: function (z) { return z.pfad || ''; }, klasse: 'sl-nb sl-nw' },
      { titel: 'ausgeliefert', wert: function (z) { return ausgeliefertText(z.ausgeliefert); }, zelle: function (z) {
        var t = ausgeliefertText(z.ausgeliefert);
        return el('span', t === 'nein' ? 'sl-gelb' : t === 'unbekannt' ? 'sl-grau' : null, t);
      } },
      { titel: 'CMS', wert: function (z) { return [z.cms, z.version].filter(Boolean).join(' '); }, zelle: function (z) {
        return z.cms ? zweiZeilen(z.cms, z.version || '') : '';
      }, klasse: 'sl-nb' },
      { titel: 'PHP', wert: function (z) { return z.php || ''; }, klasse: 'sl-nw' },
      { titel: 'mySites', wert: function (z) { return mysitesText(z.mysites); }, zelle: mysitesZelle, klasse: 'sl-nb' },
      { titel: 'Backup', wert: function (z) { return z.backup && z.backup.letztesOkIso ? z.backup.letztesOkIso : ''; }, zelle: backupZelle, klasse: 'sl-nb' },
      { titel: 'Offen', wert: function (z) { return (z.alarme || 0) * 1000 + (z.befunde || 0); }, zelle: offenZelle },
      { titel: 'zuletzt gesehen', wert: function (z) { return z.zuletztGesehenIso; }, zelle: gesehenZelle },
      { titel: 'Zugang', grau: 'ab Teil 2', klasse: 'sl-nw' },
      { titel: 'Prüfung von innen', grau: 'ab Teil 2', klasse: 'sl-nw' },
      { titel: 'Angriffe im Log', grau: 'ab Teil 3', klasse: 'sl-nb sl-nw' },
      { titel: 'Shell-Aufrufe', grau: 'ab Teil 3', klasse: 'sl-nb sl-nw' }
    ], zeilen, {
      leer: 'Keine Installation passt zu den Filtern.',
      ordnung: function (a, b) { return ampelRang(a.ampel) - ampelRang(b.ampel) || vergleiche(a.site, b.site) || vergleiche(a.id, b.id); },
      klick: function (z) { oeffneAkte(z.site); },
      gewaehlt: function (z) { return z.site === st.akte; }
    });
  }

  // ─── Abdeckung ───

  function premiumAktion(z) {
    var ziel = 'site:' + z.site + ':stufe';
    return mitRueck(knopf('Premium bestätigen', function () {
      sende({ art: 'stufe', site: z.site, werte: { stufe: 'premium' } }, ziel, 'Premium bestätigen: ' + z.site);
    }, laeuft(ziel)), ziel);
  }
  function ueberwachungAktionen(site) {
    var ziel = 'site:' + site + ':ueberwachung';
    var aus = laeuft(ziel);
    var box = el('div', 'sl-aktionen');
    box.append(
      knopf('durchgesehen', function () { sende({ art: 'durchgesehen', site: site, werte: {} }, ziel, 'Durchsicht: ' + site); }, aus),
      knopf('zurückholen', function () { sende({ art: 'ueberwachen', site: site, werte: {} }, ziel, 'zurückholen: ' + site); }, aus)
    );
    return mitRueck(box, ziel);
  }
  function zeichneAbdeckung(s) {
    var k = s.kennzahlen || {};
    var ab = s.abdeckung || {};
    var geladen = s.vertraegeGeladen;
    var akte = { klick: function (z) { oeffneAkte(z.site); }, gewaehlt: function (z) { return z.site === st.akte; } };
    function mit(opt) { return Object.assign({}, akte, opt); }
    kacheln('abdeckung-kacheln', [
      { zahl: k.installationen, label: ['Installation im Inventar', 'Installationen im Inventar'] },
      { zahl: k.sites, label: ['Site', 'Sites'] },
      { zahl: k.neu, label: ['Site neu, noch ohne Stufe', 'Sites neu, noch ohne Stufe'], art: 'warnung' },
      { zahl: k.ohneMysites, label: ['Site mit Wartungsstufe, aber ohne mySites', 'Sites mit Wartungsstufe, aber ohne mySites'], art: 'schlecht' },
      { zahl: k.premiumUnbestaetigt, label: 'Premium laut Abo-Text, unbestätigt', art: 'warnung' },
      { zahl: k.nichtUeberwacht, label: ['Site nicht überwacht', 'Sites nicht überwacht'] },
      { grau: 'ab Teil 2', label: 'von innen geprüft' }
    ]);
    tabelle('abdeckung-neu', [
      { titel: 'Site', wert: function (z) { return z.site; }, klasse: 'sl-nw' },
      { titel: 'im Inventar seit', wert: function (z) { return z.seitIso; }, zelle: function (z) { return datumText(z.seitIso); } },
      { titel: 'Installationen', wert: function (z) { return z.installationen; }, klasse: 'sl-num' },
      { titel: 'Welten', wert: function (z) { return liste(z.welten).map(weltText).join(', '); } }
    ], liste(ab.neu), mit({ leer: 'Keine neue Site.' }));
    tabelle('abdeckung-premium', [
      { titel: 'Site', wert: function (z) { return z.site; }, klasse: 'sl-nw' },
      { titel: 'Kunde', wert: function (z) { return kundeText(z.kunde, geladen); } },
      { titel: 'Aktion', zelle: premiumAktion }
    ], liste(ab.premiumUnbestaetigt), mit({ leer: 'Nichts zu bestätigen.' }));
    tabelle('abdeckung-ohne-mysites', [
      { titel: 'Site', wert: function (z) { return z.site; }, klasse: 'sl-nw' },
      { titel: 'Stufe', wert: function (z) { return stufeName(z.stufe); } },
      { titel: 'VIP', wert: function (z) { return z.vip ? 'VIP' : ''; } },
      { titel: 'seit', wert: function (z) { return z.seitIso; }, zelle: function (z) { return datumText(z.seitIso); } },
      { titel: 'Was', wert: function (z) { return z.text; }, zelle: function (z) { return el('span', 'sl-text', z.text); } }
    ], liste(ab.ohneMysites), mit({ leer: 'Jede Site mit Wartungsstufe steht in mySites.' }));
    tabelle('abdeckung-widersprueche', [
      { titel: 'Site', wert: function (z) { return z.site; }, klasse: 'sl-nw' },
      { titel: 'Regel', wert: function (z) { return z.typ; } },
      { titel: 'Was', wert: function (z) { return z.titel; }, zelle: wasZelle },
      { titel: 'seit', wert: function (z) { return z.seitIso; }, zelle: function (z) { return datumText(z.seitIso); } }
    ], liste(ab.widersprueche), mit({ leer: 'Keine Widersprüche.' }));
    tabelle('abdeckung-nicht-ueberwacht', [
      { titel: 'Site', wert: function (z) { return z.site; }, klasse: 'sl-nw' },
      { titel: 'Grund', wert: function (z) { return z.grund; } },
      { titel: 'seit', wert: function (z) { return z.seitIso; }, zelle: function (z) { return datumText(z.seitIso); } },
      { titel: 'durch', wert: function (z) { return z.durch; } },
      { titel: 'Durchsicht', wert: function (z) { return z.durchsichtIso || ''; }, zelle: function (z) { return z.durchsichtIso ? datumText(z.durchsichtIso) : leise('noch keine'); } },
      { titel: 'Aktion', zelle: function (z) { return ueberwachungAktionen(z.site); } }
    ], liste(s.nichtUeberwacht), mit({ leer: 'Jede Site wird überwacht.' }));
  }

  // ─── Aufräumen ───

  function aufraeumAktion(s, z) {
    var i6 = i6FuerSite(liste(s.lage), z.site);
    if (!i6) return leise('kein offener Aufräum-Eintrag');
    var ziel = 'lage:' + i6.befundId;
    var aus = laeuft(ziel);
    var box = el('div', 'sl-aktionen');
    if (z.grund === 'verschwunden') {
      box.append(knopf('aufgeräumt', function () {
        sende(auftragFuerLage(i6, 'erledigt'), ziel, 'aufgeräumt: ' + siteText(i6.site));
      }, aus));
    } else {
      var feld = datumsfeld('stumm:' + i6.befundId, inTagen(30), aus);
      box.append(feld, knopf('stumm bis', function () {
        if (!feld.value) { pflicht(feld, 'Bitte ein Datum wählen.'); return; }
        sende(auftragFuerLage(i6, 'stumm', feld.value), ziel, 'zurückgestellt bis ' + tagText(feld.value) + ': ' + siteText(i6.site));
      }, aus));
    }
    var wrap = mitRueck(box, ziel);
    if (i6.status === 'stumm') wrap.append(el('p', 'sl-rueck sl-grau', 'stumm bis ' + tagText(i6.stummBisIso)));
    return wrap;
  }
  function zeichneAufraeumen(s) {
    var alle = liste(s.aufraeumen);
    var weg = alle.filter(function (z) { return z.grund === 'verschwunden'; }).length;
    kacheln('aufraeumen-kacheln', [
      { zahl: alle.length, label: ['Kandidat zum Aufräumen', 'Kandidaten zum Aufräumen'] },
      { zahl: weg, label: 'in keiner Quelle mehr', art: 'warnung' },
      { zahl: alle.length - weg, label: 'von Sites mit Stufe intern' }
    ]);
    var q = st.rsuche.trim().toLowerCase();
    var zeilen = alle.filter(function (z) {
      return !q || [z.installation, z.site, z.welt, z.account, z.server, z.pfad, z.grund].filter(Boolean).join(' ').toLowerCase().indexOf(q) >= 0;
    });
    tabelle('aufraeumen-tabelle', [
      { titel: 'Installation', wert: function (z) { return z.installation; }, klasse: 'sl-nw' },
      { titel: 'Site', wert: function (z) { return z.site; }, klasse: 'sl-nw' },
      { titel: 'Wo', wert: function (z) { return [weltText(z.welt), z.server, z.account].filter(Boolean).join(' · '); }, klasse: 'sl-nw' },
      { titel: 'Pfad', wert: function (z) { return z.pfad || ''; }, klasse: 'sl-nb' },
      { titel: 'Grund', wert: function (z) { return z.grund === 'verschwunden' ? 'in keiner Quelle mehr' : 'Stufe intern'; } },
      { titel: 'zuletzt gesehen', wert: function (z) { return z.zuletztGesehenIso; }, zelle: function (z) { return zeitText(z.zuletztGesehenIso); }, klasse: 'sl-nw' },
      { titel: 'Aktion', zelle: function (z) { return aufraeumAktion(s, z); } }
    ], zeilen, {
      leer: q ? 'Nichts gefunden.' : 'Nichts aufzuräumen.',
      klick: function (z) { oeffneAkte(z.site); },
      gewaehlt: function (z) { return z.site === st.akte; }
    });
  }

  // ─── Wächter ───

  function zeichneWaechter(s) {
    var w = s.waechter || {};
    var zustand = waechterText(s.runde, w.quellen);
    var zeile = document.getElementById('waechter-zustand');
    zeile.textContent = zustand.text;
    zeile.className = 'sl-notiz' + (zustand.warnung ? ' sl-gelb' : '');
    tabelle('waechter-runden', [
      { titel: 'Runde', wert: function (r) { return r.id; }, klasse: 'sl-num' },
      { titel: 'gestartet', wert: function (r) { return r.gestartetIso; }, zelle: function (r) { return zeitText(r.gestartetIso); }, klasse: 'sl-nw' },
      { titel: 'beendet', wert: function (r) { return r.beendetIso; }, zelle: function (r) { return zeitText(r.beendetIso); }, klasse: 'sl-nw' },
      { titel: 'Dauer', wert: function (r) { return Date.parse(r.beendetIso) - Date.parse(r.gestartetIso); }, zelle: function (r) {
        var ms = Date.parse(r.beendetIso) - Date.parse(r.gestartetIso);
        return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 60000)) + ' Min.' : '';
      }, klasse: 'sl-num' },
      { titel: 'Sites', wert: function (r) { return r.sites; }, klasse: 'sl-num' },
      { titel: 'neue Befunde', wert: function (r) { return r.befundeNeu; }, klasse: 'sl-num' },
      { titel: 'offene Befunde', wert: function (r) { return r.befundeOffen; }, klasse: 'sl-num' },
      { titel: 'ausgefallene Quellen', wert: function (r) { return liste(r.ausgefalleneQuellen).join(', '); }, zelle: function (r) {
        var t = liste(r.ausgefalleneQuellen).join(', ');
        return t ? el('span', 'sl-gelb', t) : leise('keine');
      } }
    ], liste(w.runden), { leer: 'Noch keine Runde beendet.' });
    tabelle('waechter-quellen', [
      { titel: 'Quelle', wert: function (q) { return q.quelle; } },
      { titel: 'Zustand', wert: function (q) { return q.ok ? 1 : 0; }, zelle: function (q) { return q.ok ? pille('in Ordnung', 'sl-grau') : pille('ausgefallen', 'sl-rot'); } },
      { titel: 'Grund', wert: function (q) { return q.grund || ''; } },
      { titel: 'Dauer', wert: function (q) { return q.dauerMs; }, zelle: function (q) {
        return typeof q.dauerMs === 'number' ? (q.dauerMs / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' s' : '';
      }, klasse: 'sl-num' },
      { titel: 'Ausfälle in Folge', wert: function (q) { return q.ausfallserie; }, zelle: function (q) {
        return q.ausfallserie > 0 ? el('span', 'sl-rot', String(q.ausfallserie)) : '0';
      }, klasse: 'sl-num' }
    ], liste(w.quellen), { leer: 'Keine Quellen gemeldet.', ordnung: function (a, b) { return (a.ok ? 1 : 0) - (b.ok ? 1 : 0); } });
  }

  // ─── Akte ───

  /** Die Site der Akte zu einem Host der Lage: Sammel- und Quellenzeilen haben keine, sonst die Site der Flotte (siteFuerHost) oder der Host selbst. */
  function akteSiteFuer(host) {
    var s = stand();
    if (!s || !host || host.charAt(0) === '_') return null;
    return siteFuerHost(liste(s.flotte), host) || host;
  }
  function oeffneAkte(site) {
    if (!site) return;
    st.akte = site;
    zeichne();
    document.getElementById('akte-titel').focus();
  }
  function schliesseAkte() {
    st.akte = null;
    zeichne();
  }
  function feld(dl, name, wert) {
    var dd = el('dd');
    if (wert instanceof Node) dd.append(wert);
    else dd.textContent = wert === null || wert === undefined ? '' : String(wert);
    dl.append(el('dt', null, name), dd);
  }
  function installationKarte(z) {
    var karte = el('div', 'sl-inst');
    var kopf = el('div', 'sl-inst-kopf');
    kopf.append(ampelPille(z.ampel), el('span', null, z.id));
    if (z.verschwunden) kopf.append(pille('verschwunden', 'sl-gelb'));
    var dl = el('dl', 'sl-felder');
    feld(dl, 'Grund', z.grund || '');
    feld(dl, 'Welt', weltText(z.welt));
    feld(dl, 'Server/Projekt', serverText(z) || 'unbekannt');
    feld(dl, 'Pfad', z.pfad || 'unbekannt');
    feld(dl, 'Domains', liste(z.domains).join(', ') || 'keine');
    feld(dl, 'ausgeliefert', ausgeliefertText(z.ausgeliefert));
    feld(dl, 'CMS', [z.cms, z.version].filter(Boolean).join(' ') || 'unbekannt');
    feld(dl, 'PHP', z.php || 'unbekannt');
    feld(dl, 'mySites', mysitesText(z.mysites));
    feld(dl, 'Backup', backupText(z.backup));
    feld(dl, 'im Inventar seit', zeitText(z.erstmalsIso));
    feld(dl, 'zuletzt gesehen', zeitText(z.zuletztGesehenIso));
    feld(dl, 'offen', offenZelle(z));
    feld(dl, 'Zugang', leise('ab Teil 2'));
    feld(dl, 'Prüfung von innen', leise('ab Teil 2'));
    karte.append(kopf, dl);
    return karte;
  }
  function eintragBlock(z, eigen) {
    var box = el('div', 'sl-eintrag');
    var kopf = el('div', 'sl-inst-kopf');
    kopf.append(artPille(z), el('span', null, z.typ + ' · ' + z.titel));
    var wann = 'seit ' + datumText(z.seitIso) + ', liegt ' + liegezeitText(z.liegezeitTage) + (z.status === 'stumm' ? ', stumm bis ' + tagText(z.stummBisIso) : '');
    box.append(kopf, el('span', 'sl-text', z.text), leise(wann));
    if (eigen) box.append(urteile(z));
    else box.append(leise('Sammelalarm über ' + zahlWort(liste(z.mitglieder).length, 'Site', 'Sites') + '. Ein Urteil gilt für alle und steht in der Lage.'));
    return box;
  }
  function zeile(name) {
    var z = el('div', 'sl-form-zeile');
    z.append(el('span', 'sl-name', name));
    return z;
  }
  /** Stufe, Merker und Überwachung; jeder Auftrag geht an den Namen der Site, nicht an einen Host der Lage. */
  function einordnen(site, erste, nu, pu) {
    var form = el('div', 'sl-form');
    var aktuelle = erste ? erste.stufe : pu ? 'premium' : null;
    var quelle = erste ? erste.stufeQuelle : pu ? 'abo-text' : null;
    var bestaetigt = erste ? !!erste.bestaetigt : false;

    var zielStufe = 'site:' + site + ':stufe';
    var ausStufe = laeuft(zielStufe);
    var sel = el('select', 'sl-eingabe');
    sel.setAttribute('aria-label', 'Stufe');
    STUFEN.forEach(function (k) { var o = el('option', null, stufeName(k)); o.value = k; sel.append(o); });
    sel.value = eingabe('stufe:' + site, aktuelle || 'standard');
    sel.disabled = ausStufe;
    merke(sel, 'stufe:' + site);
    var zs = zeile('Stufe');
    zs.append(sel, knopf('setzen', function () {
      sende({ art: 'stufe', site: site, werte: { stufe: sel.value } }, zielStufe, 'Stufe ' + stufeName(sel.value) + ': ' + site);
    }, ausStufe));
    if (aktuelle && !bestaetigt && (quelle === 'abo-text' || quelle === 'mysites-tag')) {
      zs.append(knopf(stufeName(aktuelle) + ' ' + quelleText(quelle) + ' bestätigen', function () {
        sende({ art: 'stufe', site: site, werte: { stufe: aktuelle } }, zielStufe, stufeName(aktuelle) + ' bestätigen: ' + site);
      }, ausStufe));
    }
    form.append(mitRueck(zs, zielStufe));

    var zielMerker = 'site:' + site + ':merker';
    var ausMerker = laeuft(zielMerker);
    var merker = erste && erste.merker ? erste.merker : {};
    var zm = zeile('Merker');
    MERKER.forEach(function (m) {
      var an = !!merker[m[0]];
      zm.append(knopf(m[1] + (an ? ' entfernen' : ' setzen'), function () {
        var werte = {};
        werte[m[0]] = !an;
        sende({ art: 'merker', site: site, werte: werte }, zielMerker, m[1] + (an ? ' entfernen: ' : ' setzen: ') + site);
      }, ausMerker));
    });
    var zp = zeile('Pause bis');
    var pause = datumsfeld('pause:' + site, merker.pause_bis || inTagen(14), ausMerker);
    zp.append(pause, knopf('setzen', function () {
      if (!pause.value) { pflicht(pause, 'Bitte ein Datum wählen.'); return; }
      sende({ art: 'merker', site: site, werte: { pause_bis: pause.value } }, zielMerker, 'Pause bis ' + tagText(pause.value) + ': ' + site);
    }, ausMerker));
    if (merker.pause_bis) {
      zp.append(knopf('Pause entfernen', function () {
        sende({ art: 'merker', site: site, werte: { pause_bis: null } }, zielMerker, 'Pause entfernen: ' + site);
      }, ausMerker));
    }
    var merkerBox = el('div', 'sl-form');
    merkerBox.append(zm, zp);
    form.append(mitRueck(merkerBox, zielMerker));

    var zielU = 'site:' + site + ':ueberwachung';
    var ausU = laeuft(zielU);
    var zu = zeile('Überwachung');
    if (nu) {
      zu.append(
        knopf('durchgesehen', function () { sende({ art: 'durchgesehen', site: site, werte: {} }, zielU, 'Durchsicht: ' + site); }, ausU),
        knopf('zurückholen', function () { sende({ art: 'ueberwachen', site: site, werte: {} }, zielU, 'zurückholen: ' + site); }, ausU)
      );
    } else {
      var grund = el('input', 'sl-eingabe');
      grund.type = 'text';
      grund.maxLength = 500;
      grund.placeholder = 'Grund, Pflicht';
      grund.setAttribute('aria-label', 'Grund für nicht überwacht');
      grund.value = eingabe('grund:' + site, '');
      grund.disabled = ausU;
      merke(grund, 'grund:' + site);
      zu.append(grund, knopf('nicht überwachen', function () {
        var text = grund.value.trim();
        if (!text) { pflicht(grund, 'Ohne Grund geht es nicht.'); return; }
        sende({ art: 'nicht-ueberwacht', site: site, werte: { grund: text } }, zielU, 'nicht überwachen: ' + site);
      }, ausU));
    }
    form.append(mitRueck(zu, zielU));
    return form;
  }
  function zeichneAkte() {
    var box = document.getElementById('akte');
    var s = stand();
    if (st.akte === null || !s) { box.hidden = true; return; }
    box.hidden = false;
    var site = st.akte;
    var geladen = s.vertraegeGeladen;
    var flotte = liste(s.flotte);
    var ab = s.abdeckung || {};
    var inst = flotte.filter(function (z) { return z.site === site; });
    var erste = inst[0] || null;
    var nu = liste(s.nichtUeberwacht).find(function (z) { return z.site === site; }) || null;
    var pu = liste(ab.premiumUnbestaetigt).find(function (z) { return z.site === site; }) || null;
    var bekannt = erste !== null || nu !== null || pu !== null || ['neu', 'ohneMysites', 'widersprueche'].some(function (k) {
      return liste(ab[k]).some(function (z) { return z.site === site; });
    });
    document.getElementById('akte-titel').textContent = site;
    var teile = [];
    var dl = el('dl', 'sl-felder');
    if (erste) {
      var schlimmste = inst.slice().sort(function (a, b) { return ampelRang(a.ampel) - ampelRang(b.ampel); })[0];
      var ampel = el('span');
      ampel.append(ampelPille(schlimmste.ampel), ' ', schlimmste.grund || '');
      feld(dl, 'Ampel', ampel);
      feld(dl, 'Kunde', kundeText(erste.kunde, geladen));
      feld(dl, 'Vertrag', vertragText(erste.vertrag, geladen));
      feld(dl, 'Stufe', stufeText(erste.stufe, erste.stufeQuelle, erste.bestaetigt));
      feld(dl, 'Merker', merkerText(erste.merker) || 'keine');
    } else {
      feld(dl, 'Inventar', bekannt ? 'keine Installation im Inventar, nur die Einordnung' : 'gehört zu keiner Site im Inventar');
      if (pu) {
        feld(dl, 'Kunde', kundeText(pu.kunde, geladen));
        feld(dl, 'Stufe', stufeText('premium', 'abo-text', false));
      }
    }
    feld(dl, 'Überwachung', nu
      ? 'nicht überwacht seit ' + datumText(nu.seitIso) + ' (' + nu.durch + '): ' + nu.grund + '. Durchsicht: ' + (nu.durchsichtIso ? datumText(nu.durchsichtIso) : 'noch keine') + '.'
      : 'wird überwacht');
    teile.push(dl);
    if (inst.length > 0) {
      teile.push(el('h3', null, 'Installationen (' + inst.length + ')'));
      inst.forEach(function (z) { teile.push(installationKarte(z)); });
    }
    var eintraege = eintraegeDerSite(liste(s.lage), site, flotte);
    teile.push(el('h3', null, 'Offene Einträge'));
    if (eintraege.eigene.length === 0 && eintraege.sammel.length === 0) teile.push(el('p', 'sl-leer', 'Nichts offen.'));
    eintraege.eigene.forEach(function (z) { teile.push(eintragBlock(z, true)); });
    eintraege.sammel.forEach(function (z) { teile.push(eintragBlock(z, false)); });
    teile.push(el('h3', null, 'Einordnen'));
    teile.push(bekannt ? einordnen(site, erste, nu, pu) : el('p', 'sl-notiz', 'Einordnen geht nur für Sites der Flotte; diese Adresse steht in keiner Installation.'));
    teile.push(el('h3', null, 'Anfragen je Tag laut Access-Log'), leise('ab Teil 3'));
    var inhalt = document.getElementById('akte-inhalt');
    inhalt.replaceChildren.apply(inhalt, teile);
  }

  // ─── Start ───

  function zeigeSeite(id, merken) {
    st.seite = id;
    document.querySelectorAll('.sl-tab').forEach(function (t) {
      var an = t.getAttribute('data-seite') === id;
      t.setAttribute('aria-selected', String(an));
      t.tabIndex = an ? 0 : -1;
    });
    SEITEN.forEach(function (s) { document.getElementById(s).hidden = s !== id; });
    if (merken) history.replaceState(null, '', '#' + id);
  }

  function start() {
    var reiter = Array.prototype.slice.call(document.querySelectorAll('.sl-tab'));
    reiter.forEach(function (t, i) {
      t.addEventListener('click', function () { zeigeSeite(t.getAttribute('data-seite'), true); });
      t.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        var ziel = reiter[(i + (e.key === 'ArrowRight' ? 1 : reiter.length - 1)) % reiter.length];
        ziel.focus();
        zeigeSeite(ziel.getAttribute('data-seite'), true);
      });
    });
    var anfang = location.hash.slice(1);
    zeigeSeite(SEITEN.indexOf(anfang) >= 0 ? anfang : 'lage', false);
    document.getElementById('neu-laden').addEventListener('click', function () { ladeStand(); });
    document.getElementById('akte-zu').addEventListener('click', schliesseAkte);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && st.akte !== null) schliesseAkte(); });
    var suche = document.getElementById('f-suche');
    suche.addEventListener('input', function () { st.filter.suche = suche.value; if (stand()) zeichneFlotte(stand()); });
    var welt = document.getElementById('f-welt');
    welt.addEventListener('change', function () { st.filter.welt = welt.value; if (stand()) zeichneFlotte(stand()); });
    var stufe = document.getElementById('f-stufe');
    stufe.addEventListener('change', function () { st.filter.stufe = stufe.value; if (stand()) zeichneFlotte(stand()); });
    var rsuche = document.getElementById('r-suche');
    rsuche.addEventListener('input', function () { st.rsuche = rsuche.value; if (stand()) zeichneAufraeumen(stand()); });
    // Nur die Uhr der Kopfzeile, ohne Anfrage: Das Alter des Stands bleibt richtig, auch wenn der Reiter lange offen ist.
    setInterval(zeichneKopf, 60000);
    ladeStand();
  }

  start();
})();`;
}
