# Design Spec: design-analyze Skill

**Datum:** 2026-04-04
**Ziel:** Einen Claude-Code-Skill bauen, der Websites interaktiv analysiert, den Design-Stil einer spezifischen Designerin extrahiert und die Erkenntnisse in einer wachsenden Wissensdatenbank speichert.

## Kontext

Die Agentur erstellt Corporate-Websites mit Joomla + YOOtheme Pro. Eine sehr gute Designerin erstellt die Designs. Ziel ist es, ihren Stil maschinenlesbar zu erfassen, sodass ein späterer `design-generate` Skill neue Websites in ihrer Qualität erzeugen kann.

Aktuell gibt es 6-15 Websites der Designerin, die analysiert werden sollen. Die Anzahl kann über Zeit wachsen.

## Architektur: Zwei-Skill-System + späterer Agent

```
Schritt 1 (jetzt):  design-analyze   → Interaktive Analyse → Wissensdatenbank
Schritt 2 (später): design-generate  → Liest Wissensdatenbank → Erzeugt YOOtheme-Layouts
Schritt 3 (optional): design-agent   → Autonomer Agent, nutzt beide Skills als Tools
```

Diese Spec beschreibt ausschließlich **Schritt 1: den `design-analyze` Skill**.

## Eingaben

Pro Analyse gibt der User:

1. **URL** der Live-Website (Pflicht)
2. **YOOtheme-Pro JSON-Export** als Dateipfad (optional, aber stark empfohlen)

Aufruf:
```
/design-analyze https://kundenwebsite.de
/design-analyze https://kundenwebsite.de --json ~/exports/kunde.json
```

## Analyse-Pipeline: 4 Phasen

### Phase 1: Capture (automatisch, parallel)

Vier Datenquellen werden parallel via Subagents erfasst:

| Quelle | Tool | Was wird erfasst |
|--------|------|-----------------|
| Screenshots | Playwright MCP | Full-Page + Hero-Ausschnitt in 3 Viewports: Desktop (1440px), Tablet (768px), Mobile (375px). Gespeichert als PNG in `screenshots/`. |
| HTML/CSS | Firecrawl | Gerendeter HTML-Content der Startseite + aller Seiten aus der Hauptnavigation. Firecrawl-Map identifiziert die Seitenstruktur, dann werden alle Hauptnavigations-Seiten gecrawlt. |
| Seitenstruktur | Playwright + Firecrawl | Hauptnavigation auslesen, Sitemap der Top-Level-Seiten erstellen. Jede Unterseite wird einzeln analysiert, um Content-Layout-Variationen zu erfassen. |
| Computed Styles | Playwright `browser_evaluate` | Tatsächliche Farben, Font-Sizes, Margins, Paddings, Border-Radii, Transitions — direkt aus dem Browser ausgelesen. |
| YOOtheme JSON | Datei lesen + parsen | Sektionsstruktur, Element-Hierarchie, Spacing-Werte, Style-Einstellungen, verwendete YOOtheme-Elemente, Custom CSS. |

### Phase 2: Extract (automatisch)

Aus den Rohdaten werden Findings in 9 Kategorien extrahiert:

1. **Typografie** — Font-Familien, Größen, Gewichtungen, Zeilenhöhen, Hierarchie (H1→Body-Verhältnis)
2. **Farbpalette** — Primär/Sekundär/Akzent/Hintergrund/Text-Farben, Farbverhältnisse, Kontraste
3. **Layout** — Grid-Struktur, Sektionsaufbau, Weißraum-Verteilung, asymmetrische/symmetrische Splits
4. **Spacing** — Sektions-Abstände, Element-Paddings, Margin-Muster (aus YOOtheme-JSON + Computed Styles)
5. **Komponenten** — Buttons (Form, Farbe, Hover), Cards, Hero-Sektionen, CTAs, Formulare
6. **Animation** — Scroll-Effekte, Hover-States, Übergänge, Easing-Funktionen, Parallax
7. **Bildsprache** — Bildformate, Filter/Overlays, Verhältnis Bild/Text, Bildpositionierung
8. **Navigation** — Header-Aufbau, Menü-Stil, Footer-Struktur, Mobile-Navigation, Sticky-Verhalten
9. **Seitenstruktur & Content-Layouts** — Wie variiert die Designerin die Layouts über die Unterseiten? Welche Seitentypen gibt es (Hero-lastig, Text-lastig, Galerie, Team, Kontakt etc.)? Wie unterscheiden sich die Sektionsabfolgen? Welche Layout-Patterns nutzt sie für welchen Content-Typ? Gibt es wiederkehrende Seitenaufbau-Muster oder bewusste Abwechslung?

Zusätzlich: **Visuelle Analyse** — Claude analysiert die Screenshots multimodal und beschreibt den Gesamteindruck, die visuelle Hierarchie und die Komposition in eigenen Worten.

### Phase 3: Present (interaktiv — Herzstück)

Der Skill präsentiert die Findings Kategorie für Kategorie. Bei jeder Kategorie:

1. Zeigt die extrahierten Daten (Werte, Screenshots, JSON-Auszüge)
2. Stellt gezielte Fragen:
   - "Ist das typisch für sie?"
   - "Was fällt dir besonders auf?"
   - "Ist das ein bewusster Stil oder projektspezifisch?"
   - "Wie wichtig ist dir dieses Muster? (1-3)"
3. Speichert das Feedback direkt bei den Findings

