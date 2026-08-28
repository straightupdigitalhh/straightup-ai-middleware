import { describe, it, expect } from "vitest";
import express from "express";
import helmet from "helmet";
import request from "supertest";
import {
  renderSeite,
  uhrText,
  datumKurz,
  bannerText,
  initialen,
  formatiereZeit,
  zeitFelder,
  projekteAusBoard,
  wendeProjektFilterAn,
  wendeEinstellungenAn,
  panelFelder,
  darfErledigen,
} from "../src/services/teamboard/seite.js";
import type { BoardStand } from "../src/services/teamboard/daten.js";
import type { Board, Lane } from "../src/services/teamboard/board.js";
import { openDb } from "../src/core/db.js";
import { UserStore } from "../src/core/users.js";
import { SessionStore } from "../src/core/sessions.js";
import { createAuthRouter } from "../src/routes/auth.js";
import { createPageAuth } from "../src/services/auth.js";
import { createTeamboardPageRouter } from "../src/routes/teamboard.js";

function stand(teile?: Partial<BoardStand>): BoardStand {
  return {
    board: {
      stand: "2026-08-26T10:00:00.000Z",
      lanes: [
        {
          userId: "u-lea",
          name: "Lea Stöber",
          timer: {
            aufgabenName: "YOOtheme </script> Updates",
            aufgabenKennung: "STRI-37",
            projektName: "straightup Intern",
            sekunden: 3600,
            pausiert: false,
          },
          aufgaben: [],
        },
      ],
    },
    alterSekunden: 0,
    ...teile,
  };
}

