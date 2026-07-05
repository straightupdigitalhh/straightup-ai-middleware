# Architektur-Review & Ausbau-Konzept

**Stand:** Juli 2026 · **Scope:** Sicherheit, Frontend-Design-Logik, Ausbaufähigkeit (Automatisierungs-Plattform)

Die Middleware ist auf dem Weg vom Einzweck-Tool ("E-Mails/Transkripte → awork") zum
zentralen Knotenpunkt der Agentur: Wissenssystem, BugBee-Feedback, demnächst
Automatisierungen (Zeiterfassungs-Reminder). Dieses Dokument bewertet den Ist-Zustand
und beschreibt die Zielarchitektur für den Ausbau.

---

## 1. Sicherheits-Review

### 1.1 Was bereits gut gelöst ist

- **Getrennte Auth-Ebenen:** Master-Key (`X-API-Key`) für `/api/*`, projektgebundene,
  widerrufbare Feedback-Keys (`X-Feedback-Key`) für die öffentliche Extension-API.
- **Feedback-Keys solide:** 192 Bit Zufall (`randomBytes(24)`), Domain-Bindung mit
  korrekter Subdomain-Prüfung (`evilkunde.de` matcht nicht), Revocation, Rate-Limit
  pro Key (60/h).
- **Eingabe-Validierung im Feedback-Pfad:** strenge Payload-Prüfung, Screenshot nur als
  PNG-Data-URL mit 12-MB-Grenze, `assigneeId` wird gegen echte Projektmitglieder geprüft.
- **XSS-Schutz Richtung awork:** `escapeHtml()` auf allen nutzergenerierten Feldern in
  Ticket-Beschreibungen.
- **Body-Limits** (5 MB global, 20 MB nur für Screenshots), **atomare Persistenz**
  (tmp + rename), Startup-Check der Pflicht-Env-Variablen, Graceful Shutdown.
- **Admin-UI (BugBee)** nutzt durchgängig `createElement`/`textContent` statt
  innerHTML-Konkatenation — richtiges Muster.

### 1.2 Findings — Priorität HOCH

| # | Finding | Ort | Empfehlung |
|---|---------|-----|------------|
| H1 | **Master-Key als URL-Parameter** (`/?key=...`): landet in Browser-History, Server-/Proxy-Logs und potenziell Referer-Headern. | `src/routes/ui.ts:123` | Login-Muster wie im BugBee-Admin (sessionStorage), mittelfristig Session-Cookie (httpOnly). |
| H2 | **Ein einziger Master-Key, keine Nutzeridentität**: kein Audit-Trail (wer hat was ausgelöst?), keine Rollen (Jan/Gabi vs. Team), Key-Rotation heißt "alle informieren". | global | Nutzerkonten + Sessions + Rollen (`admin`, `member`) — ohnehin Voraussetzung für das geplante Hub-Frontend (siehe Kap. 3). |
| H3 | **`GET /api/feedback-keys` liefert alle Keys im Klartext**; Keys liegen zudem unverschlüsselt in `feedback-keys.json`. | `src/routes/feedback-admin.ts:66` | In der Liste nur Präfix (`fbk_abc1…`) zurückgeben; Klartext nur einmalig bei Erstellung. Optional: nur Hash speichern. |
| H4 | **Kein Brute-Force-Schutz auf der Auth**: unbegrenzte Rateversuche auf `X-API-Key` und `X-Feedback-Key`. | `src/index.ts:60`, `src/routes/feedback.ts:37` | `express-rate-limit` (global + verschärft auf 401), davor `app.set('trust proxy', 1)` wegen Mittwald-Proxy, sonst limitiert man die Proxy-IP. |

### 1.3 Findings — Priorität MITTEL

