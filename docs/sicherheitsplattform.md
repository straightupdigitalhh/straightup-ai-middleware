# Sicherheitsplattform (Teil 1)

Die Middleware nimmt den Stand des Wachdienstes an (der Kern im
`agenten-haus` schiebt ihn alle fünf Minuten), zeigt ihn auf `/sicherheit`
und sammelt Jans Eingaben als Aufträge. Der Kern holt sie ab, wendet sie an,
quittiert und schiebt gleich einen neuen Stand. Der Kern öffnet keinen Port;
er ruft die Middleware im Stack-Netz unter `http://awork-middleware:3500` an.

## Umgebungswerte

| Wert | Dienst | Inhalt |
|---|---|---|
| `SICHERHEIT_DIENSTSCHLUESSEL` | Middleware und `agenten-haus`, gleicher Wert | Schlüssel im Header `X-Dienst-Schluessel` der Dienst-Endpunkte |
| `SICHERHEIT_NUTZER` | Middleware | E-Mails der Konten mit Zugang, kommagetrennt, Groß- und Kleinschreibung egal |
| `SICHERHEIT_MIDDLEWARE_URL` | nur `agenten-haus` | `http://awork-middleware:3500` |

Werte setzt Jan im mStudio, nie im Repo.

**Ohne Werte:** Fehlt `SICHERHEIT_DIENSTSCHLUESSEL` oder
`SICHERHEIT_NUTZER`, ist die Funktion aus. Jeder Pfad unter
`/api/sicherheit` antwortet mit 503, die Seiten `/sicherheit` und
`/sicherheit/zweiter-faktor` mit einer Hinweisseite (ebenfalls 503), und der
Kern schiebt nichts. Das Startlog sagt „Sicherheitsplattform aus" mit den
Namen der fehlenden Werte, nie mit Werten.

## Endpunkte

Dienst (der Kern), nur mit `X-Dienst-Schluessel`, vor der /api-Auth:

- `POST /api/sicherheit/stand`: der Stand als JSON (`version: 1`), bis 10 MB
- `GET /api/sicherheit/auftraege?offen=1`: die offenen Aufträge, älteste zuerst
- `POST /api/sicherheit/auftraege/:id/quittung`: `{ "ok": boolean, "text": string }`

Ein falscher Dienstschlüssel gibt 401 und steht mit IP im Log; 20
Fehlversuche je 15 Minuten und IP sperren.

Nutzer (die Seite): Session eines Kontos aus `SICHERHEIT_NUTZER` mit
bestätigtem zweiten Faktor, nie der Master-Key:

- `GET /api/sicherheit/stand`
- `POST /api/sicherheit/auftraege`, nur von der eigenen Seite (Origin oder
  `Sec-Fetch-Site: same-origin`)
- `GET /api/sicherheit/auftraege?seit=…`: der Verlauf mit Quittungen

Seiten:

- `/sicherheit`: das Dashboard (Lage, Flotte, Abdeckung, Aufräumen,
  Wächter, Akte je Site). Im Hub verlinkt für Admins.
- `/sicherheit/zweiter-faktor`: einrichten und Code eingeben.

Im Log stehen nie der Dienstschlüssel, Codes, Geheimnisse, Session-Token
oder Inhalte des Stands.

## Zweiter Faktor einrichten

Nach der Anmeldung im Hub führt `/sicherheit` zu
`/sicherheit/zweiter-faktor`. Solange für das Konto nichts eingerichtet
ist, zeigt die Seite einen neuen Schlüssel in Vierergruppen und als
otpauth-Adresse zum Abtippen in eine Authenticator-App; der erste richtige
Code richtet ihn ein und bestätigt die Anmeldung. Danach fragt die Seite nur
noch den Code. Eine Bestätigung gilt 12 Stunden, höchstens bis die Session
abläuft; jeder Code gilt einmal. Fünf falsche Codes je Konto in 15 Minuten
sperren die Eingabe bis zum Ende des Fensters.

## Zweiter Faktor zurücksetzen