describe("renderSeite", () => {
  it("bettet die Board-Daten als JSON ein, ohne dass '<' im Skript landet", () => {
    const html = renderSeite(stand(), null, {});
    expect(html).toContain('id="board-daten"');
    expect(html).toContain("Lea Stöber");
    // "</script>" im Aufgabennamen darf das Datenskript nicht beenden können.
    // Die beiden datenBlock-Prüfungen unten sind KEIN eigenständiger Beleg
    // dafür: split("</script>") trennt hier zufällig genau an der Stelle, an
    // der die Nutzlast selbst ihr eigenes "</script>" enthält — das einzige
    // "<" der gesamten Fixture wird dabei als Teil des Split-Trenners
    // verschluckt, bevor eine der beiden Prüfungen es zu sehen bekommt. Ohne
    // Escaping wäre datenBlock hier trotzdem "<"-frei (die erste Zeile würde
    // weiter PASSEN); nur toContain("\\u003c") schlägt dann zuverlässig fehl,
    // weil ohne Escaping nirgends die Escape-Sequenz "<" im Dokument
    // steht (ein rohes "<" stünde dort sehr wohl). Die beiden
    // Zeilen bleiben als Beleg stehen, dass der ausgelieferte Block escaped
    // ist — der tatsächliche Regressionsschutz sind die zwei html-weiten
    // Prüfungen danach, die der Split nicht entschärfen kann.
    const datenBlock = html.split('id="board-daten"')[1].split("</script>")[0];
    expect(datenBlock).not.toContain("<");
    expect(datenBlock).toContain("\\u003c");
    // Regressionsschutz 1 (split-unabhängig): die rohe Nutzlast inklusive
    // ihres eingebetteten "</script>" darf im gesamten Dokument nirgends
    // wortwörtlich auftauchen — ohne Escaping stünde sie hier unverändert.
    expect(html).not.toContain("YOOtheme </script> Updates");
    // Regressionsschutz 2 (split-unabhängig): die Zahl der literalen
    // "</script>"-Vorkommen im gesamten Dokument ist gepinnt auf die Zahl
    // der tatsächlichen schließenden Script-Tags (Daten-Skript + Client-
    // Skript = 2). Ein aus dem JSON ausgebrochenes "</script>" würde diese
    // Zahl erhöhen und den Test scheitern lassen.
    expect(html.split("</script>").length - 1).toBe(2);
  });

  it("bettet die Projekt-Stammdaten der Board-Projekte als projekte ins Seiten-JSON ein (Filterleiste)", () => {
    const html = renderSeite(stand(), null, {
      "proj-intern": { art: "straightup Projekt", status: "progress" },
    });
    expect(html).toContain('"projekte":{"proj-intern":{"art":"straightup Projekt","status":"progress"}}');
  });

  it("ist ein vollständiges HTML-Dokument mit Titel und Client-Skript", () => {
    const html = renderSeite(stand(), null, {});
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>Teamboard</title>");
    expect(html).toContain("/api/teamboard/board"); // Nachlade-Logik ist verdrahtet
  });

  // Das eingebettete Client-Skript läuft in dieser Suite nicht (kein
  // DOM/jsdom) — die folgenden zwei Tests sind daher bewusst nur textuelle
  // Stolperdrähte gegen ein versehentliches Zurückdrehen des Fixes, kein
  // Beleg für das tatsächliche Laufzeitverhalten im Browser.
  it("befüllt die Uhren in zeichne() selbst — kein leerer Zeit-Span bis zum nächsten Sekundentick (Fix-Runde)", () => {
    const html = renderSeite(stand(), null, {});
    // zeichne() baut die Zeit-Spans leer auf; erst ticke() setzt ihren Text.
    // Jeder Aufrufer, der das vergisst, lässt das größte Element der Lane
    // kurz leer blinken (10-s-Poll, /zeiten, /einstellungen, Ausblenden,
    // Drop). Deshalb ruft zeichne() ticke() selbst — als letzte Anweisung.
    const zeichneBlock = html.split("function zeichne()")[1]?.split("function aktualisiereKopf")[0];
    expect(zeichneBlock!.trimEnd().endsWith("ticke();\n  }")).toBe(true);
    // Und die dadurch doppelten Aufrufe an den Aufruforten sind weg.
    const nachladenBlock = html.split("function nachladen()")[1]?.split("\n  }")[0];
    expect(nachladenBlock).toContain("zeichne(); ladeZeiten();");
    expect(nachladenBlock).not.toContain("ticke()");
    const startBlock = html.split("document.addEventListener(\"visibilitychange\"")[1];
    expect(startBlock).toContain("zeichne();\n  ladeZeiten();\n  ladeEinstellungen();");
    // Der Sekundentakt bleibt als Taktgeber bestehen.
    expect(html).toContain("setInterval(ticke, 1000);");
  });

  it("merkt sich Scrollposition und aufgeklappte Lanes über einen Neuaufbau hinweg", () => {
    const html = renderSeite(stand(), null, {});
    expect(html).toContain("aufgeklappteLanes");
    const zeichneBlock = html.split("function zeichne()")[1]?.split("function aktualisiereKopf")[0];
    expect(zeichneBlock).toContain("wurzel.scrollLeft");
    expect(zeichneBlock).toContain("aufgeklappteLanes.has(lane.userId)");
  });

  it("kapselt den Daten-Bootstrap in try/catch mit sichtbarer Fehlermeldung statt weißer Seite (P2)", () => {
    // DOM-Verhalten selbst läuft in dieser Suite nicht (kein jsdom) — reiner
    // Text-Tripwire, dass die Absicherung im Quelltext steht.
    const html = renderSeite(stand(), null, {});
    const bootstrapBlock = html.split("var stand;")[1]?.split("var empfangenUm")[0];
    expect(bootstrapBlock).toContain("try {");
    expect(bootstrapBlock).toContain("} catch (fehler) {");
    expect(bootstrapBlock).toContain("console.error(");
    expect(bootstrapBlock).toContain("document.body.textContent =");
  });

  it("rendert 'pausiert' als Chip statt als reine Textzeile (P4)", () => {
    const html = renderSeite(stand(), null, {});
    expect(html).toContain('el("span", "chip pausiert-chip", "pausiert")');
  });

  it("hebt die Timer-Karte als eigene Bühne ab: --aktiv-grund-Fläche mit Radius 16, 30px-Uhr mit Puls-Ring, pausiert gedämpft ohne Puls (Facelift, 28.08.2026)", () => {
    const html = renderSeite(stand(), null, {});
    // Den Laufend-Zustand trägt jetzt die Timer-Karte selbst (Fläche +
    // Puls-Ring) — der frühere .lane.aktiv-Rahmen um die ganze Spalte und
    // die linke Akzentkante sind ersatzlos entfallen.
    expect(html).toContain("background: var(--aktiv-grund); border-radius: 16px;");
    expect(html).toContain("font-size: 30px");
    expect(html).toContain(".timer.pausiert { background: var(--pause-grund); }");
    expect(html).not.toContain("border-left-width: 4px");
    expect(html).not.toContain(".lane.aktiv");
    // Puls-Ring nur, solange der Timer läuft — und abschaltbar für Nutzer
    // mit reduzierter Bewegung.
    const zeichneBlock = html.split("function zeichne()")[1]?.split("function aktualisiereKopf")[0];
    expect(zeichneBlock).toContain("if (!lane.timer.pausiert) {");
    expect(zeichneBlock).toContain('el("span", "puls")');
    expect(html).toContain("@keyframes puls {");
    expect(html).toContain("@media (prefers-reduced-motion: reduce) { .puls { animation: none; } }");
    // Die Trennlinie zur Aufgabenliste entfällt: Timer und Karten sind
    // eigenständige Flächen mit Abstand (gap der Lane-Spalte).
    expect(html).not.toContain('el("div", "trenner")');
    expect(html).not.toContain(".trenner {");
  });

  it("zeigt vor dem Namen ein rundes Avatar-Bild aus der Avatar-Proxy-Route mit Initialen-Fallback bei Ladefehler (C)", () => {
    const html = renderSeite(stand(), null, {});
    // same-origin — der Browser schickt die Basic-Auth-Credentials automatisch mit.
    expect(html).toContain('bild.src = "/api/teamboard/avatar/" + lane.userId');
    expect(html).toContain('bild.className = "avatar"');
    // Bei Ladefehler: img entfernen, stattdessen Initialen-Kreis per textContent.
    expect(html).toContain('addEventListener("error"');
    expect(html).toContain("initialen(lane.name)");
    expect(html).toContain("avatar-initialen");
  });

  it("hält alle Lanes exakt gleich breit: min-width: 0 gegen die flex-min-width:auto-Falle, lange Texte brechen statt zu dehnen (Folgeauftrag 2, 26.08.2026)", () => {
    const html = renderSeite(stand(), null, {});
    // .lane ist Flex-Item mit fester flex-basis (300px) in #lanes; ohne
    // min-width: 0 dehnt ein langer, nicht umbrechbarer Inhalt (automatic
    // minimum size) genau die Lane, in der er vorkommt, über die Basis
    // hinaus — andere Lanes bleiben schmaler. Text-Tripwire, damit die
    // Regel nicht still wieder verschwindet.
    expect(html).toContain("flex: 0 0 300px; min-width: 0;");
    // Facelift: das Mockup zieht min-width: 0 zusätzlich global — die
    // Lane-Regel bleibt trotzdem stehen, sie ist der gepinnte Schutz.
    expect(html).toContain("* { box-sizing: border-box; min-width: 0; }");
    // Umbruch auf den textführenden Elementen, damit lange, nicht
    // umbrechbare Wörter (Aufgabenname, Meta-Zeilen, Timer-Aufgabe/-Meta)
    // innerhalb der Lane umbrechen statt sie zu dehnen. Selektoren im
    // Facelift umbenannt (.timer .was/.zeile/.karte .name gibt es nicht mehr).
    expect(html).toContain('.timer-aufgabe { font-size: 14px; font-weight: 600; line-height: 1.4; margin-top: 6px; overflow-wrap: break-word; }');
    expect(html).toContain('.timer-meta { font-size: 12px; color: var(--gedeckt); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }');
    expect(html).toContain('.aufgabe-titel { margin: 8px 0 0; font-size: 14px; font-weight: 600; line-height: 1.4; overflow-wrap: break-word; }');
    expect(html).toContain('gap: 6px 10px; font-size: 12px; color: var(--gedeckt); overflow-wrap: anywhere;');
    expect(html).toContain('.kopfbox .name { margin: 0; font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }');
  });

  it("fasst den Lane-Kopf als Kopfbox: Avatar (Bild und Initialen-Kreis gleich groß) auf 40px, Name 15px/600, alles auf --chip-Fläche mit Radius 12 (Facelift)", () => {
    const html = renderSeite(stand(), null, {});
    // .avatar-initialen trägt im Markup weiterhin zusätzlich die Klasse
    // "avatar" (el("div", "avatar avatar-initialen", ...)) — Bild und
    // Initialen-Kreis übernehmen die Größe also automatisch aus derselben
    // .avatar-Regel und bleiben dadurch zwangsläufig gleich groß.
    expect(html).toContain("width: 40px; height: 40px; border-radius: 50%;");
    expect(html).toContain(".kopfbox .name { margin: 0; font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }");
    expect(html).toContain("background: var(--chip); border-radius: 12px;");
    // Der frühere Kopf-Container ist weg.
    expect(html).not.toContain("lane-kopf");
  });

  it("stoppt beim Nachladen sofort per Reload, wenn die Session abgelaufen ist (401), statt den 10-s-Poll in die Brute-Force-Bremse zählen zu lassen (Stufe 2, Task 8; Takt seit Stufe 3, Task 9)", () => {
    // Text-Tripwire (kein jsdom in dieser Suite): das gerenderte HTML muss
    // sowohl den neuen API-Pfad als auch den 401-Reload-Zweig enthalten.
    const html = renderSeite(stand(), null, {});
    expect(html).toContain('fetch("/api/teamboard/board"');
    const nachladenBlock = html.split("function nachladen()")[1]?.split("\n  }")[0];
    expect(nachladenBlock).toContain("res.status === 401");
    expect(nachladenBlock).toContain("location.reload();");
  });

  it("pollt alle 10 statt 30 Sekunden nach (Stufe 3, Task 9) — Client-Takt und Server-TTL gehören zusammen, sonst holt der Client nur häufiger denselben Cache-Stand", () => {
    const html = renderSeite(stand(), null, {});
    expect(html).toContain("setInterval(nachladen, 10000);");
    expect(html).not.toContain("30000");
  });

  it("lädt bei der Rückkehr in den sichtbaren Tab sofort nach, statt bis zu 10 Sekunden auf den nächsten Poll zu warten (Stufe 3, Task 9)", () => {
    // Text-Tripwire (kein jsdom in dieser Suite): derselbe nachladen()-Pfad
    // wie das Intervall, samt seiner 401-Behandlung — kein eigener
    // Fetch-Pfad daneben.
    const html = renderSeite(stand(), null, {});
    const sichtbarkeitBlock = html.split('addEventListener("visibilitychange"')[1]?.split("});")[0];
    expect(sichtbarkeitBlock).toBeDefined();
    expect(sichtbarkeitBlock).toContain('document.visibilityState === "visible"');
    expect(sichtbarkeitBlock).toContain("nachladen()");
  });

  // Die folgenden Tests sind — wie oben bereits vermerkt — reine Text-
  // Tripwires (kein jsdom in dieser Suite), kein Beleg für das tatsächliche
  // Laufzeitverhalten im Browser.

  it("lädt nach jedem Zeichen-Zyklus (Start + 10-s-Nachladen) zusätzlich die Zeitsummen, mit derselben 401-Reload-Behandlung wie beim Board-Fetch (Task 9; Takt seit Stufe 3, Task 9)", () => {
    const html = renderSeite(stand(), null, {});
    expect(html).toContain('fetch("/api/teamboard/zeiten"');
    const ladeZeitenBlock = html.split("function ladeZeiten()")[1]?.split("\n  }")[0];
    expect(ladeZeitenBlock).toContain("res.status === 401");
    expect(ladeZeitenBlock).toContain("location.reload();");
    // Nach beiden zeichne()-Zyklen aufgerufen: initial und im 10-s-Nachladen.
    // ticke() steht seit der Fix-Runde am Ende von zeichne() selbst.
    expect(html).toContain("zeichne(); ladeZeiten();");
    const nachladenBlock = html.split("function nachladen()")[1]?.split("\n  }")[0];
    expect(nachladenBlock).toContain("zeichne(); ladeZeiten();");
  });

  it("rendert das Instrumentenbrett (HEUTE/GESTERN/WOCHE) in der Kopfbox nur für gelieferte IDs — sonst endet die Kopfbox nach der Namenszeile (Task 9, Markup aus dem Facelift)", () => {
    const html = renderSeite(stand(), null, {});
    const zeichneBlock = html.split("function zeichne()")[1]?.split("function aktualisiereKopf")[0];
    // Guard: nur rendern, wenn für diese userId tatsächlich Zeiten geliefert
    // wurden — keine leeren Felder und keine Nullen für fremde Lanes.
    expect(zeichneBlock).toContain("if (zeitenProNutzer[lane.userId]) {");
    expect(zeichneBlock).toContain('el("div", "zeitenreihe")');
    expect(zeichneBlock).toContain("zeitFelder(zeitenProNutzer[lane.userId])");
    expect(zeichneBlock).toContain('el("div", "zeit-label", f.label)');
    expect(zeichneBlock).toContain('el("div", "zeit-wert", f.wert)');
    // Die Reihe hängt IN der Kopfbox, nicht als eigenes Element daneben.
    expect(zeichneBlock).toContain("kopf.appendChild(reihe);");
    // Die alte Fließtext-Zeile unter dem Namen gibt es nicht mehr.
    expect(zeichneBlock).not.toContain('el("div", "zeiten"');
  });

  it("wendet in zeichne() erst den Projekt-Filter an und zeichnet danach (Task 9)", () => {
    const html = renderSeite(stand(), null, {});
    const zeichneBlock = html.split("function zeichne()")[1]?.split("function aktualisiereKopf")[0];
    const filterPos = zeichneBlock!.indexOf("wendeProjektFilterAn(");
    const forEachPos = zeichneBlock!.indexOf(".forEach(function (lane)");
    expect(filterPos).toBeGreaterThan(-1);
    expect(forEachPos).toBeGreaterThan(-1);
    expect(filterPos).toBeLessThan(forEachPos);
  });

  it("zeigt bei hinweis === 'kein_mapping' einmal im Kopfbereich den dezenten Hinweistext auf fehlendes awork-Mapping (Spec §5, Task 9)", () => {
    const html = renderSeite(stand(), null, {});
    expect(html).toContain(
      "Zeiten: kein awork-Mapping hinterlegt — ein Admin kann es in der Nutzerverwaltung verknüpfen"
    );
    // Nur einmal im Dokument — kein Wiederholen pro Lane.
    const vorkommen = html.split("kein awork-Mapping hinterlegt").length - 1;
    expect(vorkommen).toBe(1);
  });

  it("baut den Projekt-Filter als <select> im Kopfbereich per createElement aus projekteAusBoard, Auswahl in Client-Variable ohne Speichern (Task 9, Spec §6)", () => {
    const html = renderSeite(stand(), null, {});
    expect(html).toContain('id="projekt-filter"');
    expect(html).toContain('projekteAusBoard(stand.board)');
    expect(html).toContain('document.createElement("option")');
    // Client-Variable statt sofortigem Speichern — kein fetch(...PUT.../einstellungen) o.ä. im Filter-Codepfad.
    // (Task 10 verdrahtet /api/teamboard/einstellungen an anderer Stelle
    // fürs Drag-and-drop/Ausblenden — der Projekt-Filter-Listener selbst
    // bleibt davon unberührt, daher die Prüfung block-lokal statt global.)
    expect(html).toContain("var ausgewaehltesProjekt = null;");
    const projektFilterListenerBlock = html
      .split('document.getElementById("projekt-filter").addEventListener("change"')[1]
      ?.split("});")[0];
    expect(projektFilterListenerBlock).not.toContain("/api/teamboard/einstellungen");
  });

  it("zeigt den aktiven Filter als Chip mit 'Filter aufheben'-Button per addEventListener, keine Inline-Handler-Attribute (Task 9)", () => {
    const html = renderSeite(stand(), null, {});
    expect(html).toContain("Filter aufheben");
    expect(html).toContain('id="projekt-chip"');
    // CSP: kein onclick=... im ausgelieferten HTML.
    expect(html).not.toMatch(/\son\w+\s*=/);
  });

  // ── Task 10: Persönliche Ansicht — Drag-and-drop, Ausblenden, Mapping-UI ──
  // Wie bei Task 9: kein jsdom in dieser Suite, daher reine Text-Tripwires
  // gegen den Quelltext des eingebetteten Client-Skripts.

  it("lädt die Einstellungen beim Start per GET, mit derselben 401-Reload-Behandlung wie Board/Zeiten (Task 10)", () => {
    const html = renderSeite(stand(), null, {});
    expect(html).toContain('fetch("/api/teamboard/einstellungen"');
    const ladeEinstellungenBlock = html.split("function ladeEinstellungen()")[1]?.split("\n  }")[0];
    expect(ladeEinstellungenBlock).toContain("res.status === 401");
    expect(ladeEinstellungenBlock).toContain("location.reload();");
    // Wird beim Boot aufgerufen, nicht erst bei einer Nutzeraktion.
    expect(html).toContain("ladeEinstellungen();");
  });

  it("macht die Kopfbox per draggable=\"true\" ziehbar und verdrahtet dragstart/dragover/drop NUR per addEventListener (CSP script-src-attr 'none', Task 10; Träger seit dem Facelift die Kopfbox)", () => {
    const html = renderSeite(stand(), null, {});
    expect(html).toContain('var kopf = el("header", "kopfbox");');
    expect(html).toContain('kopf.setAttribute("draggable", "true")');
    expect(html).toContain('addEventListener("dragstart"');
    expect(html).toContain('addEventListener("dragover"');
    expect(html).toContain('addEventListener("drop"');
    // draggable ist erlaubt (kein Event-Handler-Attribut) — aber weiterhin
    // keine echten Inline-Handler-Attribute (onclick=... o.ä.) im Dokument.
    expect(html).not.toMatch(/\son\w+\s*=/);
  });

  it("speichert nach dem Drop die neue Reihenfolge per PUT und wendet sie lokal an (Task 10)", () => {
    const html = renderSeite(stand(), null, {});
    expect(html).toContain('method: "PUT"');
    const speichernBlock = html.split("function speichereEinstellungen()")[1]?.split("\n  }")[0];
    expect(speichernBlock).toContain('fetch("/api/teamboard/einstellungen"');
    expect(speichernBlock).toContain("res.status === 401");
    expect(speichernBlock).toContain("location.reload();");
    const dropBlock = html.split('addEventListener("drop"')[1]?.split("});")[0];
    expect(dropBlock).toContain("ev.preventDefault();");
  });

  it("trägt je Lane-Kopf ein Ausblenden-Steuerelement (kleines ×), das die Lane in die Ausgeblendet-Liste verschiebt (Task 10)", () => {
    const html = renderSeite(stand(), null, {});
    expect(html).toContain('el("button", "ausblenden-btn", "×")');
    expect(html).toContain("function blendeAus(");
  });

  it("baut den 'N ausgeblendet'-Chip mit einer per createElement erzeugten Liste samt 'einblenden'-Buttons (Task 10)", () => {
    const html = renderSeite(stand(), null, {});
    expect(html).toContain('id="ausgeblendet-chip"');
    expect(html).toContain('id="ausgeblendet-liste"');
    expect(html).toContain("ausgeblendet");
    expect(html).toContain('el("button", "einblenden-btn", "einblenden")');
    expect(html).toContain("function blendeEin(");
    // Kein innerHTML irgendwo im Dokument (Client-Skript baut alles per DOM-API).
    expect(html).not.toMatch(/\.innerHTML\s*=/);
  });

  it("wendet in zeichne() erst wendeEinstellungenAn und danach wendeProjektFilterAn an, bevor gezeichnet wird (Task 10)", () => {
    const html = renderSeite(stand(), null, {});
    const zeichneBlock = html.split("function zeichne()")[1]?.split("function aktualisiereKopf")[0];
    const einstellungenPos = zeichneBlock!.indexOf("wendeEinstellungenAn(");
    const filterPos = zeichneBlock!.indexOf("wendeProjektFilterAn(");
    const forEachPos = zeichneBlock!.indexOf(".forEach(function (lane)");
    expect(einstellungenPos).toBeGreaterThan(-1);
    expect(filterPos).toBeGreaterThan(-1);
    expect(forEachPos).toBeGreaterThan(-1);
    expect(einstellungenPos).toBeLessThan(filterPos);
    expect(filterPos).toBeLessThan(forEachPos);
  });

  // ── Facelift (28.08.2026): abgenommenes Design aus dem Mockup ─────────
  // Wie überall in dieser Suite reine Text-Tripwires gegen den Quelltext
  // des ausgelieferten Dokuments (kein jsdom).

  it("stellt Kopfbox, Timer und Karten als eigenständige Elemente auf --grund — die Lane hat keine eigene Umrandungs-Box mehr (Facelift)", () => {
    const html = renderSeite(stand(), null, {});
    expect(html).toContain(".lane { flex: 0 0 300px; min-width: 0; display: flex; flex-direction: column; gap: 14px; }");
    const zeichneBlock = html.split("function zeichne()")[1]?.split("function aktualisiereKopf")[0];
    expect(zeichneBlock).toContain('var box = el("section", "lane");');
    // Reihenfolge in der Spalte: Kopfbox, dann Timer, dann Kartenliste.
    const kopfPos = zeichneBlock!.indexOf("box.appendChild(kopf);");
    const timerPos = zeichneBlock!.indexOf("box.appendChild(t);");
    const listePos = zeichneBlock!.indexOf("box.appendChild(liste);");
    expect(kopfPos).toBeGreaterThan(-1);
    expect(timerPos).toBeGreaterThan(-1);
    expect(listePos).toBeGreaterThan(-1);
    expect(kopfPos).toBeLessThan(timerPos);
    expect(timerPos).toBeLessThan(listePos);
  });

  it("hängt den Karten-Wrapper nur an, wenn er Karten bekommt — leer erzeugte er über den Flex-gap 14px toten Abstand am Spaltenfuß (Fix-Runde)", () => {
    const html = renderSeite(stand(), null, {});
    const zeichneBlock = html.split("function zeichne()")[1]?.split("function aktualisiereKopf")[0];
    expect(zeichneBlock).toContain("if (lane.aufgaben.length > 0) box.appendChild(liste);");
    // Der Wrapper selbst bleibt: an ihm hängt das Aufklappen von
    // "+n weitere" und das gepinnte liste.appendChild(k).
    expect(zeichneBlock).toContain('var liste = el("div", "karten");');
    expect(zeichneBlock).toContain("liste.appendChild(k)");
    expect(zeichneBlock).toContain('liste.querySelectorAll("[hidden]")');
  });

  it("setzt die Status-Badge ÜBER den Aufgabentitel, nie daneben — der Titel bekommt die volle Breite (Facelift)", () => {
    const html = renderSeite(stand(), null, {});
    const zeichneBlock = html.split("function zeichne()")[1]?.split("function aktualisiereKopf")[0];
    const badgePos = zeichneBlock!.indexOf('"badge" + (a.statusTyp === "progress" ? " badge-progress" : "")');
    const titelPos = zeichneBlock!.indexOf('el("h3", "aufgabe-titel", a.name)');
    const metaPos = zeichneBlock!.indexOf('el("div", "aufgabe-meta")');
    expect(badgePos).toBeGreaterThan(-1);
    expect(titelPos).toBeGreaterThan(-1);
    expect(metaPos).toBeGreaterThan(-1);
    expect(badgePos).toBeLessThan(titelPos);
    expect(titelPos).toBeLessThan(metaPos);
    // Der frühere Kopf-Container mit Titel und Chip nebeneinander ist weg.
    expect(zeichneBlock).not.toContain('el("div", "kopf")');
    // Keine Emojis, keine Symbole: Prio steht als Wort in --warn.
    expect(zeichneBlock).toContain('el("span", "prio", "Prio")');
    expect(zeichneBlock).not.toContain('el("span", "prio", "!")');
    expect(html).toContain(".prio { color: var(--warn); font-weight: 600; white-space: nowrap; }");
  });

  it("zeigt die Fälligkeit als Datums-Chip MIT dem Wort 'fällig'; überfällig trägt allein die Warnfarbe (Fix-Runde)", () => {
    const html = renderSeite(stand(), null, {});
    const zeichneBlock = html.split("function zeichne()")[1]?.split("function aktualisiereKopf")[0];
    expect(zeichneBlock).toContain('"chip-datum" + (a.ueberfaellig ? " chip-warn" : "")');
    // Ohne "fällig" stünde neben "KAEF-19 · käfer Relaunch" nur ein nacktes
    // Datum, dem man nicht ansieht, wofür es steht.
    expect(zeichneBlock).toContain('"fällig " + datumKurz(a.faelligAm)');
    // Die Überfälligkeit trägt allein das Rot des Chips — wie im alten
    // Layout. Ein zusätzliches Wort im Chip wäre dasselbe Signal doppelt.
    expect(zeichneBlock).not.toContain('" · überfällig"');
    expect(html).toContain(".chip-warn { background: color-mix(in srgb, var(--warn) 12%, transparent); color: var(--warn); font-weight: 600; }");
    // Die alte, aus zwei Spans gebaute Fälligkeitsangabe gibt es nicht mehr.
    expect(zeichneBlock).not.toContain('"faellig" + (a.ueberfaellig ? " rot" : "")');
  });

  it("behält die Uhr-Attribute am Zeit-Element der neuen Timer-Karte — ticke() findet sie unverändert über [data-uhr] (Facelift)", () => {
    const html = renderSeite(stand(), null, {});
    const zeichneBlock = html.split("function zeichne()")[1]?.split("function aktualisiereKopf")[0];
    expect(zeichneBlock).toContain('var zahl = el("span", "timer-zeit", "");');
    expect(zeichneBlock).toContain('zahl.setAttribute("data-uhr", String(lane.timer.sekunden));');
    expect(zeichneBlock).toContain('zahl.setAttribute("data-pausiert", lane.timer.pausiert ? "1" : "0");');
    const tickeBlock = html.split("function ticke()")[1]?.split("\n  }")[0];
    expect(tickeBlock).toContain('querySelectorAll("[data-uhr]")');
    expect(tickeBlock).toContain('getAttribute("data-pausiert") === "1"');
  });

  it("trägt die Wortmarke im Kopfbereich (34px, currentColor) und ein data:-Favicon im Head — ohne zusätzlichen Script-Block und ohne CSP-Änderung (Facelift)", () => {
    const html = renderSeite(stand(), null, {});
    // Favicon im Kopf des Dokuments, vor <body>. Die CSP erlaubt data: für
    // Bilder bereits (index.ts, imgSrc) — daran ändert sich nichts.
    const dokumentKopf = html.split("<body>")[0];
    expect(dokumentKopf).toContain('<link rel="icon" href="data:image/png;base64,iVBORw0KGgo');
    // Logo als Inline-SVG im Kopfbereich, auf currentColor gestellt.
    expect(html).toContain('<svg class="logo" role="img" aria-label="straightup digital"');
    // Die Wortmarke färbt sich über currentColor — als Attribut an jedem
    // Pfad, NICHT über einen <style>-Block im SVG. Ein <style> in Inline-SVG
    // gilt dokumentweit, nicht SVG-lokal: ein künftig getauschtes Logo mit
    // einem Selektor wie "text { … }" oder "path { … }" träfe damit die
    // ganze Seite, und ein reiner Zähler-Pin finge genau das nicht.
    expect(html).toContain('<path fill="currentColor"');
    expect(html).not.toContain("cls-1");
    expect(html).toContain(".logo { height: 34px; width: auto; color: var(--tinte); flex: none; }");
    expect(html).toContain('<h1 class="bereich">Teamboard</h1>');
    // Der Logo-Block trägt weder einen zusätzlichen Script-Block noch
    // Inline-Handler ins Dokument. Stylesheet-Blöcke: genau EINER, der der
    // Seite — jeder weitere wirkte global (siehe oben), deshalb ist 1 der
    // richtige Sollwert und nicht bloß der zufällige Ist-Zustand.
    expect(html.split("</script>").length - 1).toBe(2);
    expect(html.split("</style>").length - 1).toBe(1);
    expect(html.split("<style").length - 1).toBe(1);
    expect(html).not.toMatch(/\son\w+\s*=/);
    expect(html).not.toContain("__name(");
    expect(html).not.toMatch(/\.innerHTML\s*=/);
  });

  // ── Task 7: Detail-Panel (Slide-in) ───────────────────────────────────
  // Wie bei Task 9/10: kein jsdom in dieser Suite, daher reine Text-
  // Tripwires gegen den Quelltext des ausgelieferten Dokuments.

  it("legt den Panel-Container als Geschwister von #lanes an, damit ihn das Leeren von #lanes in zeichne() nicht mitnimmt (Task 7)", () => {
    const html = renderSeite(stand(), null, {});
    expect(html).toContain('<div id="lanes"></div>\n<div id="panel" hidden></div>');
    const zeichneBlock = html.split("function zeichne()")[1]?.split("function aktualisiereKopf")[0];
    // Der Neuaufbau leert weiterhin nur #lanes; das Panel liegt außerhalb
    // dieses Teilbaums und wird nicht in zeichne() selbst angefasst.
    expect(zeichneBlock).toContain('wurzel.textContent = "";');
    expect(zeichneBlock).not.toContain('getElementById("panel")');
  });

  it("hält den Panel-Zustand außerhalb von zeichne() und befüllt ein offenes Panel nach jedem Neuzeichnen aus den frischen Board-Daten (Task 7)", () => {
    const html = renderSeite(stand(), null, {});
    const vorZeichne = html.split("function zeichne()")[0];
    expect(vorZeichne).toContain("var offeneAufgabeId = null;");
    const zeichneBlock = html.split("function zeichne()")[1]?.split("function aktualisiereKopf")[0];
    expect(zeichneBlock).toContain("fuellePanel();");
    const fuelleBlock = html.split("function fuellePanel()")[1]?.split("\n  }")[0];
    // Aus dem frischen Stand, nicht aus einer beim Öffnen gezogenen Kopie —
    // und Schließen, wenn die Aufgabe dort nicht mehr steht.
    expect(fuelleBlock).toContain("stand.board.lanes");
    expect(fuelleBlock).toContain("schliessePanel();");
    expect(fuelleBlock).toContain("panelFelder(");
  });

  it("bindet den Klick auf die Aufgabenkarte per addEventListener, noch bevor die Karte angehängt wird (Task 7)", () => {
    const html = renderSeite(stand(), null, {});
    const zeichneBlock = html.split("function zeichne()")[1]?.split("function aktualisiereKopf")[0];
    const klickPos = zeichneBlock!.indexOf('k.addEventListener("click"');
    const anhaengenPos = zeichneBlock!.indexOf("liste.appendChild(k)");
    expect(klickPos).toBeGreaterThan(-1);
    expect(anhaengenPos).toBeGreaterThan(-1);
    expect(klickPos).toBeLessThan(anhaengenPos);
    expect(zeichneBlock).toContain("oeffnePanel(a.id, lane.userId)");
    // CSP (script-src-attr 'none'): weiterhin keine Inline-Handler-Attribute.
    expect(html).not.toMatch(/\son\w+\s*=/);
  });

  it("schließt das Panel per Knopf und per Escape (Task 7)", () => {
    const html = renderSeite(stand(), null, {});
    expect(html).toContain('el("button", "panel-schliessen", "×")');
    expect(html).toContain("function schliessePanel()");
    const escapeBlock = html.split('document.addEventListener("keydown"')[1]?.split("});")[0];
    expect(escapeBlock).toContain('ev.key !== "Escape"');
    expect(escapeBlock).toContain("schliessePanel();");
  });

  it("lässt Escape wirkungslos, solange ein Undo-Fenster läuft — der Schließen-Knopf schließt weiterhin (M3)", () => {
    const html = renderSeite(stand(), null, {});
    const escapeBlock = html.split('document.addEventListener("keydown"')[1]?.split("});")[0];
    // Genau die Bedingung aus dem Befund: laufender Vorgang mit klickbarem
    // Rückgängig-Knopf.
    expect(escapeBlock).toContain("erledigt !== null && erledigt.vorgangId !== null");
    // Der Schließen-Knopf im Panel-Kopf ruft weiterhin ungebremst
    // schliessePanel() — nur der Reflex-Tastendruck nicht.
    const kopfBlock = html.split('el("button", "panel-schliessen", "×")')[1]?.split("panel.appendChild(kopf)")[0];
    expect(kopfBlock).toContain("schliessePanel();");
    expect(kopfBlock).not.toContain("erledigt.vorgangId");
  });

  it("dockt das Panel rechts über die volle Höhe an, über dem Board, mit Übergang beim Einfahren und voller Breite auf schmalen Schirmen — Farben nur über die vorhandenen Tokens (Task 7)", () => {
    const html = renderSeite(stand(), null, {});
    const panelCss = html.split("#panel {")[1]?.split("}")[0];
    expect(panelCss).toContain("position: fixed");
    expect(panelCss).toContain("right: 0");
    expect(panelCss).toContain("height: 100%");
    expect(panelCss).toContain("z-index:");
    expect(panelCss).toContain("transition: transform");
    expect(panelCss).toContain("background: var(--karte)");
    expect(panelCss).toContain("border-left: 1px solid var(--linie)");
    // Eingefahrener Zustand als eigene Klasse — sonst gäbe es keinen Übergang.
    expect(html).toContain("#panel.offen {");
    // Auf schmalen Schirmen volle Breite.
    expect(html).toContain("@media (max-width: 560px) { #panel { width: 100%;");
    // Keine neu erfundenen Farbwerte im Panel-CSS, nur Tokens.
    expect(panelCss).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });

  // ── Task 8: Erledigt-Knopf und Rückgängig-Fenster ─────────────────────
  // Wie bei Task 7/9/10: kein jsdom in dieser Suite, daher reine Text-
  // Tripwires gegen den Quelltext des ausgelieferten Dokuments.

  it("hängt den Betrachter (eigene awork-ID, Admin-Rolle) ins eingebettete JSON — der für alle gleiche Board-Cache trägt ihn nicht (Task 8)", () => {
    expect(renderSeite(stand(), { aworkUserId: "u-lea", istAdmin: false }, {})).toContain(
      '"betrachter":{"aworkUserId":"u-lea","istAdmin":false}'
    );
    expect(renderSeite(stand(), { aworkUserId: null, istAdmin: true }, {})).toContain(
      '"betrachter":{"aworkUserId":null,"istAdmin":true}'
    );
    // via api-key gibt es keine Nutzeridentität — dann auch keinen Knopf.
    expect(renderSeite(stand(), null, {})).toContain('"betrachter":null');
  });

  it("entscheidet den Erledigt-Knopf im Panel über darfErledigen mit dem Betrachter aus dem Stand und zeigt sonst einen Hinweistext (Task 8)", () => {
    const html = renderSeite(stand(), null, {});
    const bereich = html.split("function baueErledigenBereich(")[1]?.split("\n  }")[0];
    expect(bereich).toContain("stand.betrachter");
    expect(bereich).toContain("darfErledigen(");
    expect(bereich).toContain('"Erledigt"');
    // Ohne awork-Zuordnung (auch als Admin) und ohne Zuständigkeit steht
    // statt des Knopfes ein Hinweis — ein Knopf scheiterte dort mit 403.
    expect(bereich).toContain("awork-Mapping");
    expect(bereich).toContain("Zuständige");
    // Verdrahtung wie überall sonst: addEventListener, keine Inline-Handler
    // (CSP: script-src-attr 'none').
    expect(bereich).toContain('addEventListener("click"');
    expect(html).not.toMatch(/\son\w+\s*=/);
  });

  it("meldet den Klick an POST /erledigen, zeigt Fehler als Servertext im Panel und behandelt 401 wie der Board-Fetch (Task 8)", () => {
    const html = renderSeite(stand(), null, {});
    const block = html.split("function erledige(")[1]?.split("\n  }")[0];
    expect(block).toContain('"/api/teamboard/erledigen"');
    expect(block).toContain('method: "POST"');
    expect(block).toContain("taskId:");
    // 401 ⇒ Reload wie beim Board-Fetch, damit ein abgelaufener Login zur
    // Anmeldung führt statt zu einem stummen Fehler.
    expect(block).toContain("location.reload();");
    // Fehlertexte kommen ausschließlich aus der Antwort (message).
    expect(block).toContain("koerper.message");
  });

  it("erklärt einen Netzwerkfehler beim Erledigen im Panel und zeichnet neu, statt den Knopf stumm deaktiviert stehen zu lassen (M4)", () => {
    const html = renderSeite(stand(), null, {});
    const block = html.split("function erledige(")[1]?.split("\n  }")[0];
    const catchBlock = block?.split(".catch(function (fehler)")[1];
    expect(catchBlock).toBeDefined();
    expect(catchBlock).toContain("erledigenLaeuft = false;");
    expect(catchBlock).toContain("panelFehlerText =");
    expect(catchBlock).toContain("fuellePanel();");
  });

  it("führt den Countdown mit undoSekunden aus der Serverantwort — die 20 steht nirgends im Client (Task 8)", () => {
    const html = renderSeite(stand(), null, {});
    const erledigeBlock = html.split("function erledige(")[1]?.split("\n  }")[0];
    expect(erledigeBlock).toContain("undoSekunden");
    const tickerBlock = html.split("function tickeUndo()")[1]?.split("\n  }")[0];
    const bereich = html.split("function baueErledigenBereich(")[1]?.split("\n  }")[0];
    [erledigeBlock, tickerBlock, bereich].forEach((abschnitt) => {
      expect(abschnitt).toBeDefined();
      expect(abschnitt).not.toMatch(/\b20\b/);
    });
  });

  it("ruft mit dem Rückgängig-Knopf POST /rueckgaengig mit der vorgangId aus der Erledigen-Antwort (Task 8)", () => {
    const html = renderSeite(stand(), null, {});
    const block = html.split("function macheRueckgaengig()")[1]?.split("\n  }")[0];
    expect(block).toContain('"/api/teamboard/rueckgaengig"');
    expect(block).toContain("vorgangId");
    expect(block).toContain("location.reload();");
    expect(block).toContain("koerper.message");
    expect(html).toContain("Rückgängig");
  });

  it("hält den Erledigen-Zustand außerhalb von zeichne() und lässt das Panel im Undo-Fenster stehen, obwohl das nachgeladene Board die Aufgabe nicht mehr kennt (Task 8)", () => {
    const html = renderSeite(stand(), null, {});
    const vorZeichne = html.split("function zeichne()")[0];
    expect(vorZeichne).toContain("var erledigt = null;");
    const fuelleBlock = html.split("function fuellePanel()")[1]?.split("\n  }")[0];
    expect(fuelleBlock).toContain("erledigt.aufgabeId === offeneAufgabeId");
    expect(fuelleBlock).toContain("baueErledigenBereich(");
  });

  // ── Task 8, Fix-Runde 1 ───────────────────────────────────────────────

  it("gibt den Erledigen-Zustand beim Schließen und beim Öffnen einer anderen Aufgabe frei — er darf die Panel-Ansicht nicht überleben (Fix-Runde 1)", () => {
    const html = renderSeite(stand(), null, {});
    // Scheitert /rueckgaengig (fenster_abgelaufen, schon_rueckgaengig,
    // nicht_gewechselt), bleibt die Kartenkopie liegen: beendeUndo() wird auf
    // diesem Pfad nie erreicht. Ohne Freigabe hier fiele fuellePanel()
    // dauerhaft auf die eingefrorene Kopie zurück — das Panel schlösse nie
    // mehr und zeigte veraltete Daten.
    const schliessenBlock = html.split("function schliessePanel()")[1]?.split("\n  }")[0];
    expect(schliessenBlock).toContain("beendeUndo();");
    const oeffnenBlock = html.split("function oeffnePanel(")[1]?.split("\n  }")[0];
    expect(oeffnenBlock).toContain("erledigt.aufgabeId !== aufgabeId");
    expect(oeffnenBlock).toContain("beendeUndo();");
    // Und der Ticker baut kein fremdes Panel im Sekundentakt neu auf.
    const tickerBlock = html.split("function tickeUndo()")[1]?.split("\n  }")[0];
    expect(tickerBlock).toContain("erledigt.aufgabeId !== offeneAufgabeId");
    expect(tickerBlock).toContain("beendeUndo();");
  });

  it("zeigt für die soeben erledigte Karte nie wieder einen Erledigt-Knopf — nach Fensterablauf oder gescheitertem Undo bleibt es beim Text (Fix-Runde 1)", () => {
    const html = renderSeite(stand(), null, {});
    const bereich = html.split("function baueErledigenBereich(")[1]?.split("\n  }")[0];
    // Der frühe Ausstieg hängt an der Kartenzugehörigkeit, NICHT an der
    // vorgangId — sonst rendert der Fehlerpfad wieder einen aktiven Knopf
    // für eine bereits erledigte Aufgabe, dessen Klick erneut POSTet.
    expect(bereich).toContain("if (erledigt !== null && erledigt.aufgabeId === aufgabe.id) {");
    expect(bereich).toContain('"Als erledigt gemeldet."');
  });

  it("pinnt die Argumentreihenfolge am Aufrufort von darfErledigen — vertauschte Argumente gäben jedem zugeordneten Nutzer Admin-Rechte in der Oberfläche (Fix-Runde 1)", () => {
    const html = renderSeite(stand(), null, {});
    expect(html).toContain("darfErledigen(aufgabe, eigeneAworkId, istAdmin)");
  });

  it("sperrt den Erledigt-Knopf beim ersten Klick — ein zweiter POST bekäme laeuft_bereits und schriebe seinen Fehlertext über den laufenden Countdown (Fix-Runde 1)", () => {
    const html = renderSeite(stand(), null, {});
    const bereich = html.split("function baueErledigenBereich(")[1]?.split("\n  }")[0];
    expect(bereich).toContain("knopf.disabled = erledigenLaeuft;");
    expect(bereich).toContain("knopf.disabled = true;");
    const block = html.split("function erledige(")[1]?.split("\n  }")[0];
    expect(block).toContain("if (erledigenLaeuft) return;");
    expect(block).toContain("erledigenLaeuft = true;");
    expect(block).toContain("erledigenLaeuft = false;");
  });

  it("sperrt den Rückgängig-Knopf beim ersten Klick — dasselbe Flag-Muster wie beim Erledigt-Knopf (Ledger)", () => {
    const html = renderSeite(stand(), null, {});
    const bereich = html.split("function baueErledigenBereich(")[1]?.split("\n  }")[0];
    expect(bereich).toContain("zurueck.disabled = rueckgaengigLaeuft;");
    expect(bereich).toContain("zurueck.disabled = true;");
    const block = html.split("function macheRueckgaengig()")[1]?.split("\n  }")[0];
    expect(block).toContain("if (rueckgaengigLaeuft) return;");
    expect(block).toContain("rueckgaengigLaeuft = true;");
    expect(block).toContain("rueckgaengigLaeuft = false;");
    // Der Fehlerzweig darf den Vorgang nicht blind dereferenzieren: ein
    // Schließen des Panels währenddessen hat ihn womöglich genullt.
    expect(block).toContain("if (erledigt !== null) erledigt.vorgangId = null;");
  });

  it("startet den Undo-Countdown eine Sekunde unter undoSekunden — die Roundtrip-Zeit ist bei Antworteingang schon vergangen (Ledger)", () => {
    const html = renderSeite(stand(), null, {});
    const block = html.split("function erledige(")[1]?.split("\n  }")[0];
    expect(block).toContain("restSekunden: antwort.koerper.undoSekunden - 1,");
  });
});

