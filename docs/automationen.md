# Automationen

Automationen sind im Code definiert (`src/services/timetracking.ts`, Registrierung in
`src/index.ts`); an/aus, Zeitplan und Settings liegen in der SQLite-DB und werden über
die API (bzw. künftig das Hub-Frontend) gesteuert. Jeder Lauf landet mit Status und Log
in der Run-Historie.

## API (Auth: Session-Cookie oder X-API-Key; Steuern nur Admins)

```bash
GET    /api/automations                 # Liste mit Status + nächster Lauf
GET    /api/automations/:id             # Detail inkl. Settings (Admin)
GET    /api/automations/:id/runs        # Run-Historie
POST   /api/automations/:id/run         # Sofort ausführen (202 + runId)
PATCH  /api/automations/:id             # { enabled, cron, settings }
```

## Zeiterfassungs-Mails (timetracking-personal / timetracking-digest)

**Was passiert:** An Werktagen um 08:55 (Mo–Fr, Feiertage Hamburg werden übersprungen)
bekommt jede/r Mitarbeiter/in die eigenen awork-Zeiten des **vorherigen Werktags**
(Montag → Freitag), gruppiert nach Projekt – auch und gerade bei 0 Stunden, mit Bitte
um Nachtrag. Der Digest geht zeitgleich an die konfigurierten Empfänger: alle Zeiten,
gruppiert nach Mitarbeiter → Projekt, 0-Stunden-Tage zuerst.

### Einmalige Einrichtung

1. **Azure AD:** Der App-Registrierung (die schon fürs E-Mail-Polling existiert) die
   Application Permission **`Mail.Send`** geben + Admin Consent. Versendet wird über
   das Postfach aus `MS_USER_EMAIL`.
2. **awork-Anbindung prüfen** (versendet nichts):
   ```bash
   npx tsx scripts/timetracking-dry-run.ts              # vorheriger Werktag
   npx tsx scripts/timetracking-dry-run.ts 2026-07-03   # bestimmter Tag
   ```
   Zeigt pro Nutzer Zeiten + gefundene E-Mail-Adresse und die gerenderten Mails.
3. **Settings setzen und erst im Dry-Run aktivieren:**
   ```bash
   curl -X PATCH https://<host>/api/automations/timetracking-digest \
     -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
     -d '{"enabled":true,"settings":{"digestRecipients":["jan@straightup-digital.de","gabi@straightup-digital.de"],"dryRun":true}}'

   curl -X PATCH https://<host>/api/automations/timetracking-personal \
     -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
     -d '{"enabled":true,"settings":{"dryRun":true}}'
   ```
   Nach ein paar Tagen Run-Logs prüfen (`GET /api/automations/:id/runs`), dann
   `"dryRun":false` setzen → ab da gehen echte Mails raus.

### Settings-Referenz

| Feld | Automation | Bedeutung |
|------|-----------|-----------|
| `digestRecipients` | digest | Empfänger-Liste (Pflicht), z. B. Jan + Gabi |
| `userEmails` | personal | Overrides `{ "<awork-user-id>": "mail@…" }`, falls awork keine E-Mail kennt |
| `excludeUserIds` | beide | awork-User ohne Mails/Digest-Zeile (Freelancer, API-User) |
| `targetHoursPerDay` | personal | Soll für den Lücken-Hinweis (Default 8, 0 = aus) |
| `dryRun` | beide | `true`: nur ins Run-Log schreiben, nichts versenden |

### Hinweise

- Der Cron `55 8 * * 1-5` läuft in Europe/Berlin (Sommer-/Winterzeit inklusive).
- Läuft die Middleware um 08:55 gerade nicht (Deploy), gibt es keinen automatischen
  Nachhol-Lauf – bei Bedarf manuell per `POST /api/automations/:id/run` triggern.
- Der awork-`timeentries`-Filter (`StartDateLocal ge datetime'…'`) ist gegen die
  API-Doku gebaut; der Dry-Run in Schritt 2 verifiziert ihn gegen die echte API.
