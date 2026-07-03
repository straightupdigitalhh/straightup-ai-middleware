# design-analyze Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude Code skill that interactively analyzes websites and builds a growing knowledge base capturing a specific designer's style — including visual design, UX, technical implementation, and page structure variations across subpages.

**Architecture:** A single SKILL.md file in `~/.claude/skills/design-analyze/` that orchestrates existing tools (Playwright MCP, Firecrawl, Claude multimodal). The skill stores results in a dedicated knowledge base at `~/design-knowledge/` with a central STYLE-PROFILE.md as the primary output.

**Tech Stack:** Claude Code Skill (SKILL.md), Playwright MCP (screenshots + CSS extraction), Firecrawl CLI (HTML scraping), Markdown files (knowledge base)

---

## File Structure

```
~/.claude/skills/design-analyze/
└── SKILL.md                          # The skill definition — the only "code" we write

~/design-knowledge/                   # Knowledge base — created on first run
├── STYLE-PROFILE.md                  # Consolidated style profile (grows with each analysis)
├── analyses/                         # Per-website analysis files
├── patterns/
│   ├── typography.md
│   ├── colors.md
│   ├── layout.md
│   ├── spacing.md
│   ├── components.md
│   ├── animation.md
│   ├── imagery.md
│   ├── navigation.md
│   └── page-structures.md
├── yootheme-blueprints/
└── screenshots/
```

---

### Task 1: Create the knowledge base directory structure and templates

**Files:**
- Create: `~/design-knowledge/STYLE-PROFILE.md`
- Create: `~/design-knowledge/patterns/typography.md`
- Create: `~/design-knowledge/patterns/colors.md`
- Create: `~/design-knowledge/patterns/layout.md`
- Create: `~/design-knowledge/patterns/spacing.md`
- Create: `~/design-knowledge/patterns/components.md`
- Create: `~/design-knowledge/patterns/animation.md`
- Create: `~/design-knowledge/patterns/imagery.md`
- Create: `~/design-knowledge/patterns/navigation.md`
- Create: `~/design-knowledge/patterns/page-structures.md`

- [ ] **Step 1: Create the directory structure**

```bash
mkdir -p ~/design-knowledge/{analyses,patterns,yootheme-blueprints,screenshots}
```

- [ ] **Step 2: Create STYLE-PROFILE.md template**

Write to `~/design-knowledge/STYLE-PROFILE.md`:

```markdown
# Design-Stilprofil

> Dieses Profil wird automatisch vom `design-analyze` Skill gepflegt.
> Es konsolidiert Erkenntnisse aus allen analysierten Websites.

**Designerin:** [Name eintragen nach erster Analyse]
**Basiert auf:** 0 analysierten Websites
**Letzte Aktualisierung:** —

---

## Typografie

_Noch keine Daten. Wird nach der ersten Analyse gefüllt._

## Farbpalette

_Noch keine Daten._

## Layout

_Noch keine Daten._

## Spacing

_Noch keine Daten._

## Komponenten

_Noch keine Daten._

## Animation & Interaktion

_Noch keine Daten._

## Bildsprache

_Noch keine Daten._

## Navigation

_Noch keine Daten._

## Seitenstruktur & Content-Layouts

_Noch keine Daten._

---

## Meta: Erkannte Stilregeln

_Hier werden nach mehreren Analysen die stärksten, wiederkehrenden Regeln destilliert._

| Regel | Confidence | Basierend auf | User-Kommentar |
|-------|-----------|---------------|----------------|
| — | — | — | — |
```

- [ ] **Step 3: Create the 9 pattern file templates**

Jede Pattern-Datei bekommt das gleiche Grundgerüst. Schreibe für jede der 9 Dateien in `~/design-knowledge/patterns/`:

`typography.md`:
```markdown
# Pattern: Typografie

> Aggregierte Typografie-Muster über alle analysierten Websites.

## Gefundene Werte

| Website | Primär-Font | Sekundär-Font | H1-Größe | Body-Größe | H1-Gewicht | Body-Gewicht | Zeilenhöhe |
|---------|------------|---------------|----------|-----------|------------|-------------|------------|

## Erkanntes Muster

_Wird nach der ersten Analyse gefüllt._

## User-Feedback

_Wird nach der ersten Analyse gefüllt._

## Ausnahmen

_Abweichungen vom Muster und ihre Begründung._
```