describe("uhrText (P1 — reine Funktion, die auch im Client-Skript läuft)", () => {
  it("formatiert h:mm:ss an den Grenzen (0s, 59s, 60s, 3599s, 3600s)", () => {
    expect(uhrText(0)).toBe("0:00:00");
    expect(uhrText(59)).toBe("0:00:59");
    expect(uhrText(60)).toBe("0:01:00");
    expect(uhrText(3599)).toBe("0:59:59");
    expect(uhrText(3600)).toBe("1:00:00");
  });

  it("liefert eine leere Zeichenkette statt 'NaN:NaN:NaN' bei ungültiger Eingabe", () => {
    expect(uhrText(NaN)).toBe("");
  });
});

describe("datumKurz (P1)", () => {
  it("formatiert ein ISO-Datum als TT.MM. in UTC", () => {
    expect(datumKurz("2026-08-26T10:00:00.000Z")).toBe("26.08.");
  });

  it("liefert eine leere Zeichenkette statt 'NaN.NaN.' bei ungültigem Datum", () => {
    expect(datumKurz("kein-datum")).toBe("");
  });
});

describe("bannerText (P1)", () => {
  it("zeigt erst ab einem Alter über 120 Sekunden einen Banner-Text (Schwelle > 120)", () => {
    expect(bannerText(119)).toBeNull();
    expect(bannerText(120)).toBeNull();
    expect(bannerText(121)).toBe("awork nicht erreichbar — Stand: vor 2 Minuten");
  });

  it("liefert keinen Banner statt eines 'NaN Minuten'-Textes bei ungültiger Eingabe", () => {
    expect(bannerText(NaN)).toBeNull();
  });
});