| # | Finding | Ort | Empfehlung |
|---|---------|-----|------------|
| M1 | **XSS-Risiko im Haupt-Formular**: Kunden-/Projektnamen aus awork werden per innerHTML-String-Konkatenation in `<option>` eingesetzt (`'<option value="' + c + '">'`). Ein awork-Projektname mit `"` oder `<` bricht aus. | `src/routes/ui.ts:142–164` | Auf `createElement`/`textContent` umstellen (Muster aus `feedback-admin-ui.ts` übernehmen). |
| M2 | **Keine Security-Header**: kein CSP, X-Frame-Options, HSTS, nosniff. Die Inline-Scripts der aktuellen Seiten verhindern eine strikte CSP — ein Argument für den Frontend-Neubau mit externen Assets. | global | `helmet` einbauen; CSP nach Frontend-Migration verschärfen. |
| M3 | **Fehlermeldungen leaken Interna**: `error.message` (inkl. kompletter awork-API-Antworten mit Pfaden) geht 1:1 an den Client. | `lookup.ts:18`, `email.ts:141`, `transcript.ts:149`, `feedback-admin.ts:62` | Generische Client-Fehler, Details nur ins Log. |
| M4 | **Prompt-Injection-Fläche im E-Mail-Poller**: beliebiger Inbound-Mail-Inhalt geht an Claude, dessen Output Tasks/Dokumente erzeugt. Aktuell gut entschärft, weil nur manuell kategorisierte Mails ("→ awork") verarbeitet werden. | `email-poller.ts` | Human-in-the-Loop beibehalten und als Sicherheitsanker dokumentieren; zusätzlich Obergrenze für erzeugte Tasks pro Mail (z. B. 10) und Längenlimits auf Claude-Output-Feldern. |
| M5 | **Container läuft als root**, kein `USER node`, kein `HEALTHCHECK`. | `Dockerfile` | `USER node` nach dem Build, `HEALTHCHECK CMD wget -qO- localhost:3500/health`. |
| M6 | **Timing-unsicherer Key-Vergleich** (`!==`). Eher theoretisch, aber trivial zu fixen. | `src/index.ts:63` | `crypto.timingSafeEqual` mit Längen-Guard. |

### 1.4 Findings — Priorität NIEDRIG

- Rate-Limit nur pro Feedback-Key, nicht pro IP; In-Memory (Reset bei Neustart). Bei
  Umstieg auf SQLite (Kap. 3) dort mitführen.
- `node-fetch@2` + `form-data`: Node 22 bringt natives `fetch`/`FormData` mit — beide
  Abhängigkeiten können perspektivisch entfallen; bis dahin regelmäßig `npm audit`.
- Logging: `console.log` enthält personenbezogene Daten (Mail-Betreff, Absender).
  Für DSGVO-Sauberkeit strukturiertes Logging (z. B. `pino`) mit definierter
  Aufbewahrung auf Mittwald klären.
- `/health` ist öffentlich und nennt Projektanzahl + Poller-Statistik. Vertretbar,
  aber Detailgrad könnte hinter Auth wandern (öffentlich nur `ok`/`degraded`).

**Fazit Sicherheit:** Für den heutigen Nutzerkreis (internes Tool + Extension) ist das
Niveau ordentlich — die Feedback-Key-Architektur ist durchdacht. "Ausreichend
abgesichert" für die geplante Rolle als Agentur-Knotenpunkt mit Admin-Frontend ist es
noch nicht: Es fehlen Nutzeridentität/Rollen (H2), und die vier HOCH-Punkte sollten vor
dem Ausbau behoben werden (Aufwand: grob 1–2 Tage).

---

## 2. Frontend-Design-Logik

### 2.1 Ist-Zustand

Zwei serverseitig ausgelieferte Inline-HTML-Seiten (`ui.ts`, `feedback-admin-ui.ts`) mit
jeweils ~250–480 Zeilen HTML/CSS/JS als Template-String im TypeScript-Code:

- CSS ist zwischen beiden Seiten dupliziert und leicht divergiert (kein gemeinsames Theme).
- Kein straightup-Branding (generisches Blau `#0066ff`, System-Fonts).
- Jede neue Funktion vergrößert einen String in einer `.ts`-Datei — nicht wartbar,
  keine Komponenten, kein Build-Schritt, Inline-Scripts blockieren eine strikte CSP.