`colors.md`:
```markdown
# Pattern: Farbpalette

> Aggregierte Farb-Muster über alle analysierten Websites.

## Gefundene Werte

| Website | Primär-BG | Sekundär-BG | Dunkel-BG | Primär-Akzent | Sekundär-Akzent | Text-Farbe | Text-Hell |
|---------|-----------|-------------|-----------|--------------|----------------|-----------|----------|

## Erkanntes Muster

_Wird nach der ersten Analyse gefüllt._

## User-Feedback

_Wird nach der ersten Analyse gefüllt._

## Ausnahmen

_Abweichungen vom Muster und ihre Begründung._
```

`layout.md`:
```markdown
# Pattern: Layout

> Aggregierte Layout-Muster über alle analysierten Websites.

## Gefundene Werte

| Website | Grid-Typ | Max-Width | Hero-Aufbau | Content-Splits | Weißraum-Verteilung |
|---------|---------|-----------|-------------|---------------|-------------------|

## Erkanntes Muster

_Wird nach der ersten Analyse gefüllt._

## User-Feedback

_Wird nach der ersten Analyse gefüllt._

## Ausnahmen

_Abweichungen vom Muster und ihre Begründung._
```

`spacing.md`:
```markdown
# Pattern: Spacing

> Aggregierte Spacing-Muster über alle analysierten Websites.

## Gefundene Werte

| Website | Sektions-Abstand | Inner-Padding | Element-Gap | Hero-Padding | Card-Padding |
|---------|-----------------|--------------|------------|-------------|-------------|

## Erkanntes Muster

_Wird nach der ersten Analyse gefüllt._

## User-Feedback

_Wird nach der ersten Analyse gefüllt._

## Ausnahmen

_Abweichungen vom Muster und ihre Begründung._
```

`components.md`:
```markdown
# Pattern: Komponenten

> Aggregierte Komponenten-Muster über alle analysierten Websites.

## Buttons

| Website | Form | Primär-Farbe | Border-Radius | Padding | Hover-Effekt | Text-Style |
|---------|------|-------------|--------------|---------|-------------|-----------|

## Cards

| Website | Border | Radius | Shadow | Padding | Bild-Verhältnis |
|---------|--------|--------|--------|---------|----------------|

## Hero-Sektionen

| Website | Typ | Text-Position | CTA-Stil | Hintergrund | Höhe |
|---------|-----|--------------|----------|-------------|------|

## CTAs

| Website | Primär | Sekundär | Platzierung | Kontrast |
|---------|--------|---------|------------|---------|

## Erkanntes Muster

_Wird nach der ersten Analyse gefüllt._

## User-Feedback

_Wird nach der ersten Analyse gefüllt._

## Ausnahmen

_Abweichungen vom Muster und ihre Begründung._
```

`animation.md`:
```markdown
# Pattern: Animation & Interaktion

> Aggregierte Animations-Muster über alle analysierten Websites.

## Gefundene Werte

| Website | Scroll-Effekte | Hover-States | Übergänge | Easing | Parallax | Ladeanimationen |
|---------|---------------|-------------|-----------|--------|---------|----------------|

## Erkanntes Muster

_Wird nach der ersten Analyse gefüllt._

## User-Feedback

_Wird nach der ersten Analyse gefüllt._

## Ausnahmen

_Abweichungen vom Muster und ihre Begründung._
```

`imagery.md`:
```markdown
# Pattern: Bildsprache

> Aggregierte Bild-Muster über alle analysierten Websites.

## Gefundene Werte

| Website | Bildformat | Filter/Overlays | Bild-Text-Verhältnis | Positionierung | Ecken | Schatten |
|---------|-----------|----------------|---------------------|---------------|-------|---------|

## Erkanntes Muster

_Wird nach der ersten Analyse gefüllt._

## User-Feedback

_Wird nach der ersten Analyse gefüllt._

## Ausnahmen

_Abweichungen vom Muster und ihre Begründung._
```