describe("initialen (P1 — Avatar-Fallback bei Ladefehler)", () => {
  it("nimmt den ersten Buchstaben von Vor- und Nachname", () => {
    expect(initialen("Lea Stöber")).toBe("LS");
    expect(initialen("Jan Lehnhoff")).toBe("JL");
  });

  it("nimmt bei nur einem Namensteil dessen ersten Buchstaben (z. B. 'Gabi' ohne Nachname)", () => {
    expect(initialen("Gabi")).toBe("G");
  });

  it("ignoriert mittlere Namensteile (erster + letzter Teil)", () => {
    expect(initialen("Jan Peter Lehnhoff")).toBe("JL");
  });

  it("liefert eine leere Zeichenkette bei leerem oder nur aus Leerraum bestehendem Namen", () => {
    expect(initialen("")).toBe("");
    expect(initialen("   ")).toBe("");
  });
});

describe("formatiereZeit (P1 — H:MM ohne Sekunden, für die Zeitsummen-Zeile, Task 9)", () => {
  it("formatiert H:MM an den Grenzen (0s, 59s, 60s, 3599s, 3600s, 3720s)", () => {
    expect(formatiereZeit(0)).toBe("0:00");
    expect(formatiereZeit(59)).toBe("0:00");
    expect(formatiereZeit(60)).toBe("0:01");
    expect(formatiereZeit(3599)).toBe("0:59");
    expect(formatiereZeit(3600)).toBe("1:00");
    expect(formatiereZeit(3720)).toBe("1:02");
  });

  it("liefert eine leere Zeichenkette statt 'NaN:NaN' bei ungültiger oder negativer Eingabe", () => {
    expect(formatiereZeit(NaN)).toBe("");
    expect(formatiereZeit(-1)).toBe("");
  });
});

