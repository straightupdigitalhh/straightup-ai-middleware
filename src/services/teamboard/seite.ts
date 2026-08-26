import type { BoardStand } from "./daten.js";

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
  #banner {
    display: none; margin: 0 20px; padding: 8px 12px; border-radius: 8px;
    background: var(--warn); color: #fff; font-size: 13px;
  }
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
<header><h1>Teamboard</h1><span id="stand"></span></header>
<div id="banner"></div>
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
    stand.board.lanes.forEach(function (lane) {
      var box = el("section", "lane" + (lane.timer && !lane.timer.pausiert ? " aktiv" : ""));
      var kopf = el("div", "lane-kopf");
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
      box.appendChild(kopf);
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
        stand = neu; empfangenUm = Date.now(); zeichne(); ticke();
      })
      .catch(function (fehler) {
        console.warn("teamboard: Nachladen fehlgeschlagen", fehler);
        aktualisiereKopf();
      });
  }

  zeichne();
  ticke();
  setInterval(ticke, 1000);
  setInterval(nachladen, 30000);
})();
</script>
</body>
</html>
`;
}
