# Mail-Relay für straightup Review – Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein schmaler Endpunkt `POST /api/mail/send` in der Middleware, über
den das PDF-Review-Portal (Dienst `pdf-reviewer` im selben Mittwald-Stack)
Klartext-Mails aus dem geteilten Postfach `review@straightup-digital.de`
verschickt, ohne selbst ein Entra-Geheimnis zu halten.

**Architecture:** Eigener Router mit eigenem Dienstschlüssel (`X-Service-Key`
gegen `MAIL_RELAY_KEY`, timing-sicher), vor der `/api`-Auth gemountet, damit
weder Session noch Master-Key nötig sind. Versand über den vorhandenen
`MicrosoftGraphClient` (`forMailbox(MAIL_RELAY_SENDER)`), Klartext statt
HTML. Drosselung 200 Mails je Stunde. Ohne `MAIL_RELAY_KEY` oder ohne
Graph-Konfiguration wird der Router nicht gemountet.

**Tech Stack:** Express 4, vitest, supertest (wie im Repo).

**Spec:** `~/straightup-pdf-reviewer/docs/superpowers/specs/2026-09-09-pdf-review-portal-design.md`, Abschnitt 6.7.

## Global Constraints

- Body `{ to: string[], subject: string, text: string }`: 1 bis 10 Empfänger,
  gültige Adressen, `subject` bis 200 Zeichen, `text` bis 20.000 Zeichen.
- Antworten: `202 { ok: true }`, `400 validation`, `401 invalid_key`,
  `429 rate_limited`, `502 versand_fehlgeschlagen`.
- Log nur Empfängerzahl und Betrefflänge, nie Inhalte oder Adressen.
- Mount **vor** `app.use('/api', createApiAuth(...))` in `src/index.ts`.
- Absender fest aus `MAIL_RELAY_SENDER`, Standard `review@straightup-digital.de`.
- Commits mit Trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: Klartext-Versand im Graph-Client

**Files:**
- Modify: `src/services/microsoft-graph.ts` (`sendMail`)

**Interfaces:**
- Produces: `sendMail(to: string[], subject: string, body: string, contentType: 'HTML' | 'Text' = 'HTML'): Promise<void>` – bestehende Aufrufer bleiben unverändert.

- [ ] **Step 1: Signatur erweitern**

In `sendMail` den Parameter ergänzen und im Graph-Body verwenden:

```ts
  async sendMail(to: string[], subject: string, body: string, contentType: 'HTML' | 'Text' = 'HTML'): Promise<void> {
    const token = await this.getAccessToken();
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(this.userEmail)}/sendMail`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType, content: body },
          toRecipients: to.map(address => ({ emailAddress: { address } })),
        },
        saveToSentItems: false,
      }),
    });

    if (!res.ok) {
      throw new Error(`Graph sendMail ${res.status}: ${await res.text()}`);
    }
  }
```

- [ ] **Step 2: Typprüfung und Tests**

Run: `npx tsc --noEmit && npm test`
Expected: keine Typfehler, alle bestehenden Tests grün (der Graph-Client hat keine Unit-Tests, der Standardwert hält alle Aufrufer stabil).

- [ ] **Step 3: Commit**

```bash
git add src/services/microsoft-graph.ts
git commit -m "feat(graph): sendMail kann Klartext verschicken (contentType Text)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Relay-Router mit Dienstschlüssel und Drossel

**Files:**
- Create: `src/routes/mail-relay.ts`
- Test: `test/mail-relay.test.ts`

**Interfaces:**
- Consumes: `safeEqual` aus `src/services/auth.ts`, `FixedWindowLimiter` aus `src/services/rate-limit.ts`.
- Produces: `createMailRelayRouter({ key, senden, limiter? }): Router` mit `senden: (to: string[], subject: string, text: string) => Promise<void>`.

- [ ] **Step 1: Fehlschlagende Tests schreiben**