describe("zeitFelder (P1 — Instrumentenbrett der Kopfbox, Task 9 / Facelift)", () => {
  it("liefert HEUTE/GESTERN/WOCHE als drei beschriftete Felder mit H:MM-Werten", () => {
    expect(
      zeitFelder({ heuteSekunden: 3720, vortagSekunden: 27900, wocheSekunden: 75780 })
    ).toEqual([
      { label: "HEUTE", wert: "1:02" },
      { label: "GESTERN", wert: "7:45" },
      { label: "WOCHE", wert: "21:03" },
    ]);
  });

  it("reicht die Grenzfälle von formatiereZeit durch (leerer Wert statt 'NaN:NaN')", () => {
    expect(
      zeitFelder({ heuteSekunden: NaN, vortagSekunden: -1, wocheSekunden: 0 })
    ).toEqual([
      { label: "HEUTE", wert: "" },
      { label: "GESTERN", wert: "" },
      { label: "WOCHE", wert: "0:00" },
    ]);
  });
});

// ─── Fixtures für projekteAusBoard/wendeProjektFilterAn (Task 9) ───────────

function aufgabeKarte(teile: Partial<Lane["aufgaben"][number]>): Lane["aufgaben"][number] {
  return {
    id: "a-1",
    name: "Aufgabe",
    kennung: null,
    projektName: null,
    projektId: null,
    statusName: "Offen",
    statusTyp: "todo",
    faelligAm: null,
    istPrio: false,
    istWiederkehrend: false,
    arbeitsart: null,
    assigneeIds: [],
    ueberfaellig: false,
    ...teile,
  };
}