Das war für zwei Formulare die richtige, pragmatische Wahl. Für ein Hub mit
Automations-Verwaltung, Status-Dashboards und wachsender Modulzahl trägt es nicht.

### 2.2 Empfehlung: "straightup Hub" als leichtgewichtige SPA

**Stack:** Vite + React + TypeScript + Tailwind CSS, als statische Assets aus dem
Express-Server ausgeliefert (`app.use('/app', express.static(...))`). Es bleibt bei
**einem** Container und **einem** Deployment — kein zweites Hosting, CI baut das
Frontend einfach im Docker-Build mit.

**Design-System:**

- Design-Tokens zentral (Tailwind-Theme bzw. CSS-Variablen): straightup-Markenfarben,
  Typografie, Radius, Schatten — einmal definiert, überall konsistent. Die konkreten
  Brand-Werte (Logo, Farbcodes aus dem CI) werden beim Aufsetzen eingepflegt.
- Wiederverwendbare Basis-Komponenten: Card, Button, Badge, Table, Form-Field,
  Status-Pill — im Stil dessen, was die beiden bestehenden Seiten schon andeuten
  (Karten-Layout, Badges "aktiv/widerrufen"), nur einheitlich.
- Light/Dark-Mode über Tokens fast gratis.

**Informationsarchitektur:**

```
Login (Session-Cookie, httpOnly)
└── Dashboard          → Modul-Karten mit Live-Status (Poller, letzte Automation-Runs)
    ├── Wissenssystem  → Transkript-/E-Mail-Formulare (Migration der heutigen Startseite)
    ├── BugBee         → Verbindungen verwalten (Migration von /feedback-admin)
    ├── Automationen   → Liste, an/aus, Zeitplan, Empfänger, Run-Historie, "Jetzt ausführen"
    └── Einstellungen  → Nutzer & Rollen (admin: Jan, Gabi / member: Team)
```

**Migration:** Die bestehenden Seiten bleiben erreichbar, bis ihre Hub-Pendants stehen;
danach Redirect. Die Backend-APIs (`/api/*`) bleiben unverändert nutzbar — das Hub ist
nur ein neuer Client. Damit löst der Frontend-Neubau nebenbei H1, M1 und M2.

---

## 3. Ausbaufähigkeit: Automatisierungs-Plattform

### 3.1 Zielbild

Die Middleware wird ein **Modul-Host**: Jedes Feature (Wissenssystem, BugBee, künftige
Automationen) bringt Routen, optionale Hintergrund-Jobs und einen Status mit. Der
E-Mail-Poller ist heute schon ein Ad-hoc-Vorläufer davon — das Muster wird
verallgemeinert:

```
src/
├── core/
│   ├── db.ts          SQLite (better-sqlite3) auf dem vorhandenen /app/data-Volume
│   ├── auth.ts        Nutzer, Sessions, Rollen
│   ├── scheduler.ts   Cron-Scheduler (croner, TZ Europe/Berlin) + Run-Tracking
│   └── mailer.ts      Versand über Microsoft Graph sendMail
├── modules/
│   ├── wissenssystem/ (heutige email/transcript-Routen + Poller)
│   ├── bugbee/        (heutige feedback-Routen, KeyStore → SQLite)
│   └── timetracking/  (neu, siehe 3.2)
└── web/               Hub-SPA (Kap. 2)
```

**Warum SQLite statt weiterer JSON-Dateien:** Automationen brauchen Run-Historie,
Konfiguration, Nutzer/Sessions und irgendwann Locks — genau die Stelle, an der
JSON-Dateien kippen. `better-sqlite3` ist eine Dependency ohne eigenen Server, läuft
auf dem bereits gemounteten `./data`-Volume und macht Backups trivial (eine Datei).

**Scheduler-Anforderungen** (aus dem Poller gelernt):

