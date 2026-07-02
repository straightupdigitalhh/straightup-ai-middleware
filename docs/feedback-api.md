# Website-Feedback API

Backend für die Chrome-Extension „straightup Feedback".
Spec: bugherd-clone/docs/superpowers/specs/2026-07-02-website-feedback-extension-design.md

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

## Keys auflisten / widerrufen

```bash
curl -H "X-API-Key: $API_KEY" https://<middleware-host>/api/feedback-keys
curl -X DELETE -H "X-API-Key: $API_KEY" https://<middleware-host>/api/feedback-keys/fbk_…
```

Unbekannter oder bereits widerrufener Key → `404 { error: "not_found" }`.

## Extension-Endpoints (Auth: X-Feedback-Key)

- `GET /feedback/session` → `{ label, projectName, type, members? }`
- `POST /feedback/tickets` → `201 { taskId, taskUrl, screenshotAttached }`
  Fehler: 400 validation · 401 invalid_key · 403 domain_not_allowed ·
  429 rate_limited (60/h/Key) · 502 awork_unreachable

  Die Task wird immer angelegt, sobald die Validierung durchläuft – Screenshot-Upload
  und Assignee-Zuweisung sind Best-Effort und schlagen nur intern fehl (Response bleibt
  201). `screenshotAttached: false` zeigt an, dass kein Screenshot angehängt wurde.