Neues Telefon, App verloren: Dieser Befehl setzt den zweiten Faktor eines
Kontos zurück. Er leert Geheimnis, Entwurf und den zuletzt angenommenen
Codeschritt des Kontos und hebt die Bestätigung aller seiner Sessions auf.
Beim nächsten Aufruf von `/sicherheit` richtet das Konto ihn neu ein. Andere
Konten bleiben, wie sie sind.

Ausführen in einer Shell des Containers `awork-middleware` (Projekt
`p-enxfxy`), etwa über `mw container exec` wie in
`~/agents/docs/deployment.md`. Das Image (`node:22-alpine`) hat kein
`sqlite3`, der Befehl nutzt `node:sqlite`.

Wo die Datenbank liegt, folgt aus der Konfiguration: `src/index.ts` öffnet
`middleware.db` in `DATA_DIR`, sonst `FEEDBACK_DATA_DIR`, sonst `./data`.
Im Image ist das Arbeitsverzeichnis `/app`, und `docker-compose.mittwald.yml`
setzt kein `DATA_DIR` und hängt `./data` unter `/app/data` ein. Der Befehl
rechnet genauso, also `/app/data/middleware.db`, solange niemand `DATA_DIR`
setzt.

```sh
node -e '
const { DatabaseSync } = require("node:sqlite");
const { existsSync } = require("fs");
const { resolve } = require("path");
const email = (process.argv[1] || "").trim().toLowerCase();
const pfad = resolve("/app", process.env.DATA_DIR || process.env.FEEDBACK_DATA_DIR || "./data", "middleware.db");
if (!email) { console.error("Bitte die E-Mail des Kontos angeben."); process.exit(1); }
if (!existsSync(pfad)) { console.error("Unter " + pfad + " liegt keine Datenbank, nichts geändert."); process.exit(1); }
const db = new DatabaseSync(pfad);
const konto = db.prepare("SELECT id FROM users WHERE lower(email) = ?").get(email);
if (!konto) { console.error("Kein Konto " + email + " in " + pfad + ", nichts geändert."); process.exit(1); }
db.exec("BEGIN");
db.prepare("UPDATE users SET totp_geheimnis = NULL, totp_entwurf = NULL, totp_entwurf_session = NULL, totp_letzter_schritt = NULL WHERE id = ?").run(konto.id);
const sessions = db.prepare("UPDATE sessions SET zweiter_faktor_bis = NULL WHERE user_id = ?").run(konto.id).changes;
db.exec("COMMIT");
db.close();
console.log("Zweiter Faktor zurückgesetzt für " + email + " (Bestätigung bei " + sessions + " Sessions aufgehoben).");
' konto@example.test
```

Die E-Mail in der letzten Zeile durch die des Kontos ersetzen. Gibt es das
Konto oder die Datenbank nicht, bricht der Befehl mit einer Meldung ab und
ändert nichts; eine leere Datenbank legt er nicht an. Node 22 schreibt dazu
eine ExperimentalWarning zu `node:sqlite`; sie ist harmlos.
`test/sicherheit-zuruecksetzen.test.ts` führt genau diesen Befehl gegen eine
Test-Datenbank aus.

## Lokale Entwicklung

`scripts/sicherheit-dev.ts` startet die Middleware mit dem Beispiel-Stand
des Kerns (`test/fixtures/sicherheit-stand.json`) und einer eigenen
Datenbank unter `os.tmpdir()`, nie `data/`:

- `npx tsx scripts/sicherheit-dev.ts anlegen`: neue Datenbank mit einem
  Prüfkonto (zufälliges Passwort und TOTP-Geheimnis) und einem fremden Konto;
  die Zugänge stehen in `.sicherheit-dev/zugang.json` (git-ignoriert).
- `npx tsx scripts/sicherheit-dev.ts start [--alter <Minuten>]`: Middleware
  auf Port 3591, der Stand gilt als gerade (oder vor so vielen Minuten)
  empfangen.
- `npx tsx scripts/sicherheit-dev.ts code`: der aktuelle Code für das
  Prüfkonto.
- `npx tsx scripts/sicherheit-dev.ts quittieren [--fehler]`: spielt den
  Kern, quittiert alle offenen Aufträge und schiebt den Stand neu.
