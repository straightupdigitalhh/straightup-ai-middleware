# Design-Spec: design-generate Skill

**Datum:** 2026-04-13
**Status:** Genehmigt

## Zweck

Generiert komplette YOOtheme-Pro-Websites im Stil einer analysierten Designerin — basierend auf der Design-Wissensdatenbank (`~/design-knowledge/`). Gibt `styles.json` + Builder-Layouts (JSON) für alle Seiten aus.

## Nutzer

- **Jetzt:** Jan (technisch versiert, steuert den Prozess)
- **Später:** Lara (Designerin, deren Stil analysiert wurde — beurteilt und korrigiert Ergebnisse), Julia (zweite Designerin, eigene Wissensdatenbank geplant)

## Abhängigkeiten

- **Design-Wissensdatenbank** (`~/design-knowledge/`) — muss existieren mit STYLE-PROFILE.md, patterns/, yootheme-blueprints/
- **yootheme-pro Skill** — wird intern referenziert für technisches Wissen (JSON-Struktur, Element-Props). Nicht automatisch aufgerufen — der design-generate Skill nutzt das Wissen direkt.

## Workflow

### Phase 1: Briefing (interaktiv)

Eine Frage nach der anderen. Pflicht-Themen:

1. **Kunde & Branche** — Wer ist der Kunde? Was machen die?
2. **Zielgruppe** — Wen soll die Website ansprechen?
3. **Vorhandene Assets** — Logo vorhanden? CI-Farben? Schriften vorgegeben?
4. **Seitenstruktur** — Welche Seiten werden gebraucht? (Home, Über uns, Leistungen, Kontakt, ...)
5. **Inhalte** — Echte Texte/Bilder vorhanden, oder Platzhalter?
6. **Besonderheiten** — Spezielle Anforderungen? (Mehrsprachig, Blog, Stellenangebote, ...)
7. **Stimmung/Tonalität** — Seriös, modern, warm, technisch, ...?
8. **Referenzprojekte** — Gibt es analysierte Websites aus der DB die als Vorbild dienen sollen?

Budget-Level (Standard/Premium) ergibt sich organisch aus den Antworten. Falls unklar, wird explizit nachgefragt.

Am Ende: Briefing-Zusammenfassung präsentieren → **Freigabe einholen**.

### Phase 2: Designkonzept

Design-Knowledge laden:
- `STYLE-PROFILE.md` lesen
- Relevante Pattern-Dateien lesen (typography.md, colors.md, spacing.md, etc.)
- Passende Blueprints als Referenz identifizieren

Designkonzept erstellen und präsentieren:
- **Farbsystem:** Max 3 Farben + Abstufungen, abgeleitet aus CI oder eigenständig
- **Typografie:** 2 Fonts (Headline + Body), Weights, Sizes
- **Spacing & Radii:** Projektspezifisch festlegen, konsistent
- **Budget-Level:** Standard oder Premium — mit konkreten Konsequenzen
- **Signature-Moves:** Welche kommen zum Einsatz, welche nicht
- **Animationsstrategie:** Was bewegt sich, was nicht

→ **Freigabe einholen**.

### Phase 3: styles.json generieren

LESS-Variablen ableiten aus dem Designkonzept:
- Alle globalen Variablen (Farben, Fonts, Sizes)
- Komponenten-Variablen (Buttons, Cards, Navbar, Tabs, Accordion, etc.)
- Abgleich mit echten Blueprints aus der DB für realistische Werte

Output: `styles.json` speichern in Projektordner.

### Phase 4: Designpräsentation (Startseite + 1-2 Unterseiten)

Wie im echten Webdesign-Prozess:
- **Startseite** generieren (immer ein Sonderfall mit eigenem Hero)
- **1-2 repräsentative Unterseiten** generieren (z.B. "Über uns" + "Leistungen")

Layouts als Builder-JSON erstellen. Dabei:
- Konsequentes Layout-System anwenden
- Signature-Moves einbauen (je nach Budget-Level)
- Konsistenz-Check gegen STYLE-PROFILE

→ Layouts präsentieren → **Freigabe einholen**.

### Phase 5: Restliche Seiten

Nach Freigabe der Präsentation:
- Alle weiteren Seiten generieren
- Gleiches Layout-System durchziehen (thematisch gleiche Seiten = identisch aufgebaut)
- Finaler Konsistenz-Check

→ **Finale Freigabe**.

### Phase 6: Output

Alles speichern in `~/projects/{projektname}/`:

```
~/projects/{projektname}/
├── briefing.md          # Dokumentation des Briefings
├── styles.json          # LESS-Variablen für template_styles
├── pages/
│   ├── home.json        # Builder-Layout Startseite
│   ├── ueber-uns.json   # Builder-Layout Unterseite
│   ├── leistungen.json  # etc.
│   └── kontakt.json
└── SUMMARY.md           # Übersicht: Seiten, Designkonzept, Budget-Level
```

## Budget-Stufen

| | Standard | Premium |
|---|---|---|
| Animationen | fade, slide-bottom-small | + expressivere Effekte, Parallax |
| SVG-Störer | Nein | Ja, mit Parallax-Rotation |
| Illustrationen/Deko | Nein | Ja, Logo/Marken-Elemente als Hintergrund-Pattern |
| Popover-Maps | Nein | Ja, wenn inhaltlich passend |
| Layout-Komplexität | Solide, bewährt | + Sektions-Überlappungen, asymmetrische Layouts |

## Qualitätsprüfung

Automatisch vor jeder Freigabe-Anfrage:

- [ ] **Absolute innere Konsistenz** — Gleiche Werte (Radii, Spacing, Styles) überall durchgezogen?
- [ ] **Konsequentes Layout-System** — Gleiche Bereiche identisch aufgebaut?
- [ ] **Reduziertes Farbsystem** — Max 3 Farben + Abstufungen?
- [ ] **Weißraum** — Großzügig zwischen Sektionen, kompakt innerhalb?
- [ ] **Animation** — Dezent und funktional (Standard) bzw. bewusst expressiv (Premium)?

## Konfiguration

- **Wissensdatenbank-Pfad:** Default `~/design-knowledge/`. Konfigurierbar für andere Designerinnen (z.B. `~/design-knowledge-julia/`).
- **Projektordner:** `~/projects/{projektname}/`

## Abgrenzung

- **Kein Deployment.** Der Skill generiert Dateien, deployt sie nicht. Dafür wird ein separater Deployment-Skill gebaut.
- **Keine Bildgenerierung.** Bilder werden als Platzhalter-Pfade (`images/hero.jpg`) eingesetzt.
- **Kein CSS.** Custom CSS wird nicht generiert — alles läuft über LESS-Variablen und Builder-Props.