function timerKarte(teile: Partial<NonNullable<Lane["timer"]>>): NonNullable<Lane["timer"]> {
  return {
    aufgabenName: "Timer-Aufgabe",
    aufgabenKennung: null,
    projektName: null,
    projektId: null,
    sekunden: 60,
    pausiert: false,
    ...teile,
  };
}

describe("projekteAusBoard (P1 — Projekt-Filter-Liste, Task 9)", () => {
  it("sammelt distinct Projekte aus Timern und Aufgaben, alphabetisch sortiert", () => {
    const board: Board = {
      stand: "2026-08-26T10:00:00.000Z",
      lanes: [
        {
          userId: "u-1",
          name: "A",
          timer: timerKarte({ projektId: "p-zwo", projektName: "Zweites Projekt" }),
          aufgaben: [aufgabeKarte({ id: "a-1", projektId: "p-eins", projektName: "Erstes Projekt" })],
        },
        {
          userId: "u-2",
          name: "B",
          timer: null,
          aufgaben: [
            // Dasselbe Projekt wie oben — muss dedupliziert werden.
            aufgabeKarte({ id: "a-2", projektId: "p-eins", projektName: "Erstes Projekt" }),
            // Ohne Projekt — darf nicht in der Liste landen.
            aufgabeKarte({ id: "a-3", projektId: null, projektName: null }),
          ],
        },
      ],
    };
    expect(projekteAusBoard(board)).toEqual([
      { id: "p-eins", name: "Erstes Projekt" },
      { id: "p-zwo", name: "Zweites Projekt" },
    ]);
  });

  it("liefert eine leere Liste ohne Projekte im Board", () => {
    const board: Board = { stand: "2026-08-26T10:00:00.000Z", lanes: [] };
    expect(projekteAusBoard(board)).toEqual([]);
  });
});