`navigation.md`:
```markdown
# Pattern: Navigation

> Aggregierte Navigations-Muster über alle analysierten Websites.

## Gefundene Werte

| Website | Header-Typ | Menü-Stil | Sticky | Mobile-Nav | Footer-Spalten | Logo-Position |
|---------|-----------|----------|--------|-----------|---------------|-------------|

## Erkanntes Muster

_Wird nach der ersten Analyse gefüllt._

## User-Feedback

_Wird nach der ersten Analyse gefüllt._

## Ausnahmen

_Abweichungen vom Muster und ihre Begründung._
```

`page-structures.md`:
```markdown
# Pattern: Seitenstruktur & Content-Layouts

> Aggregierte Seitenstruktur-Muster über alle analysierten Websites.

## Seitentypen-Katalog

| Website | Seite | Typ | Sektions-Abfolge | Besonderheiten |
|---------|-------|-----|-----------------|---------------|

## Layout-Variationen pro Content-Typ

### Startseiten
_Wird nach der ersten Analyse gefüllt._

### Über-uns / Team
_Wird nach der ersten Analyse gefüllt._

### Leistungen / Services
_Wird nach der ersten Analyse gefüllt._

### Kontakt
_Wird nach der ersten Analyse gefüllt._

### Sonstige
_Wird nach der ersten Analyse gefüllt._

## Erkanntes Muster

_Wird nach der ersten Analyse gefüllt._

## User-Feedback

_Wird nach der ersten Analyse gefüllt._

## Ausnahmen

_Abweichungen vom Muster und ihre Begründung._
```

- [ ] **Step 4: Verify the structure**

```bash
find ~/design-knowledge -type f | sort
```

Erwartete Ausgabe:
```
/Users/janlehnhoff/design-knowledge/STYLE-PROFILE.md
/Users/janlehnhoff/design-knowledge/patterns/animation.md
/Users/janlehnhoff/design-knowledge/patterns/colors.md
/Users/janlehnhoff/design-knowledge/patterns/components.md
/Users/janlehnhoff/design-knowledge/patterns/imagery.md
/Users/janlehnhoff/design-knowledge/patterns/layout.md
/Users/janlehnhoff/design-knowledge/patterns/navigation.md
/Users/janlehnhoff/design-knowledge/patterns/page-structures.md
/Users/janlehnhoff/design-knowledge/patterns/spacing.md
/Users/janlehnhoff/design-knowledge/patterns/typography.md
```

- [ ] **Step 5: Initialize git for the knowledge base**

```bash
cd ~/design-knowledge && git init && git add -A && git commit -m "Initialize design knowledge base with templates"
```

---

### Task 2: Write the SKILL.md — Phase 1 (Capture) and Phase 2 (Extract)

**Files:**
- Create: `~/.claude/skills/design-analyze/SKILL.md`

This is the core of the entire project. The SKILL.md tells Claude exactly what to do when `/design-analyze` is invoked. We build it in stages. This task covers the skill frontmatter, argument parsing, and the automatic Capture + Extract phases.

- [ ] **Step 1: Create the skill directory**

```bash
mkdir -p ~/.claude/skills/design-analyze
```

- [ ] **Step 2: Write the SKILL.md — frontmatter, intro, and Phase 1+2**

Write to `~/.claude/skills/design-analyze/SKILL.md`:

```markdown
---
name: design-analyze
description: Interaktive Website-Analyse zum Erfassen des Design-Stils einer spezifischen Designerin. Analysiert URLs visuell, technisch und strukturell, sammelt User-Feedback und baut eine wachsende Wissensdatenbank auf. Nutzen wenn der User eine Website-Design-Analyse starten will, eine URL zur Design-Analyse gibt, oder den Stil der Designerin erfassen möchte.
---

# Design-Analyze: Interaktive Website-Stilanalyse

Du bist ein Design-Analyst, der den spezifischen Stil einer Designerin erfasst. Du analysierst Websites ganzheitlich — visuell, technisch und strukturell — und baust eine wachsende Wissensdatenbank auf.

## Argumente parsen

Der User gibt:
- `ARGS` enthält die URL (Pflicht) und optional `--json <pfad>` für den YOOtheme-Pro-Export

Parsing:
1. Extrahiere die URL aus ARGS (erster Parameter, der mit http beginnt)
2. Prüfe ob `--json` vorhanden ist und extrahiere den Dateipfad
3. Leite den Domain-Namen ab (für Dateinamen): z.B. `https://www.example-firma.de/` → `example-firma-de`