Ab der 2. Analyse zusätzlich:
- Cross-Site-Vergleiche: "Dieses Muster hatten wir schon bei 3 anderen Seiten"
- Pattern-Bestätigungen: "Bestätigt sich: Sie nutzt fast immer warmes Grau als Hintergrund"
- Abweichungen: "Hier weicht sie ab — ist das Absicht oder Ausnahme?"

### Phase 4: Consolidate (automatisch)

Nach der interaktiven Phase:

1. **Einzelanalyse speichern** → `analyses/<domain>.md` (Findings + Feedback + Gesamteindruck)
2. **Pattern-Dateien aktualisieren** → Neue Werte in die 8 Pattern-Dateien einpflegen, Häufigkeiten aktualisieren
3. **YOOtheme-Blueprint speichern** → Original-JSON + annotierte Version mit Erklärungen der Design-Entscheidungen
4. **Screenshots ablegen** → `screenshots/<domain>/`
5. **STYLE-PROFILE.md neu konsolidieren** → Muster über alle Analysen destillieren, gewichtet nach User-Feedback. Stärkere Muster (häufig + vom User als "typisch" bewertet) stehen prominenter.
6. **Zusammenfassung zeigen** → "Das habe ich gelernt. So hat sich das Stilprofil verändert."

## Wissensdatenbank

Speicherort: `~/design-knowledge/`

```
~/design-knowledge/
├── STYLE-PROFILE.md              # Konsolidiertes Stilprofil (Hauptausgabe)
├── analyses/
│   ├── example-firma-de.md       # Detailanalyse pro Website
│   └── anderer-kunde-com.md
├── patterns/
│   ├── typography.md             # Aggregierte Muster pro Kategorie
│   ├── colors.md
│   ├── layout.md
│   ├── spacing.md
│   ├── components.md
│   ├── animation.md
│   ├── imagery.md
│   ├── navigation.md
│   └── page-structures.md    # Content-Layout-Variationen über Unterseiten
├── yootheme-blueprints/
│   ├── example-firma-de.json     # Original YOOtheme-Export
│   └── example-firma-de.annotated.md  # Annotierte lesbare Version
└── screenshots/
    └── example-firma-de/
        ├── home/
        │   ├── desktop-full.png
        │   ├── tablet-full.png
        │   └── mobile-full.png
        ├── ueber-uns/
        │   ├── desktop-full.png
        │   └── mobile-full.png
        ├── leistungen/
        │   └── desktop-full.png
        └── ...                       # Eine Unterordner pro Navigationsseite
```

### STYLE-PROFILE.md

Das zentrale Artefakt. Enthält pro Kategorie:
- **Destillierte Regeln** mit konkreten Werten
- **Häufigkeiten** ("Poppins: 5/8 Websites")
- **User-Kommentare** die das WARUM erklären
- **Confidence-Level** (stark/mittel/schwach basierend auf Häufigkeit + Feedback)

Wird nach jeder Analyse inkrementell aktualisiert, nicht neu geschrieben. Neue Erkenntnisse fließen ein, bestehende werden gestärkt oder relativiert.

### Pattern-Dateien

Jede der 9 Pattern-Dateien enthält:
- Tabelle mit konkreten Werten pro Website
- Erkanntes Muster / Regel
- User-Feedback zu diesem Pattern
- Ausnahmen und ihre Begründung

## Tools und Abhängigkeiten

### Bereits vorhanden (keine Installation nötig)

| Tool | Verwendung |
|------|-----------|
| Playwright MCP | Screenshots (3 Viewports), CSS-Extraktion via `browser_evaluate` |
| Firecrawl CLI | HTML-Extraktion mit JS-Rendering |
| Claude Multimodal | Visuelle Analyse der Screenshots |
| Read/Write/Edit Tools | Wissensdatenbank lesen/schreiben |
| Subagents | Parallele Capture-Phase |

### Muss gebaut werden

| Artefakt | Beschreibung |
|----------|-------------|
| `SKILL.md` | Skill-Definition mit komplettem Workflow |
| YOOtheme-JSON-Parser | Logik im Skill zum Parsen der YOOtheme-Exporte (Sektionen, Elemente, Settings) |
| Verzeichnisstruktur | Initiales `~/design-knowledge/` Setup |
| STYLE-PROFILE.md Template | Leeres Template mit allen Kategorien |
| Pattern-Datei Templates | Leere Templates für die 8 Pattern-Dateien |
| Analyse-Datei Template | Template für Einzelanalysen |

## Skill-Typ

Der Skill ist eine **SKILL.md-Datei** die in `~/.claude/skills/design-analyze/` installiert wird. Er orchestriert vorhandene Tools — es wird kein eigener Code/Server gebaut.

Aufruf: `/design-analyze <url> [--json <pfad>]`

## Scope-Abgrenzung

**In Scope:**
- Interaktive Analyse einzelner Websites
- Wachsende Wissensdatenbank mit STYLE-PROFILE.md
- YOOtheme-JSON-Parsing
- Cross-Site-Vergleiche ab der 2. Analyse
- Screenshots + visuelle Analyse

**Nicht in Scope (spätere Skills/Agents):**
- `design-generate` — Generierung neuer YOOtheme-Layouts (Schritt 2)
- `design-agent` — Autonomer Agent (Schritt 3)
- Automatische Batch-Analyse ohne User-Interaktion
- Integration in CI/CD oder andere Pipelines

## Roadmap

1. **Jetzt:** `design-analyze` Skill bauen und mit ersten Websites testen
2. **Nach ~8 Analysen:** `design-generate` Skill bauen, der die gefüllte Wissensdatenbank nutzt
3. **Optional:** `design-agent` als autonomer Agent, der beide Skills als Tools nutzt