describe("wendeProjektFilterAn (P1 — Projekt-Filter auf die Lanes, Task 9)", () => {
  it("liefert die Lanes unverändert (dieselbe Referenz), wenn kein Projekt gewählt ist (null)", () => {
    const lanes: Lane[] = [{ userId: "u-1", name: "A", timer: null, aufgaben: [] }];
    expect(wendeProjektFilterAn(lanes, null)).toBe(lanes);
  });

  it("Lane mit fremdem Timer + passender Aufgabe bleibt mit timer: null", () => {
    const lanes: Lane[] = [
      {
        userId: "u-1",
        name: "A",
        timer: timerKarte({ projektId: "p-fremd" }),
        aufgaben: [
          aufgabeKarte({ id: "a-1", projektId: "p-ziel" }),
          aufgabeKarte({ id: "a-2", projektId: "p-fremd" }),
        ],
      },
    ];
    const ergebnis = wendeProjektFilterAn(lanes, "p-ziel");
    expect(ergebnis).toHaveLength(1);
    expect(ergebnis[0].timer).toBeNull();
    expect(ergebnis[0].aufgaben).toEqual([aufgabeKarte({ id: "a-1", projektId: "p-ziel" })]);
  });

  it("behält die Timer-Karte, wenn deren eigenes Projekt zum Filter passt", () => {
    const lanes: Lane[] = [
      { userId: "u-1", name: "A", timer: timerKarte({ projektId: "p-ziel" }), aufgaben: [] },
    ];
    const ergebnis = wendeProjektFilterAn(lanes, "p-ziel");
    expect(ergebnis).toHaveLength(1);
    expect(ergebnis[0].timer).not.toBeNull();
    expect(ergebnis[0].timer?.projektId).toBe("p-ziel");
  });

  it("lässt eine Lane ohne Treffer (weder Timer noch Aufgabe im Projekt) komplett raus", () => {
    const lanes: Lane[] = [
      {
        userId: "u-1",
        name: "A",
        timer: timerKarte({ projektId: "p-fremd" }),
        aufgaben: [aufgabeKarte({ id: "a-1", projektId: "p-fremd" })],
      },
      { userId: "u-2", name: "B", timer: null, aufgaben: [] },
    ];
    expect(wendeProjektFilterAn(lanes, "p-ziel")).toEqual([]);
  });
});

function lane(teile: Partial<Lane>): Lane {
  return { userId: "u-x", name: "X", timer: null, aufgaben: [], ...teile };
}

describe("wendeEinstellungenAn (P1 — Reihenfolge/Ausblenden der Lanes, Task 10)", () => {
  it("Default: reihenfolge null ⇒ alphabetische Bestandsreihenfolge, keine ausgeblendeten Lanes", () => {
    const lanes = [lane({ userId: "u-2", name: "Zora" }), lane({ userId: "u-1", name: "Anna" })];
    const ergebnis = wendeEinstellungenAn(lanes, { reihenfolge: null, ausgeblendet: [] });
    expect(ergebnis.sichtbar.map((l) => l.userId)).toEqual(["u-1", "u-2"]);
    expect(ergebnis.ausgeblendet).toEqual([]);
  });

  it("Teil-Reihenfolge: die gelisteten IDs bestimmen die Reihenfolge der ersten Lanes", () => {
    const lanes = [
      lane({ userId: "u-1", name: "Anna" }),
      lane({ userId: "u-2", name: "Bea" }),
      lane({ userId: "u-3", name: "Cora" }),
    ];
    const ergebnis = wendeEinstellungenAn(lanes, { reihenfolge: ["u-3", "u-1"], ausgeblendet: [] });
    // u-3 und u-1 in der vorgegebenen Reihenfolge zuerst, u-2 (ohne Eintrag) alphabetisch dahinter.
    expect(ergebnis.sichtbar.map((l) => l.userId)).toEqual(["u-3", "u-1", "u-2"]);
  });

  it("unbekannte IDs in der Reihenfolge werden ignoriert (keine Platzhalter, keine Fehler)", () => {
    const lanes = [lane({ userId: "u-1", name: "Anna" }), lane({ userId: "u-2", name: "Bea" })];
    const ergebnis = wendeEinstellungenAn(lanes, {
      reihenfolge: ["u-nicht-mehr-da", "u-2", "u-auch-unbekannt"],
      ausgeblendet: [],
    });
    expect(ergebnis.sichtbar.map((l) => l.userId)).toEqual(["u-2", "u-1"]);
  });

  it("neue Nutzer ohne Eintrag in der Reihenfolge landen hinten, alphabetisch sortiert", () => {
    const lanes = [
      lane({ userId: "u-1", name: "Anna" }),
      lane({ userId: "u-2", name: "Zora" }),
      lane({ userId: "u-3", name: "Mona" }),
    ];
    const ergebnis = wendeEinstellungenAn(lanes, { reihenfolge: ["u-1"], ausgeblendet: [] });
    // u-1 zuerst (Eintrag), dann die beiden ohne Eintrag alphabetisch: Mona vor Zora.
    expect(ergebnis.sichtbar.map((l) => l.userId)).toEqual(["u-1", "u-3", "u-2"]);
  });

  it("ausgeblendete Lanes fehlen in 'sichtbar', kommen aber vollständig in 'ausgeblendet' zurück (für den Chip)", () => {
    const lanes = [
      lane({ userId: "u-1", name: "Anna" }),
      lane({ userId: "u-2", name: "Bea" }),
      lane({ userId: "u-3", name: "Cora" }),
    ];
    const ergebnis = wendeEinstellungenAn(lanes, { reihenfolge: null, ausgeblendet: ["u-2"] });
    expect(ergebnis.sichtbar.map((l) => l.userId)).toEqual(["u-1", "u-3"]);
    expect(ergebnis.ausgeblendet.map((l) => l.userId)).toEqual(["u-2"]);
  });

  it("eine in der Reihenfolge genannte, aber ausgeblendete ID taucht nirgends in 'sichtbar' auf", () => {
    const lanes = [lane({ userId: "u-1", name: "Anna" }), lane({ userId: "u-2", name: "Bea" })];
    const ergebnis = wendeEinstellungenAn(lanes, { reihenfolge: ["u-2", "u-1"], ausgeblendet: ["u-2"] });
    expect(ergebnis.sichtbar.map((l) => l.userId)).toEqual(["u-1"]);
    expect(ergebnis.ausgeblendet.map((l) => l.userId)).toEqual(["u-2"]);
  });

  it("keine Lanes ⇒ beide Listen leer", () => {
    const ergebnis = wendeEinstellungenAn([], { reihenfolge: null, ausgeblendet: [] });
    expect(ergebnis.sichtbar).toEqual([]);
    expect(ergebnis.ausgeblendet).toEqual([]);
  });
});

describe("panelFelder (P1 — die sechs Zeilen des Detail-Panels, Task 7)", () => {
  it("liefert die sechs Zeilen in fester Reihenfolge mit allen Werten", () => {
    const felder = panelFelder(
      aufgabeKarte({
        id: "a-1",
        name: "YOOtheme aktualisieren",
        kennung: "STRI-37",
        projektName: "straightup Intern",
        statusName: "In Bearbeitung",
        statusTyp: "progress",
        faelligAm: "2026-08-26T00:00:00.000Z",
        istPrio: true,
      }),
      "Lea Stöber"
    );
    expect(felder).toEqual([
      { label: "Zuständig", wert: "Lea Stöber" },
      { label: "Projekt", wert: "straightup Intern" },
      { label: "Status", wert: "In Bearbeitung" },
      { label: "Fällig", wert: "26.08." },
      { label: "Kennung", wert: "STRI-37" },
      { label: "Priorität", wert: "ja" },
    ]);
  });

  it("ersetzt leere und null-Werte durch '—' und liefert nirgends undefined", () => {
    const felder = panelFelder(
      aufgabeKarte({
        kennung: null,
        projektName: null,
        statusName: "",
        faelligAm: null,
        istPrio: false,
      }),
      ""
    );
    expect(felder.map((f) => f.label)).toEqual([
      "Zuständig",
      "Projekt",
      "Status",
      "Fällig",
      "Kennung",
      "Priorität",
    ]);
    expect(felder.map((f) => f.wert)).toEqual(["—", "—", "—", "—", "—", "—"]);
    felder.forEach((f) => {
      expect(f.wert).toBeTypeOf("string");
      expect(f.wert.length).toBeGreaterThan(0);
    });
  });

  it("fällt bei unlesbarem Fälligkeitsdatum auf '—' zurück statt auf den Leerstring aus datumKurz", () => {
    const felder = panelFelder(aufgabeKarte({ faelligAm: "kein-datum" }), "Lea Stöber");
    expect(felder[3]).toEqual({ label: "Fällig", wert: "—" });
  });
});

describe("darfErledigen (P1 — wer den Erledigt-Knopf sieht, Task 8)", () => {
  it("eigene Aufgabe (eigene awork-ID unter den Zuständigen) ⇒ true", () => {
    expect(darfErledigen({ assigneeIds: ["u-lea"] }, "u-lea", false)).toBe(true);
  });

  it("fremde Aufgabe als Member ⇒ false", () => {
    expect(darfErledigen({ assigneeIds: ["u-max"] }, "u-lea", false)).toBe(false);
  });

  it("fremde Aufgabe als Admin ⇒ true", () => {
    expect(darfErledigen({ assigneeIds: ["u-max"] }, "u-jan", true)).toBe(true);
  });

  it("Admin OHNE awork-Zuordnung ⇒ false — die Reihenfolge zählt: ohne eigene ID könnte der Server den Zurechnungskommentar nicht schreiben, der Knopf scheiterte garantiert mit 403", () => {
    expect(darfErledigen({ assigneeIds: ["u-max"] }, null, true)).toBe(false);
    expect(darfErledigen({ assigneeIds: [] }, null, true)).toBe(false);
  });

  it("Member ohne awork-Zuordnung ⇒ false", () => {
    expect(darfErledigen({ assigneeIds: ["u-lea"] }, null, false)).toBe(false);
  });

  it("Aufgabe mit zwei Zuständigen: auch der zweite darf ⇒ true", () => {
    expect(darfErledigen({ assigneeIds: ["u-max", "u-lea"] }, "u-lea", false)).toBe(true);
  });

  it("Aufgabe ganz ohne Zuständige ⇒ false für einen Member", () => {
    expect(darfErledigen({ assigneeIds: [] }, "u-lea", false)).toBe(false);
  });
});

