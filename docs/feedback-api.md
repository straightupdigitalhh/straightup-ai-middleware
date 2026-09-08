# Website-Feedback API

Backend für die Chrome-Extension „straightup BugBee".
Spec: straightup-bugbee/docs/superpowers/specs/2026-07-02-website-feedback-extension-design.md

## Key anlegen (einmalig pro Kundenprojekt)

Projekt-ID findest du per awork-CLI: `awork projects list --output table --select "id,name"`
User-ID (Standard-Assignee): `awork users list --output table --select "id,firstName,lastName"`

```bash
curl -X POST https://<middleware-host>/api/feedback-keys \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "<awork-projekt-id>",
    "domains": ["kunde-xy.de", "staging.kunde-xy.de"],
    "type": "customer",
    "defaultAssigneeId": "<awork-user-id>",
    "label": "Kunde XY Website-Relaunch"
  }'
```

Antwort enthält `key` (`fbk_…`) → an die Reporter geben.
`type: "internal"` erlaubt das Zuweisen-Dropdown in der Extension;
`type: "customer"` weist immer `defaultAssigneeId` zu.

Die Task-Liste „Website-Feedback" wird im awork-Projekt automatisch angelegt.

> **Wichtig – `defaultAssigneeId` muss ein echter Mensch sein.** In der Praxis
> verifiziert: awork lehnt die Zuweisung an einen **API-Key-User** ab
> (`"...are API key users. No user was assigned."`). Verwende die User-ID einer
> echten Person aus `awork users list` (bzw. der awork-Oberfläche) – **nicht**
> die ID des API-Tokens. Eine vorherige Projektmitgliedschaft ist nicht nötig;
> awork ordnet den User beim Zuweisen automatisch zu. Bei falscher ID wird die
> Task trotzdem angelegt (Best-Effort), bleibt aber **unassigned** und die
> Middleware loggt eine `⚠️ Zuweisung fehlgeschlagen`-Warnung.

## Extension-Endpoints (Auth: X-Feedback-Key)

- `GET /feedback/session` → `{ label, projectName, type, members? }`
- `POST /feedback/tickets` → `201 { taskId, taskUrl, screenshotAttached }`
  Fehler: 400 validation · 401 invalid_key · 403 domain_not_allowed ·
  429 rate_limited (60/h/Key) · 502 awork_unreachable

  Die Task wird immer angelegt, sobald die Validierung durchläuft – Screenshot-Upload
  und Assignee-Zuweisung sind Best-Effort und schlagen nur intern fehl (Response bleibt
  201). `screenshotAttached: false` zeigt an, dass kein Screenshot angehängt wurde.

## PDF-Feedback

Die Extension meldet PDF-Feedback mit demselben Endpoint. Statt `element`
enthält der Payload einen `pdf`-Block, `page.url` ist die PDF-URL oder leer
(lokale Datei), `page.title` der Dateiname:

```json
{
  "description": "Logo zu klein",
  "reporterName": "Kunde Klaus",
  "page": { "url": "", "title": "flyer-v3.pdf" },
  "pdf": {
    "fileName": "flyer-v3.pdf",
    "url": null,
    "page": 3,
    "pageCount": 12,
    "pageSize": { "width": 595.28, "height": 841.89 },
    "rect": { "x": 119.06, "y": 340.16, "width": 240.94, "height": 48.19 }
  },
  "environment": { "...": "wie bei Website-Tickets" },
  "screenshot": "data:image/png;base64,…"
}
```

`pageSize` und `rect` sind PDF-Punkte (1/72 Zoll), `rect` relativ zur
dargestellten Seite mit Ursprung oben links. Die Task heißt
`S. 3 · flyer-v3.pdf: Logo zu klein`, die Beschreibung nennt Datei (als Link,
wenn `url` gesetzt), Seite und die Position in Millimetern.

**Domain-Prüfung:** bei `url: null` entfällt sie; bei gehosteten PDFs muss der
Hostname der PDF-URL zu den Domains des Keys passen. Liegen PDFs auf einem
Preview-Server, dessen Domain also beim Key eintragen (z. B.
`preview.straightup-digital.de`). Damit der BugBee-Viewer die PDF ohne
Nachfrage laden kann, sollte der Server PDFs mit
`Access-Control-Allow-Origin: *` ausliefern.

## Keys auflisten / widerrufen

```bash
curl -H "X-API-Key: $API_KEY" https://<middleware-host>/api/feedback-keys
curl -X DELETE -H "X-API-Key: $API_KEY" https://<middleware-host>/api/feedback-keys/<id>
```

Die Liste enthält **keine Klartext-Keys** mehr, nur `id` + `keyPrefix` – der
volle Key wird ausschließlich einmalig in der Antwort der Anlage ausgegeben.
Widerruf läuft über die `id` (der Klartext-Key wird aus Kompatibilität weiter
akzeptiert). Unbekannte id / bereits widerrufen → `404 { error: "not_found" }`.