Falls keine URL: Frage den User nach der URL.

## Wissensdatenbank prüfen

1. Prüfe ob `~/design-knowledge/` existiert. Falls nicht, informiere den User:
   "Die Wissensdatenbank existiert noch nicht. Ich erstelle sie jetzt."
   Dann erstelle die komplette Verzeichnisstruktur und alle Templates gemäß der Struktur in `~/design-knowledge/` (Verzeichnisse: analyses, patterns, yootheme-blueprints, screenshots; Dateien: STYLE-PROFILE.md und 9 Pattern-Dateien mit leeren Tabellen-Templates).

2. Lies `~/design-knowledge/STYLE-PROFILE.md` um zu wissen, wie viele Websites bereits analysiert wurden. Das beeinflusst Phase 3 (Cross-Site-Vergleiche ab der 2. Analyse).

## Phase 1: Capture (automatisch, parallel)

Informiere den User: "Starte die Datensammlung für [URL]. Das dauert einen Moment..."

Starte diese Aufgaben parallel mit Subagents (Agent tool):

### Subagent 1: Screenshots + Seitenstruktur
1. Navigiere mit Playwright zur URL
2. Lies die Hauptnavigation aus: Finde alle Links im `<nav>` oder Hauptmenü-Element. Extrahiere die Link-Texte und URLs. Ignoriere externe Links und Anker-Links.
3. Erstelle `~/design-knowledge/screenshots/[domain]/` Verzeichnis
4. Für die Startseite UND jede Seite aus der Hauptnavigation:
   a. Navigiere zur Seite
   b. Mache einen Full-Page-Screenshot in Desktop-Viewport (1440px breit) → `screenshots/[domain]/[seitenname]/desktop-full.png`
   c. Mache einen Full-Page-Screenshot in Tablet-Viewport (768px breit) → `screenshots/[domain]/[seitenname]/tablet-full.png`
   d. Mache einen Full-Page-Screenshot in Mobile-Viewport (375px breit) → `screenshots/[domain]/[seitenname]/mobile-full.png`
5. Gib die Liste der gefundenen Navigationsseiten zurück (Name + URL)

### Subagent 2: HTML + CSS Extraktion
1. Scrape die Startseite mit Firecrawl: `firecrawl scrape "[URL]" --only-main-content -o /tmp/design-analyze/[domain]/home.md`
2. Für jede Navigationsseite (aus der gleichen Navigation wie Subagent 1 — verwende Firecrawl-Map um die Seitenstruktur zu ermitteln): Scrape mit Firecrawl
3. Navigiere mit Playwright zur Startseite und extrahiere Computed Styles via `browser_evaluate`:

```javascript
// Dieses Script extrahiert die wichtigsten Design-Werte aus dem DOM
(function() {
  const body = document.body;
  const cs = getComputedStyle;
  
  // Alle einzigartigen Farben sammeln
  const colors = new Set();
  const fonts = new Set();
  const fontSizes = new Set();
  const spacings = new Set();
  const borderRadii = new Set();
  const transitions = new Set();
  
  document.querySelectorAll('*').forEach(el => {
    const s = cs(el);
    ['color', 'backgroundColor', 'borderColor'].forEach(p => {
      const v = s[p];
      if (v && v !== 'rgba(0, 0, 0, 0)' && v !== 'transparent') colors.add(v);
    });
    if (s.fontFamily) fonts.add(s.fontFamily.split(',')[0].trim().replace(/['"]/g, ''));
    if (s.fontSize) fontSizes.add(s.fontSize);
    ['marginTop', 'marginBottom', 'paddingTop', 'paddingBottom'].forEach(p => {
      if (s[p] && s[p] !== '0px') spacings.add(`${p}: ${s[p]}`);
    });
    if (s.borderRadius && s.borderRadius !== '0px') borderRadii.add(s.borderRadius);
    if (s.transition && s.transition !== 'all 0s ease 0s') transitions.add(s.transition);
  });
  
  // Headlines analysieren
  const headlines = {};
  ['h1','h2','h3','h4'].forEach(tag => {
    const el = document.querySelector(tag);
    if (el) {
      const s = cs(el);
      headlines[tag] = {
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        fontFamily: s.fontFamily.split(',')[0].trim().replace(/['"]/g, ''),
        lineHeight: s.lineHeight,
        letterSpacing: s.letterSpacing,
        color: s.color
      };
    }
  });
  
  // Body text
  const bodyEl = document.querySelector('p');
  const bodyStyle = bodyEl ? {
    fontSize: cs(bodyEl).fontSize,
    fontWeight: cs(bodyEl).fontWeight,
    fontFamily: cs(bodyEl).fontFamily.split(',')[0].trim().replace(/['"]/g, ''),
    lineHeight: cs(bodyEl).lineHeight,
    color: cs(bodyEl).color
  } : null;
  
  // Buttons
  const buttons = [];
  document.querySelectorAll('a[class*="btn"], button, .uk-button, [class*="button"]').forEach((el, i) => {
    if (i < 5) {
      const s = cs(el);
      buttons.push({
        text: el.textContent.trim().substring(0, 30),
        backgroundColor: s.backgroundColor,
        color: s.color,
        borderRadius: s.borderRadius,
        padding: s.padding,
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        border: s.border,
        transition: s.transition
      });
    }
  });
  
  return JSON.stringify({
    colors: [...colors].slice(0, 30),
    fonts: [...fonts],
    fontSizes: [...fontSizes],
    headlines,
    bodyStyle,
    buttons,
    borderRadii: [...borderRadii],
    transitions: [...transitions].slice(0, 10),
    topSpacings: [...spacings].slice(0, 20)
  }, null, 2);
})()
```

4. Speichere das Ergebnis als `/tmp/design-analyze/[domain]/computed-styles.json`

### Subagent 3: YOOtheme JSON (nur wenn --json angegeben)
1. Lies die JSON-Datei vom angegebenen Pfad
2. Extrahiere:
   - Alle Sektionen (type, props, children-Anzahl)
   - Alle Elemente und ihre Typen (text, image, grid, panel, etc.)
   - Spacing-Einstellungen (margin, padding pro Sektion)
   - Style-Einstellungen (Farben, Fonts, custom CSS)
   - Element-Verschachtelungstiefe
   - Verwendete YOOtheme-spezifische Features (overlaps, parallax, etc.)
3. Erstelle eine strukturierte Zusammenfassung als Markdown
4. Speichere Original-JSON als `~/design-knowledge/yootheme-blueprints/[domain].json`
5. Speichere die annotierte Zusammenfassung als `~/design-knowledge/yootheme-blueprints/[domain].annotated.md`

## Phase 2: Extract (automatisch)

Nachdem alle Subagents fertig sind, extrahiere die Findings. Arbeite die 9 Kategorien systematisch durch:

Für jede Kategorie: Kombiniere die Daten aus allen Quellen (Screenshots visuell analysieren, Computed Styles auswerten, HTML-Struktur prüfen, YOOtheme-JSON wenn vorhanden) und erstelle eine strukturierte Finding-Liste.

### Extraktions-Anweisungen pro Kategorie:

**1. Typografie:** Aus computed-styles.json: fonts, fontSizes, headlines, bodyStyle. Berechne das H1→Body Größenverhältnis. Zähle wie viele verschiedene Font-Familien verwendet werden.

**2. Farbpalette:** Aus computed-styles.json: colors. Gruppiere in Hintergrund/Text/Akzent. Identifiziere Primär- und Sekundärfarben. Analysiere den Screenshot visuell: Ist die Gesamtwirkung warm/kalt/neutral?

**3. Layout:** Analysiere die Screenshots visuell (multimodal): Grid-Struktur, Content-Breite, Symmetrie/Asymmetrie. Aus HTML: Container-Widths, Grid-Klassen. Aus YOOtheme-JSON: Section-Typen, Column-Splits.

**4. Spacing:** Aus computed-styles.json: topSpacings. Aus YOOtheme-JSON: margin/padding-Einstellungen. Identifiziere wiederkehrende Abstands-Werte.