describe("Client-Funktionen im gerenderten HTML eingebettet (P1)", () => {
  it("enthält die Funktionsquelltexte von uhrText, datumKurz, bannerText und initialen (Einbettung nicht verloren)", () => {
    const html = renderSeite(stand(), null, {});
    expect(html).toContain("function uhrText(");
    expect(html).toContain("function datumKurz(");
    expect(html).toContain("function bannerText(");
    expect(html).toContain("function initialen(");
    // Tripwire gegen die esbuild-Falle aus dem P1-Fund: verschachtelte
    // benannte Helferfunktionen in uhrText/datumKurz/bannerText/initialen
    // würden esbuilds keepNames-Transform (tsx) einen Aufruf __name(...)
    // einbauen — eine Referenz, die es im Browser nicht gibt (ReferenceError
    // beim ersten Aufruf). Heute schützt nur der Kommentar in seite.ts
    // davor; dieser Test schlägt an, falls das wieder eingeführt wird.
    expect(html).not.toContain("__name(");
  });

  it("enthält auch formatiereZeit, zeitFelder, projekteAusBoard und wendeProjektFilterAn (Task 9, zeitFelder seit dem Facelift), weiterhin ohne __name(", () => {
    const html = renderSeite(stand(), null, {});
    expect(html).toContain("function formatiereZeit(");
    expect(html).toContain("function zeitFelder(");
    // zeitZeile ist im Facelift durch zeitFelder ersetzt — die
    // Fließtext-Variante darf nicht als Leiche im Client-Skript bleiben.
    expect(html).not.toContain("function zeitZeile(");
    expect(html).toContain("function projekteAusBoard(");
    expect(html).toContain("function wendeProjektFilterAn(");
    expect(html).not.toContain("__name(");
    // </script>-Zähler bleibt bei 2 (Daten-Skript + Client-Skript) — die
    // zusätzliche Einbettung darf keinen dritten Script-Block erzeugen.
    expect(html.split("</script>").length - 1).toBe(2);
  });

  it("enthält auch wendeEinstellungenAn (Task 10), weiterhin ohne __name( und ohne dritten Script-Block", () => {
    const html = renderSeite(stand(), null, {});
    expect(html).toContain("function wendeEinstellungenAn(");
    expect(html).not.toContain("__name(");
    expect(html.split("</script>").length - 1).toBe(2);
  });

  it("enthält auch panelFelder (Task 7) — ohne die Einbettung gäbe es die Funktion im Browser gar nicht, weiterhin ohne __name(, ohne dritten Script-Block und ohne innerHTML", () => {
    const html = renderSeite(stand(), null, {});
    expect(html).toContain("function panelFelder(");
    expect(html).not.toContain("__name(");
    expect(html.split("</script>").length - 1).toBe(2);
    expect(html).not.toMatch(/\.innerHTML\s*=/);
  });

  it("enthält auch darfErledigen (Task 8) — ohne die Einbettung gäbe es die Funktion im Browser gar nicht, weiterhin ohne __name(, ohne dritten Script-Block und ohne innerHTML", () => {
    const html = renderSeite(stand(), null, {});
    expect(html).toContain("function darfErledigen(");
    expect(html).not.toContain("__name(");
    expect(html.split("</script>").length - 1).toBe(2);
    expect(html).not.toMatch(/\.innerHTML\s*=/);
  });
});

// ─── Wiring (Muster C): /teamboard im echten App-Aufbau ────────────
//
// Aus Task 7 hierher verschoben (Task-7-Report: "Fall (e) ... kommt in
// Task 8"). Baut die Middleware-Kette wie src/index.ts sie zusammensteckt
// (helmet mit derselben CSP-Konfiguration, SPA-Catchall unter /app, dann
// erst der Page-Router OHNE Pfad-Präfix) — ohne echten Hub-Build und ohne
// den echten src/index.ts-Modul-Einstiegspunkt zu importieren (der hat
// Seiteneffekte: liest Pflicht-Env-Vars, öffnet die echte DB-Datei, startet
// den Server).
//
// Fix-Runde 1 (Task 8): der Guard (createPageAuth) wird dem Page-Router als
// Route-Middleware übergeben (deps.pageAuth) statt global vorgeschaltet zu
// werden — ein globales app.use(createPageAuth(...), router) hätte JEDE
// unauthentifizierte Anfrage auf jeden bis dahin unverarbeiteten Pfad mit
// 302 statt dem JSON-404 beantwortet (siehe die beiden "/gibtsnicht"-Tests
// unten). req.path bleibt für den Guard trotzdem "/teamboard", weil der
// Router selbst ohne Pfad-Präfix gemountet wird.

async function loginCookie(app: express.Express, email: string, password: string): Promise<string> {
  const res = await request(app).post("/auth/login").send({ email, password });
  expect(res.status).toBe(200);
  const setCookie = res.headers["set-cookie"];
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  return cookies[0].split(";")[0];
}

function makeRealApp() {
  const db = openDb(":memory:");
  const users = new UserStore(db);
  const sessions = new SessionStore(db, users);
  const boardStandFixture: BoardStand = {
    board: { stand: "2026-08-26T10:00:00.000Z", lanes: [] },
    alterSekunden: 0,
  };

  const app = express();
  // Dieselbe CSP-Konfiguration wie src/index.ts (Zeile ~147-158).
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
    })
  );
  app.use(express.json());
  app.use(createAuthRouter({ users, sessions }));
  // SPA-Catchall wie in index.ts (ohne gebauten Hub im Test) — /teamboard
  // matcht dieses Muster nicht und darf davon nicht verschluckt werden.
  app.get(/^\/app(\/.*)?$/, (_req, res) => {
    res.status(503).send("Hub-Frontend nicht gebaut (SPA-Catchall-Stub)");
  });
  // Reihenfolge wie in src/index.ts: nach helmet, vor dem 404-Handler,
  // NICHT unter /app. Ohne Pfad-Präfix, damit createPageAuth req.path
  // unverändert sieht — der Guard läuft aber NUR auf GET /teamboard
  // (deps.pageAuth als Route-Middleware), nicht app-weit.
  app.use(createTeamboardPageRouter({
    ladeBoard: async () => boardStandFixture,
    ladeProjekte: async () => ({}),
    renderSeite,
    pageAuth: createPageAuth(sessions, "/app/"),
  }));
  app.use((_req, res) => {
    res.status(404).json({ error: "Endpoint nicht gefunden" });
  });

  const member = users.create({
    email: "team@straightup-digital.de",
    name: "Team",
    role: "member",
    password: "member-pass-123",
  });
  // awork-Zuordnung, damit der eingebettete Betrachter unterscheidbar ist.
  users.setAworkUserId(member.id, "u-lea");
  return { app, member };
}

describe("Wiring (Muster C): /teamboard im echten App-Aufbau", () => {
  it("ist erreichbar und liefert die echte gerenderte Seite, nicht den SPA-Catchall-Stub", async () => {
    const { app, member } = makeRealApp();
    const cookie = await loginCookie(app, member.email, "member-pass-123");
    const res = await request(app).get("/teamboard").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("<title>Teamboard</title>");
    expect(res.text).not.toContain("SPA-Catchall-Stub");
  });

  it("bettet den Betrachter des Aufrufers in die ausgelieferte Seite ein — nicht nur in die /board-Antwort (Task 8, Fix-Runde 1)", async () => {
    const { app, member } = makeRealApp();
    const cookie = await loginCookie(app, member.email, "member-pass-123");
    const res = await request(app).get("/teamboard").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain('"betrachter":{"aworkUserId":"u-lea","istAdmin":false}');
  });

  it("trägt den CSP-Header von helmet (auch für /teamboard, kein Pfad-Ausschluss)", async () => {
    const { app, member } = makeRealApp();
    const cookie = await loginCookie(app, member.email, "member-pass-123");
    const res = await request(app).get("/teamboard").set("Cookie", cookie);
    expect(res.headers["content-security-policy"]).toBeDefined();
    expect(res.headers["content-security-policy"]).toContain("script-src 'self' 'unsafe-inline'");
  });

  it("ohne Session ⇒ 302 auf /app/?next=%2Fteamboard (Guard greift auch im vollen App-Aufbau)", async () => {
    const { app } = makeRealApp();
    const res = await request(app).get("/teamboard");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/app/?next=%2Fteamboard");
  });

  // Fix-Runde 1 (Task 8): der Guard darf NUR auf GET /teamboard greifen,
  // nicht app-weit. Ein unbekannter Pfad ohne Session muss weiterhin den
  // normalen JSON-404 bekommen statt vom Page-Guard mit 302 abgefangen zu
  // werden (RED gegen den unscoped Mount, GREEN gegen den Route-Middleware-
  // Fix in routes/teamboard.ts + index.ts).
  it("unauth GET /gibtsnicht ⇒ 404 (JSON-404 der App, NICHT vom Page-Guard abgefangen)", async () => {
    const { app } = makeRealApp();
    const res = await request(app).get("/gibtsnicht");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Endpoint nicht gefunden" });
  });

  it("unauth POST /gibtsnicht ⇒ 404 (auch für andere HTTP-Methoden auf unbekannte Pfade)", async () => {
    const { app } = makeRealApp();
    const res = await request(app).post("/gibtsnicht");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Endpoint nicht gefunden" });
  });
});
