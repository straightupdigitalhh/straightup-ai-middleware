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
  zeitZeile,
  projekteAusBoard,
  wendeProjektFilterAn,
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
    const html = renderSeite(stand());
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

  it("ist ein vollständiges HTML-Dokument mit Titel und Client-Skript", () => {
    const html = renderSeite(stand());
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>Teamboard</title>");
    expect(html).toContain("/api/teamboard/board"); // Nachlade-Logik ist verdrahtet
  });

  // Das eingebettete Client-Skript läuft in dieser Suite nicht (kein
  // DOM/jsdom) — die folgenden zwei Tests sind daher bewusst nur textuelle
  // Stolperdrähte gegen ein versehentliches Zurückdrehen des Fixes, kein
  // Beleg für das tatsächliche Laufzeitverhalten im Browser.
  it("ruft nach dem Nachladen ticke() direkt nach zeichne() auf (kein Uhren-Flackern)", () => {
    const html = renderSeite(stand());
    const nachladenBlock = html.split("function nachladen()")[1]?.split("\n  }")[0];
    expect(nachladenBlock).toContain("zeichne(); ticke();");
  });

  it("merkt sich Scrollposition und aufgeklappte Lanes über einen Neuaufbau hinweg", () => {
    const html = renderSeite(stand());
    expect(html).toContain("aufgeklappteLanes");
    const zeichneBlock = html.split("function zeichne()")[1]?.split("function aktualisiereKopf")[0];
    expect(zeichneBlock).toContain("wurzel.scrollLeft");
    expect(zeichneBlock).toContain("aufgeklappteLanes.has(lane.userId)");
  });

  it("kapselt den Daten-Bootstrap in try/catch mit sichtbarer Fehlermeldung statt weißer Seite (P2)", () => {
    // DOM-Verhalten selbst läuft in dieser Suite nicht (kein jsdom) — reiner
    // Text-Tripwire, dass die Absicherung im Quelltext steht.
    const html = renderSeite(stand());
    const bootstrapBlock = html.split("var stand;")[1]?.split("var empfangenUm")[0];
    expect(bootstrapBlock).toContain("try {");
    expect(bootstrapBlock).toContain("} catch (fehler) {");
    expect(bootstrapBlock).toContain("console.error(");
    expect(bootstrapBlock).toContain("document.body.textContent =");
  });

  it("rendert 'pausiert' als Chip statt als reine Textzeile (P4)", () => {
    const html = renderSeite(stand());
    expect(html).toContain('el("span", "chip pausiert-chip", "pausiert")');
  });

  it("hebt die Timer-Karte als Kopfstück der Lane ab: kräftigerer Akzent, größere Uhr, Trennlinie zur Aufgabenliste (Jans Wunsch nach der Abnahme, 26.08.2026)", () => {
    const html = renderSeite(stand());
    // Kräftigerer Akzent: linke Akzentkante zusätzlich zum bestehenden
    // flächigen Hintergrund/Rand (beide Farbschemata über die vorhandenen
    // --aktiv/--aktiv-grund-Tokens, kein neuer Token nötig).
    expect(html).toContain("border-left-width: 4px");
    // Uhr größer (Soll: 26–28 px, bisher 20px).
    expect(html).toContain("font-size: 27px");
    // Pausiert-Zustand bleibt unverändert klar gedämpft (grau, Uhr steht).
    expect(html).toContain(
      '.timer.pausiert { background: var(--pause-grund); border-color: var(--linie); }'
    );
    // Sichtbare Trennung zur Aufgabenliste darunter: dezente Trennlinie als
    // eigenes Markup-Element direkt nach der Timer-Karte.
    expect(html).toContain(".trenner {");
    expect(html).toContain('el("div", "trenner")');
  });

  it("zeigt vor dem Namen ein rundes Avatar-Bild aus der Avatar-Proxy-Route mit Initialen-Fallback bei Ladefehler (C)", () => {
    const html = renderSeite(stand());
    // same-origin — der Browser schickt die Basic-Auth-Credentials automatisch mit.
    expect(html).toContain('bild.src = "/api/teamboard/avatar/" + lane.userId');
    expect(html).toContain('bild.className = "avatar"');
    // Bei Ladefehler: img entfernen, stattdessen Initialen-Kreis per textContent.
    expect(html).toContain('addEventListener("error"');
    expect(html).toContain("initialen(lane.name)");
    expect(html).toContain("avatar-initialen");
  });

  it("hält alle Lanes exakt gleich breit: min-width: 0 gegen die flex-min-width:auto-Falle, lange Texte brechen statt zu dehnen (Folgeauftrag 2, 26.08.2026)", () => {
    const html = renderSeite(stand());
    // .lane ist Flex-Item mit fester flex-basis (300px) in #lanes; ohne
    // min-width: 0 dehnt ein langer, nicht umbrechbarer Inhalt (automatic
    // minimum size) genau die Lane, in der er vorkommt, über die Basis
    // hinaus — andere Lanes bleiben schmaler. Text-Tripwire, damit die
    // Regel nicht still wieder verschwindet.
    expect(html).toContain("flex: 0 0 300px; min-width: 0;");
    // overflow-wrap: anywhere auf den textführenden Karten-Elementen, damit
    // lange, nicht umbrechbare Wörter (Aufgabenname, wo-Zeile,
    // Timer-was/-wo) innerhalb der Lane umbrechen statt sie zu dehnen.
    expect(html).toContain('.timer .was { margin-top: 2px; font-weight: 600; overflow-wrap: anywhere; }');
    expect(html).toContain('.zeile { color: var(--gedeckt); font-size: 13px; overflow-wrap: anywhere; }');
    expect(html).toContain('.karte .name { font-weight: 600; flex: 1; overflow-wrap: anywhere; }');
  });

  it("vergrößert den Lane-Kopf: Avatar (Bild und Initialen-Kreis gleich groß) auf 36px, Name auf 17px (Folgeauftrag 2, 26.08.2026)", () => {
    const html = renderSeite(stand());
    // .avatar-initialen trägt im Markup immer zusätzlich die Klasse
    // "avatar" (el("div", "avatar avatar-initialen", ...)) — Bild und
    // Initialen-Kreis übernehmen die Größe also automatisch aus derselben
    // .avatar-Regel und bleiben dadurch zwangsläufig gleich groß.
    expect(html).toContain("width: 36px; height: 36px; border-radius: 50%;");
    expect(html).toContain(".lane-kopf h2 { margin: 0; font-size: 17px; }");
  });

  it("stoppt beim Nachladen sofort per Reload, wenn die Session abgelaufen ist (401), statt den 30-s-Poll in die Brute-Force-Bremse zählen zu lassen (Stufe 2, Task 8)", () => {
    // Text-Tripwire (kein jsdom in dieser Suite): das gerenderte HTML muss
    // sowohl den neuen API-Pfad als auch den 401-Reload-Zweig enthalten.
    const html = renderSeite(stand());
    expect(html).toContain('fetch("/api/teamboard/board"');
    const nachladenBlock = html.split("function nachladen()")[1]?.split("\n  }")[0];
    expect(nachladenBlock).toContain("res.status === 401");
    expect(nachladenBlock).toContain("location.reload();");
  });

  // Die folgenden Tests sind — wie oben bereits vermerkt — reine Text-
  // Tripwires (kein jsdom in dieser Suite), kein Beleg für das tatsächliche
  // Laufzeitverhalten im Browser.

  it("lädt nach jedem Zeichen-Zyklus (Start + 30-s-Nachladen) zusätzlich die Zeitsummen, mit derselben 401-Reload-Behandlung wie beim Board-Fetch (Task 9)", () => {
    const html = renderSeite(stand());
    expect(html).toContain('fetch("/api/teamboard/zeiten"');
    const ladeZeitenBlock = html.split("function ladeZeiten()")[1]?.split("\n  }")[0];
    expect(ladeZeitenBlock).toContain("res.status === 401");
    expect(ladeZeitenBlock).toContain("location.reload();");
    // Nach beiden zeichne()-Zyklen aufgerufen: initial und im 30-s-Nachladen.
    expect(html).toContain("zeichne(); ticke(); ladeZeiten();");
    const nachladenBlock = html.split("function nachladen()")[1]?.split("\n  }")[0];
    expect(nachladenBlock).toContain("zeichne(); ticke(); ladeZeiten();");
  });

  it("rendert die Zeitsummen-Zeile unter dem Namen nur für gelieferte IDs (Task 9)", () => {
    const html = renderSeite(stand());
    const zeichneBlock = html.split("function zeichne()")[1]?.split("function aktualisiereKopf")[0];
    expect(zeichneBlock).toContain('el("div", "zeiten", zeitZeile(');
    // Guard: nur rendern, wenn für diese userId tatsächlich Zeiten geliefert wurden.
    expect(zeichneBlock).toContain("zeitenProNutzer[lane.userId]");
  });

  it("wendet in zeichne() erst den Projekt-Filter an und zeichnet danach (Task 9)", () => {
    const html = renderSeite(stand());
    const zeichneBlock = html.split("function zeichne()")[1]?.split("function aktualisiereKopf")[0];
    const filterPos = zeichneBlock!.indexOf("wendeProjektFilterAn(");
    const forEachPos = zeichneBlock!.indexOf(".forEach(function (lane)");
    expect(filterPos).toBeGreaterThan(-1);
    expect(forEachPos).toBeGreaterThan(-1);
    expect(filterPos).toBeLessThan(forEachPos);
  });

  it("zeigt bei hinweis === 'kein_mapping' einmal im Kopfbereich den dezenten Hinweistext auf fehlendes awork-Mapping (Spec §5, Task 9)", () => {
    const html = renderSeite(stand());
    expect(html).toContain(
      "Zeiten: kein awork-Mapping hinterlegt — ein Admin kann es in der Nutzerverwaltung verknüpfen"
    );
    // Nur einmal im Dokument — kein Wiederholen pro Lane.
    const vorkommen = html.split("kein awork-Mapping hinterlegt").length - 1;
    expect(vorkommen).toBe(1);
  });

  it("baut den Projekt-Filter als <select> im Kopfbereich per createElement aus projekteAusBoard, Auswahl in Client-Variable ohne Speichern (Task 9, Spec §6)", () => {
    const html = renderSeite(stand());
    expect(html).toContain('id="projekt-filter"');
    expect(html).toContain('projekteAusBoard(stand.board)');
    expect(html).toContain('document.createElement("option")');
    // Client-Variable statt sofortigem Speichern — kein fetch(...PUT.../einstellungen) o.ä. im Filter-Codepfad.
    expect(html).toContain("var ausgewaehltesProjekt = null;");
    expect(html).not.toContain("/api/teamboard/einstellungen");
  });

  it("zeigt den aktiven Filter als Chip mit 'Filter aufheben'-Button per addEventListener, keine Inline-Handler-Attribute (Task 9)", () => {
    const html = renderSeite(stand());
    expect(html).toContain("Filter aufheben");
    expect(html).toContain('id="projekt-chip"');
    // CSP: kein onclick=... im ausgelieferten HTML.
    expect(html).not.toMatch(/\son\w+\s*=/);
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

describe("zeitZeile (P1 — Task 9)", () => {
  it("baut 'Heute H:MM · Vortag H:MM · Woche H:MM' aus den drei Zeitsummen", () => {
    expect(
      zeitZeile({ heuteSekunden: 3720, vortagSekunden: 27900, wocheSekunden: 75780 })
    ).toBe("Heute 1:02 · Vortag 7:45 · Woche 21:03");
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

describe("Client-Funktionen im gerenderten HTML eingebettet (P1)", () => {
  it("enthält die Funktionsquelltexte von uhrText, datumKurz, bannerText und initialen (Einbettung nicht verloren)", () => {
    const html = renderSeite(stand());
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

  it("enthält auch formatiereZeit, zeitZeile, projekteAusBoard und wendeProjektFilterAn (Task 9), weiterhin ohne __name(", () => {
    const html = renderSeite(stand());
    expect(html).toContain("function formatiereZeit(");
    expect(html).toContain("function zeitZeile(");
    expect(html).toContain("function projekteAusBoard(");
    expect(html).toContain("function wendeProjektFilterAn(");
    expect(html).not.toContain("__name(");
    // </script>-Zähler bleibt bei 2 (Daten-Skript + Client-Skript) — die
    // zusätzliche Einbettung darf keinen dritten Script-Block erzeugen.
    expect(html.split("</script>").length - 1).toBe(2);
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