`test/mail-relay.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createMailRelayRouter } from '../src/routes/mail-relay.js';
import { FixedWindowLimiter } from '../src/services/rate-limit.js';

function makeApp(senden = vi.fn().mockResolvedValue(undefined), limiter?: FixedWindowLimiter) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(createMailRelayRouter({ key: 'geheim', senden, limiter }));
  return { app, senden };
}

const gueltig = { to: ['peter@texter.de'], subject: 'Neue Aufgabe', text: 'Hallo Peter' };

describe('POST /api/mail/send', () => {
  it('verschickt mit richtigem Schlüssel und antwortet 202', async () => {
    const { app, senden } = makeApp();
    const res = await request(app).post('/api/mail/send').set('X-Service-Key', 'geheim').send(gueltig);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true });
    expect(senden).toHaveBeenCalledWith(['peter@texter.de'], 'Neue Aufgabe', 'Hallo Peter');
  });

  it('401 ohne oder mit falschem Schlüssel, ohne zu versenden', async () => {
    const { app, senden } = makeApp();
    expect((await request(app).post('/api/mail/send').send(gueltig)).status).toBe(401);
    expect((await request(app).post('/api/mail/send').set('X-Service-Key', 'falsch').send(gueltig)).status).toBe(401);
    expect(senden).not.toHaveBeenCalled();
  });

  it('400 bei ungültigem Body', async () => {
    const { app } = makeApp();
    const faelle = [
      {}, { ...gueltig, to: [] }, { ...gueltig, to: ['kein-mail'] }, { ...gueltig, to: Array(11).fill('a@b.de') },
      { ...gueltig, subject: 'x'.repeat(201) }, { ...gueltig, text: 'x'.repeat(20_001) }, { ...gueltig, text: 42 },
    ];
    for (const body of faelle) {
      const res = await request(app).post('/api/mail/send').set('X-Service-Key', 'geheim').send(body);
      expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
  });

  it('502 wenn Graph scheitert', async () => {
    const { app } = makeApp(vi.fn().mockRejectedValue(new Error('Graph sendMail 500')));
    const res = await request(app).post('/api/mail/send').set('X-Service-Key', 'geheim').send(gueltig);
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('versand_fehlgeschlagen');
  });

  it('429 ab dem Limit', async () => {
    const { app } = makeApp(undefined, new FixedWindowLimiter(2, 60_000));
    for (let i = 0; i < 2; i++) expect((await request(app).post('/api/mail/send').set('X-Service-Key', 'geheim').send(gueltig)).status).toBe(202);
    expect((await request(app).post('/api/mail/send').set('X-Service-Key', 'geheim').send(gueltig)).status).toBe(429);
  });
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `npx vitest run test/mail-relay.test.ts`
Expected: FAIL – Module nicht gefunden.

- [ ] **Step 3: Router schreiben**

`src/routes/mail-relay.ts`:

```ts
import { Router, type Request, type Response } from 'express';
import { safeEqual } from '../services/auth.js';
import { FixedWindowLimiter } from '../services/rate-limit.js';

interface Deps {
  key: string;
  senden: (to: string[], subject: string, text: string) => Promise<void>;
  /** Standard: 200 Mails je Stunde (Spec 6.7 des Review-Portals). */
  limiter?: FixedWindowLimiter;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validiere(body: unknown): { to: string[]; subject: string; text: string } | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const to = b.to;
  if (!Array.isArray(to) || to.length < 1 || to.length > 10) return 'to: 1 bis 10 Empfänger';
  if (!to.every(a => typeof a === 'string' && a.length <= 254 && EMAIL.test(a))) return 'to: ungültige Adresse';
  if (typeof b.subject !== 'string' || b.subject.trim().length === 0 || b.subject.length > 200) return 'subject: 1 bis 200 Zeichen';
  if (typeof b.text !== 'string' || b.text.trim().length === 0 || b.text.length > 20_000) return 'text: 1 bis 20000 Zeichen';
  return { to: to as string[], subject: b.subject, text: b.text };
}

/**
 * POST /api/mail/send – Relay für Dienste im selben Stack (straightup Review).
 * Eigener Dienstschlüssel, wird VOR der /api-Auth gemountet.
 */