**5. Komponenten:** Aus computed-styles.json: buttons. Aus HTML/Screenshots: Card-Designs, Hero-Aufbau, CTA-Platzierung, Formular-Styling.

**6. Animation:** Aus computed-styles.json: transitions. Aus HTML: Scroll-Trigger-Klassen, data-Attribute für Animationen. Aus YOOtheme-JSON: animation-Einstellungen.

**7. Bildsprache:** Analysiere Screenshots visuell: Bildformate, Filter, Overlays, Verhältnis Bild zu Text. Aus HTML: img-Tags, Aspect-Ratios, Object-Fit-Werte.

**8. Navigation:** Aus der Seitenstruktur: Menü-Punkte und Hierarchie. Aus Screenshots: Header-Design, Footer-Layout, Mobile-Navigation. Aus HTML: Nav-Struktur, Sticky-Klassen.

**9. Seitenstruktur & Content-Layouts:** Vergleiche die Screenshots ALLER Navigationsseiten. Identifiziere: Welche Seitentypen gibt es? Wie variiert der Sektionsaufbau? Welche Layout-Patterns werden für welchen Content-Typ verwendet? Gibt es wiederkehrende Muster oder bewusste Abwechslung?

Zusätzlich: **Visuelle Gesamtanalyse** — Beschreibe den Gesamteindruck der Website in 3-5 Sätzen. Welche Stimmung erzeugt sie? Was fällt sofort auf? Was macht sie besonders?
```

- [ ] **Step 3: Verify the skill file exists and has correct frontmatter**

```bash
head -5 ~/.claude/skills/design-analyze/SKILL.md
```

Erwartet: Die `---` Frontmatter-Blöcke mit name und description.

- [ ] **Step 4: Commit**

```bash
cd ~/.claude/skills/design-analyze && git init && git add SKILL.md && git commit -m "Add design-analyze skill: Phase 1 (Capture) + Phase 2 (Extract)"
```

---

### Task 3: Write the SKILL.md — Phase 3 (Present) and Phase 4 (Consolidate)

**Files:**
- Modify: `~/.claude/skills/design-analyze/SKILL.md` (append)

- [ ] **Step 1: Append Phase 3 (Present) to SKILL.md**

Append to `~/.claude/skills/design-analyze/SKILL.md`:

```markdown

## Phase 3: Present (interaktiv — Herzstück)

Jetzt präsentierst du dem User die Findings. Gehe Kategorie für Kategorie durch. Bei jeder Kategorie:

### Ablauf pro Kategorie:

1. **Zeige die Findings** — Konkrete Werte, relevante Screenshots (lies die Screenshot-Dateien und zeige sie dem User), JSON-Auszüge wenn relevant.

2. **Stelle gezielte Fragen** — IMMER eine Frage pro Nachricht, nicht mehrere auf einmal:
   - "Ist das typisch für ihren Stil?"
   - "Was fällt dir besonders auf?"
   - "Ist das ein bewusster Stilmerkmal oder eher projektspezifisch?"
   - "Wie wichtig ist dir dieses Muster? (1 = nice to have, 2 = wichtig, 3 = Signature-Move)"

3. **Speichere das Feedback** — Merke dir die Antworten für Phase 4.

### Kategorien-Reihenfolge:

Starte mit dem visuellen Gesamteindruck, dann die 9 Kategorien:

1. **Gesamteindruck** — Zeige den Desktop-Screenshot der Startseite. Beschreibe deinen Eindruck. Frage: "Wie würdest du das Design in 2-3 Worten beschreiben? Was macht es besonders?"

2. **Typografie** — Zeige die gefundenen Fonts und Größen. Frage: "Ist das ihre typische Font-Wahl? Nutzt sie immer diese Art von Hierarchie?"

3. **Farbpalette** — Zeige die extrahierten Farben gruppiert. Frage: "Ist die Farbwahl typisch für sie oder eher kundenspezifisch? Was ist ihr Signature bei Farben?"

4. **Layout** — Zeige Screenshots und beschreibe die Grid-Struktur. Frage: "Erkennst du ihre Handschrift im Layout? Was ist typisch?"

5. **Spacing** — Zeige die Abstands-Werte. Frage: "Arbeitet sie generell mit viel oder wenig Weißraum? Ist das hier typisch?"