- Cron-Ausdrücke + Zeitzone Europe/Berlin (Sommerzeit!), Konfiguration in der DB,
  änderbar übers Hub.
- Jeder Lauf erzeugt einen `automation_runs`-Datensatz (Status, Dauer, Log, Fehler) —
  das ist die Datenbasis für die Status-Ansicht im Frontend.
- Überlapp-Schutz (wie `isPolling` heute), Retry mit Backoff, Missed-Run-Erkennung beim
  Start (Container war um 08:55 gerade im Deploy → Lauf nachholen, aber nur einmal).
- Manueller Trigger ("Jetzt ausführen") für Tests und Nachläufe.

### 3.2 Erste Automation: awork-Zeiterfassungs-Mails

**Fachlogik:**

1. **Persönliche Mail** — an jedem Werktag um 08:55 (Mo–Fr minus Feiertage Hamburg)
   erhält jede/r Mitarbeiter/in die eigenen getrackten Zeiten des **vorherigen
   Werktags** (Montag → Freitag), gruppiert nach Projekt, mit Tagessumme. Liegt die
   Summe unter dem Soll, motiviert die Mail zum Nachtragen — das ist der eigentliche
   Hebel für mehr getrackte Zeit.
2. **Management-Digest** — gleiche Uhrzeit, an Jan + Gabi: alle Mitarbeiter, gruppiert
   nach Mitarbeiter → Projekt, mit Summen und Auffälligkeiten (0-Stunden-Tage zuerst).

**Technik:**

- **awork:** `GET /timeentries` (Filter auf Datum), `GET /users` für die Zuordnung
  awork-User ↔ E-Mail-Adresse. Der vorhandene `AworkClient` wird um `getTimeEntries()`
  und `getUsers()` erweitert.
- **Versand:** Microsoft Graph `sendMail` — die Azure-App-Registrierung existiert
  bereits (Poller). Es fehlt nur die zusätzliche Application Permission **`Mail.Send`**
  (+ Admin Consent) und ein Absender-Postfach (z. B. `system@straightup-digital.de`).
  Kein neuer Anbieter, kein SMTP.
- **Werktagslogik:** kleiner Helper `previousWorkday(date)` / `isWorkday(date)` mit
  statischer Feiertagsliste Hamburg (überschaubar, jährlich pflegbar oder per Formel
  berechnet).
- **Konfiguration in der DB, administrierbar im Hub:** aktiv/inaktiv, Uhrzeit,
  Digest-Empfänger, Mitarbeiter-Ausnahmen, Soll-Stunden.
- **Idempotenz:** pro (Automation, Stichtag) höchstens ein erfolgreicher Lauf —
  verhindert Doppel-Mails bei Retry/Nachholen.

### 3.3 Fahrplan

| Phase | Inhalt | Aufwand (grob) |
|-------|--------|----------------|
| 1 | **Security-Hardening**: H1–H4 + M1, M3, M5, M6 (helmet, rate-limit, Fehler-Sanitizing, Key-Handling, Docker-User) | 1–2 Tage |
| 2 | **Fundament**: SQLite, Auth (Nutzer/Sessions/Rollen), Scheduler-/Modul-Framework, KeyStore-Migration | 3–4 Tage |
| 3 | **Hub-Frontend**: Vite/React/Tailwind-Setup, Design-Tokens mit straightup-Branding, Login, Dashboard, Migration der zwei bestehenden Seiten | 4–5 Tage |
| 4 | **Zeiterfassungs-Automation**: awork-Timeentries, Graph `Mail.Send`, Werktagslogik, persönliche Mail + Digest, Verwaltung im Hub | 3–4 Tage |
| 5 | Weitere Module nach Bedarf (das Framework aus Phase 2/3 macht jedes weitere Modul deutlich billiger) | — |

Phase 1 ist unabhängig und sofort machbar. Phase 4 setzt 2 voraus; 3 und 4 sind
parallelisierbar. Einzige externe Vorarbeit: `Mail.Send`-Permission in Azure AD.