export function createMailRelayRouter({ key, senden, limiter = new FixedWindowLimiter(200, 3_600_000) }: Deps): Router {
  const router = Router();

  router.post('/api/mail/send', async (req: Request, res: Response) => {
    const gegeben = req.headers['x-service-key'];
    if (typeof gegeben !== 'string' || !safeEqual(gegeben, key)) {
      res.status(401).json({ error: 'invalid_key', message: 'Dienstschlüssel fehlt oder ist falsch' });
      return;
    }
    const geprueft = validiere(req.body);
    if (typeof geprueft === 'string') {
      res.status(400).json({ error: 'validation', message: geprueft });
      return;
    }
    if (!limiter.hit('relay')) {
      res.status(429).json({ error: 'rate_limited', message: 'Zu viele Mails in dieser Stunde' });
      return;
    }
    try {
      await senden(geprueft.to, geprueft.subject, geprueft.text);
      console.log(`📮 Relay-Mail: ${geprueft.to.length} Empfänger, Betreff ${geprueft.subject.length} Zeichen`);
      res.status(202).json({ ok: true });
    } catch (e) {
      console.warn(`📮 Relay-Mail fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
      res.status(502).json({ error: 'versand_fehlgeschlagen', message: 'Mail konnte nicht verschickt werden' });
    }
  });

  return router;
}
```

- [ ] **Step 4: Tests laufen lassen, Erfolg prüfen**

Run: `npx vitest run test/mail-relay.test.ts`
Expected: PASS (5 Tests).

- [ ] **Step 5: Commit**

```bash
git add src/routes/mail-relay.ts test/mail-relay.test.ts
git commit -m "feat(relay): POST /api/mail/send mit Dienstschlüssel, Validierung und Drossel

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Verdrahtung, Konfiguration, Doku, Deploy

**Files:**
- Modify: `src/index.ts`, `.env.example`, `docker-compose.mittwald.yml`, `test/app-wiring.test.ts`
- Create: `docs/mail-relay.md`

- [ ] **Step 1: Verdrahtungs-Test ergänzen**

In `test/app-wiring.test.ts` am Ende einen Block anhängen, der die Reihenfolge „Relay vor /api-Auth" absichert:

```ts
import { createMailRelayRouter } from '../src/routes/mail-relay.js';
import { createApiAuth } from '../src/services/auth.js';

describe('App-Verdrahtung: Mail-Relay vor der /api-Auth', () => {
  function relayApp() {
    const app = express();
    app.use(express.json());
    // Reihenfolge wie in src/index.ts: Relay zuerst, dann die /api-Auth mit Master-Key
    app.use(createMailRelayRouter({ key: 'dienst', senden: async () => {} }));
    app.use('/api', createApiAuth('master'));
    app.get('/api/sonst', (_req, res) => { res.json({ ok: true }); });
    return app;
  }

  it('Relay braucht nur den Dienstschlüssel, kein X-API-Key', async () => {
    const res = await request(relayApp()).post('/api/mail/send').set('X-Service-Key', 'dienst')
      .send({ to: ['a@b.de'], subject: 'x', text: 'y' });
    expect(res.status).toBe(202);
  });

  it('andere /api-Routen bleiben hinter der Master-Key-Auth', async () => {
    expect((await request(relayApp()).get('/api/sonst')).status).toBe(401);
    expect((await request(relayApp()).get('/api/sonst').set('X-API-Key', 'master')).status).toBe(200);
  });

  it('Relay ohne Dienstschlüssel: 401 vom Relay, nicht 401 der API-Auth mit Brute-Force-Zählung', async () => {
    const res = await request(relayApp()).post('/api/mail/send').send({ to: ['a@b.de'], subject: 'x', text: 'y' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_key');
  });
});
```

Run: `npx vitest run test/app-wiring.test.ts`
Expected: die neuen Tests laufen bereits grün (Router existiert); sie sichern die Mount-Reihenfolge in `index.ts` gegen spätere Umbauten.

- [ ] **Step 2: index.ts verdrahten**

In `src/index.ts` nach den Body-Parsern und **vor** `app.use('/api', createApiAuth(process.env.API_KEY!, sessions));` einfügen:

```ts
// ─── Mail-Relay für straightup Review (gleicher Stack) ────────────
// Eigener Dienstschlüssel, deshalb VOR der /api-Auth. Ohne Schlüssel oder
// ohne Graph-Konfiguration bleibt der Endpunkt aus.
const { MAIL_RELAY_KEY, MAIL_RELAY_SENDER = 'review@straightup-digital.de' } = process.env;
if (MAIL_RELAY_KEY && graphClients.length > 0) {
  const relayMailer = graphClients[0].forMailbox(MAIL_RELAY_SENDER);
  app.use(createMailRelayRouter({
    key: MAIL_RELAY_KEY,
    senden: (to, subject, text) => relayMailer.sendMail(to, subject, text, 'Text'),
  }));
  console.log(`📮 Mail-Relay aktiv, Absender ${MAIL_RELAY_SENDER}`);
} else {
  console.log('📮 Mail-Relay aus (MAIL_RELAY_KEY oder MS_* nicht gesetzt)');
}
```

Import oben ergänzen: `import { createMailRelayRouter } from './routes/mail-relay.js';`

Hinweis: `graphClients` wird in `index.ts` bereits vor der App angelegt (Abschnitt „Microsoft Graph"), der Block gehört also hinter diese Definition und hinter `app.use(express.json(...))`.

- [ ] **Step 3: Konfiguration und Doku**

`.env.example` ergänzen:

```
# Mail-Relay für straightup Review (Dienst pdf-reviewer im selben Stack).
# Gleicher Schlüssel wie MAIL_RELAY_KEY im Portal; Absender ist ein geteiltes
# Postfach in Microsoft 365, auf das die Entra-App Mail.Send hat.
MAIL_RELAY_KEY=
MAIL_RELAY_SENDER=review@straightup-digital.de
```

`docker-compose.mittwald.yml` unter `environment` ergänzen:

```yaml
      MAIL_RELAY_KEY: ${MAIL_RELAY_KEY:-}
      MAIL_RELAY_SENDER: ${MAIL_RELAY_SENDER:-review@straightup-digital.de}
```

`docs/mail-relay.md`:

```markdown
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
```

- [ ] **Step 4: Tests, Typen, Commit**

Run: `npm test && npx tsc --noEmit`
Expected: alle Tests grün, keine Typfehler.

```bash
git add src/index.ts .env.example docker-compose.mittwald.yml docs/mail-relay.md test/app-wiring.test.ts
git commit -m "feat(relay): Mail-Relay verdrahtet (vor /api-Auth), Konfiguration und Doku

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push
```

- [ ] **Step 5: Ausrollen und prüfen**

Voraussetzungen (Jan): geteiltes Postfach `review@straightup-digital.de` in Microsoft 365 anlegen; `MAIL_RELAY_KEY` erzeugen (`openssl rand -base64 32`).

Stack frisch lesen, `MAIL_RELAY_KEY` und `MAIL_RELAY_SENDER` per `PATCH` nur am Dienst `awork-middleware` ergänzen (alle vorhandenen Envs aus der frischen Lektüre mitführen, Erkenntnis 27.07.2026), dann `actions/pull` nach dem Actions-Lauf. Startlog: `📮 Mail-Relay aktiv, Absender review@straightup-digital.de`.

Probe aus dem Portal-Container (oder per SSH ins Projekt):

```bash
curl -s -X POST http://awork-middleware:3500/api/mail/send \
  -H "X-Service-Key: $MAIL_RELAY_KEY" -H "Content-Type: application/json" \
  -d '{"to":["jan@straightup-digital.de"],"subject":"Relay-Probe","text":"Hallo aus dem Relay."}'
```

Expected: `{"ok":true}`, Mail von `review@straightup-digital.de` in Jans Postfach, Middleware-Log `📮 Relay-Mail: 1 Empfänger`.
