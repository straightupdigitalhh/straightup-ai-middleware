# Mail-Relay

`POST /api/mail/send` verschickt Klartext-Mails aus `MAIL_RELAY_SENDER`
(Standard `review@straightup-digital.de`, geteiltes Postfach in Microsoft
365) über die Entra-App der Middleware. Gedacht für Dienste im selben
Mittwald-Stack, heute das PDF-Review-Portal (`pdf-reviewer`).

Auth: Header `X-Service-Key` = `MAIL_RELAY_KEY` (nicht der Master-Key, keine
Session). Body `{ "to": ["a@b.de"], "subject": "…", "text": "…" }`,
1 bis 10 Empfänger, Betreff bis 200, Text bis 20.000 Zeichen. Antworten
202/400/401/429 (200 je Stunde)/502. Geloggt werden Empfängerzahl und
Betrefflänge, nie Inhalte.

Voraussetzungen: `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` (wie
für das Polling) und das Postfach `review@straightup-digital.de` als
geteiltes Postfach im Microsoft-365-Admin-Center (kostet keine Lizenz). Die
Application-Permission `Mail.Send` der Entra-App deckt es ab, solange keine
Application Access Policy sie einschränkt.

Aufruf aus dem Stack-Netz: `http://awork-middleware:3500/api/mail/send`.
