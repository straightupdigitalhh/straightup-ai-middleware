# Web-Recherche mit Parallel Search MCP

Für die Vorbereitung einer Website-Analyse lassen sich mit
[Parallel Search MCP](https://docs.parallel.ai/integrations/mcp/search-mcp)
aktuelle Dokumentation und Referenzseiten suchen und als Text abrufen.
Der kostenlose, anonyme Zugang benötigt keinen Parallel-Account oder API-Key;
die Suche läuft im Fast-Modus. Für gelegentliche Recherche gelten Nutzungslimits.

Die Einrichtung ist optional und gilt für Claude Code in diesem Repository.
Firecrawl bleibt für die im [Design-Analyse-Konzept](superpowers/specs/2026-04-04-design-analyze-skill-design.md)
beschriebene HTML-Erfassung mit JavaScript-Rendering zuständig; Screenshots und
Computed Styles erfasst weiterhin Playwright. Parallel ergänzt die Quellenrecherche.

## Lokal einrichten

Voraussetzung: [Claude Code](https://code.claude.com/docs/en/mcp) ist installiert.
Im Repository-Verzeichnis ausführen:

```bash
claude mcp add --transport http --scope local \
  parallel-search https://search.parallel.ai/mcp \
  --header "User-Agent: straightup-ai-middleware/1.0"
claude mcp get parallel-search
```

`--scope local` speichert den Server nur für dich und dieses Projekt in der
persönlichen Claude-Code-Konfiguration. Die versionierte `.mcp.json` mit dem
vorhandenen Firecrawl-Eintrag bleibt unverändert. Kein `Authorization`-Header
und kein Eintrag in der Middleware-`.env` sind nötig.

Eine neue Claude-Code-Sitzung in diesem Verzeichnis starten und mit `/mcp`
prüfen, ob `parallel-search` verbunden ist. Der Server stellt `web_search`
und `web_fetch` bereit. Werkzeugaufrufe wie üblich in Claude Code freigeben.

## Beispiel: Quellen für eine Website-Analyse finden

Als Vorbereitung für das Design-Analyse-Konzept kann dieser Prompt dienen:

```text
Recherchiere mit parallel-search die aktuelle offizielle YOOtheme-Pro-Dokumentation
zu responsiven Grids. Nutze web_search, um passende Quellen zu finden, und
web_fetch, um die zwei relevantesten Dokumentationsseiten zu lesen. Fasse die
Regeln für Breakpoints und Spalten zusammen und nenne zu jeder Aussage die
Quell-URL. Kennzeichne fehlende oder widersprüchliche Informationen.
```

`web_search` liefert Quellen und Textauszüge; `web_fetch` liest gezielt bekannte
URLs. Die abgerufenen Inhalte helfen bei der Recherche, liefern aber keine
Screenshots oder gemessenen CSS-Werte. Die bestehenden Capture-Schritte des
Design-Analyse-Konzepts werden dadurch nicht ersetzt.

Nur öffentliche Suchbegriffe und URLs senden. Inhalte aus Kundenmails,
Transkripten, internen awork-Projekten oder Zugangsdaten gehören nicht in diese
Recherche. Der MCP-Server wird hier im Entwicklungswerkzeug eingerichtet;
E-Mail-Verarbeitung und Transkript-Routen der Middleware rufen ihn nicht auf.

## Verbindung prüfen und entfernen

Bei Verbindungsproblemen zuerst `claude mcp get parallel-search` und `/mcp`
prüfen: Erwartet werden HTTP und `https://search.parallel.ai/mcp`. Bei einem
Nutzungslimit später erneut versuchen; der anonyme Zugang ist für leichte Nutzung
gedacht. Hinweise zu höheren Limits stehen in der
[Parallel-Einrichtungsanleitung](https://docs.parallel.ai/integrations/mcp/search-mcp).

Zum Entfernen der lokalen Einrichtung im selben Repository-Verzeichnis ausführen:

```bash
claude mcp remove parallel-search --scope local
```