6. **Komponenten** — Zeige Buttons, Cards, Hero-Sektionen. Frage: "Wie baut sie typischerweise CTAs und Hero-Bereiche?"

7. **Animation** — Zeige die gefundenen Transitions/Animationen. Frage: "Nutzt sie viel Animation oder eher dezent? Was ist typisch?"

8. **Bildsprache** — Analysiere die Bilder visuell. Frage: "Wie geht sie typischerweise mit Bildern um? Bestimmte Formate, Filter, Platzierung?"

9. **Navigation** — Zeige Header/Footer/Mobile-Nav. Frage: "Ist dieser Navigations-Stil typisch für sie?"

10. **Seitenstruktur** — Zeige die verschiedenen Unterseiten-Layouts nebeneinander. Frage: "Wie variiert sie die Layouts über die Unterseiten? Ist diese Abwechslung typisch?"

### Cross-Site-Vergleiche (ab der 2. Analyse):

Lies vorher die bestehenden Pattern-Dateien in `~/design-knowledge/patterns/`. Bei jeder Kategorie:
- Vergleiche die neuen Findings mit den bestehenden Patterns
- Weise auf Übereinstimmungen hin: "Das bestätigt ein Muster: Sie nutzt auch hier [X], wie schon bei [Y] und [Z]."
- Weise auf Abweichungen hin: "Hier weicht sie ab — bei den anderen Seiten war [X], hier ist [Y]. Ist das Absicht oder projektspezifisch?"

## Phase 4: Consolidate (automatisch)

Nachdem alle Kategorien interaktiv durchgegangen sind, konsolidiere die Ergebnisse:

### Schritt 1: Einzelanalyse speichern

Schreibe `~/design-knowledge/analyses/[domain].md`:

```markdown
# Analyse: [Domain]

**URL:** [URL]
**Analysiert:** [Datum]
**YOOtheme-JSON:** [Ja/Nein]

## Gesamteindruck

**Claude:** [Deine visuelle Analyse]
**User:** [Feedback des Users]

## Findings pro Kategorie

### Typografie
- **Findings:** [Konkrete Werte]
- **User-Feedback:** [Was der User gesagt hat]
- **Wichtigkeit:** [1-3]
- **Typisch für Designerin:** [Ja/Nein/Teilweise]

### Farbpalette
[Gleiches Schema...]

### Layout
[Gleiches Schema...]

### Spacing
[Gleiches Schema...]

### Komponenten
[Gleiches Schema...]

### Animation
[Gleiches Schema...]

### Bildsprache
[Gleiches Schema...]

### Navigation
[Gleiches Schema...]

### Seitenstruktur & Content-Layouts
- **Gefundene Seiten:** [Liste der analysierten Navigationsseiten]
- **Seitentypen:** [Welche Typen wurden identifiziert]
- **Layout-Variationen:** [Wie unterscheiden sich die Unterseiten]
- **User-Feedback:** [Was der User gesagt hat]
- **Typisch für Designerin:** [Ja/Nein/Teilweise]
```

### Schritt 2: Pattern-Dateien aktualisieren

Für jede der 9 Pattern-Dateien in `~/design-knowledge/patterns/`:
1. Lies die aktuelle Datei
2. Füge eine neue Zeile in die Tabelle "Gefundene Werte" ein mit den Daten dieser Website
3. Aktualisiere den Abschnitt "Erkanntes Muster" basierend auf allen bisherigen Daten
4. Füge das User-Feedback für diese Kategorie unter "User-Feedback" hinzu
5. Falls eine Abweichung erkannt wurde, dokumentiere sie unter "Ausnahmen"

### Schritt 3: STYLE-PROFILE.md konsolidieren

1. Lies `~/design-knowledge/STYLE-PROFILE.md`
2. Aktualisiere "Basiert auf: X analysierten Websites" (inkrementiere um 1)
3. Aktualisiere "Letzte Aktualisierung: [heute]"
4. Für jede der 9 Kategorien:
   - Lies die zugehörige Pattern-Datei
   - Destilliere die stärksten Muster (hohe Häufigkeit + vom User als "typisch" bewertet)
   - Schreibe konkrete Regeln mit Werten und Häufigkeiten
   - Füge User-Kommentare hinzu die das WARUM erklären
   - Setze ein Confidence-Level: stark (≥70% der Websites + User sagt "typisch"), mittel (≥40%), schwach (<40%)
5. Aktualisiere die "Erkannte Stilregeln"-Tabelle am Ende mit den stärksten Cross-Kategorie-Regeln

### Schritt 4: Zusammenfassung zeigen

Zeige dem User:
- "Analyse von [Domain] abgeschlossen und gespeichert."
- "Das Stilprofil basiert jetzt auf X Websites."
- "Neue/verstärkte Erkenntnisse:" — Liste der wichtigsten neuen oder bestätigten Muster
- "Möchtest du die nächste Website analysieren?"
```

- [ ] **Step 2: Verify the complete SKILL.md**

```bash
wc -l ~/.claude/skills/design-analyze/SKILL.md
```

Erwartet: ~250-300 Zeilen.

```bash
grep "## Phase" ~/.claude/skills/design-analyze/SKILL.md
```

Erwartet: 4 Phasen (Phase 1-4).

- [ ] **Step 3: Commit**

```bash
cd ~/.claude/skills/design-analyze && git add SKILL.md && git commit -m "Add Phase 3 (Present) + Phase 4 (Consolidate) to design-analyze skill"
```

---

### Task 4: Smoke-Test — Erste Analyse mit einer echten Website

**Files:** Keine neuen Dateien — dies ist ein manueller Test.

- [ ] **Step 1: Teste den Skill-Aufruf**

Starte eine neue Claude-Code-Session und rufe auf:
```
/design-analyze https://[erste-website-der-designerin]
```

- [ ] **Step 2: Prüfe Phase 1 (Capture)**

Verifiziere:
- [ ] Screenshots werden in `~/design-knowledge/screenshots/[domain]/` erstellt
- [ ] Mehrere Unterseiten werden erkannt und gescreenshottet
- [ ] HTML wird gescrapt
- [ ] Computed Styles werden extrahiert

- [ ] **Step 3: Prüfe Phase 2 (Extract)**

Verifiziere:
- [ ] 9 Kategorien werden extrahiert
- [ ] Visuelle Analyse beschreibt den Gesamteindruck

- [ ] **Step 4: Prüfe Phase 3 (Present)**

Verifiziere:
- [ ] Kategorien werden einzeln präsentiert
- [ ] Screenshots werden gezeigt
- [ ] Fragen werden gestellt und Feedback aufgenommen
- [ ] Seitenstruktur-Vergleich zeigt Unterseiten-Variationen

- [ ] **Step 5: Prüfe Phase 4 (Consolidate)**

Verifiziere:
- [ ] `~/design-knowledge/analyses/[domain].md` wurde erstellt
- [ ] Pattern-Dateien wurden aktualisiert (nicht mehr leer)
- [ ] STYLE-PROFILE.md zeigt "Basiert auf: 1 analysierten Websites"
- [ ] YOOtheme-Blueprint wurde gespeichert (falls --json verwendet)

- [ ] **Step 6: Iteriere**

Falls Probleme auftreten: Passe die SKILL.md an und teste erneut. Typische Anpassungen:
- Playwright-Selektoren für Navigation anpassen
- Firecrawl-Timeout erhöhen
- CSS-Extraktions-Script erweitern
- Fragen-Flow verbessern

- [ ] **Step 7: Commit fixes**

```bash
cd ~/.claude/skills/design-analyze && git add -A && git commit -m "Fix issues found during first smoke test"
```

---

## Zusammenfassung

| Task | Was | Geschätzter Aufwand |
|------|-----|-------------------|
| 1 | Wissensdatenbank-Struktur + Templates | Schnell — nur Dateien erstellen |
| 2 | SKILL.md Phase 1+2 (Capture + Extract) | Hauptarbeit — die Skill-Logik |
| 3 | SKILL.md Phase 3+4 (Present + Consolidate) | Hauptarbeit — interaktiver Flow |
| 4 | Smoke-Test mit echter Website | Validierung + Iteration |

Tasks 1-3 sind reine Schreibarbeit (Dateien erstellen). Task 4 ist der entscheidende Test mit einer echten Website der Designerin.
