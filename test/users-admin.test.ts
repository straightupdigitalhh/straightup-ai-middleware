import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { openDb } from '../src/core/db.js';
import { UserStore } from '../src/core/users.js';
import { SessionStore } from '../src/core/sessions.js';
import { createAuthRouter } from '../src/routes/auth.js';
import { createUsersAdminRouter } from '../src/routes/users-admin.js';
import { createApiAuth } from '../src/services/auth.js';
import { FixedWindowLimiter } from '../src/services/rate-limit.js';

// Muster A (test/hub-routes.test.ts:16-47): echte App-Kette aus Auth-Router +
// API-Auth + dem zu testenden Router, echter Login per Cookie. Diese Datei
// existierte vor Task 10 noch nicht (der bestehende PATCH-Test in
// hub-routes.test.ts:149-186 deckt nur role/disabled/Selbst-Aussperrung ab) —
// neue Datei nach Muster A statt eine bestehende zu ergänzen.

const MASTER_KEY = 'master-key';

function makeApp() {
  const db = openDb(':memory:');
  const users = new UserStore(db);
  const sessions = new SessionStore(db, users);

  const app = express();
  app.use(express.json());
  app.use(createAuthRouter({ users, sessions }));
  app.use('/api', createApiAuth(MASTER_KEY, sessions, new FixedWindowLimiter(100, 60_000)));
  app.use(createUsersAdminRouter({ users, sessions }));

  const admin = users.create({ email: 'jan@straightup-digital.de', name: 'Jan', role: 'admin', password: 'admin-pass-123' });
  const member = users.create({ email: 'team@straightup-digital.de', name: 'Team', role: 'member', password: 'member-pass-123' });
  return { app, users, admin, member };
}

async function loginCookie(app: express.Express, email: string, password: string): Promise<string> {
  const res = await request(app).post('/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  const setCookie = res.headers['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  return cookies[0].split(';')[0];
}

const AWORK_ID_A = 'a1b2c3d4-e5f6-4711-8899-aabbccddeeff';
const AWORK_ID_B = '11112222-3333-4444-5555-666677778888';

describe('PATCH /api/users/:id — aworkUserId (Task 10)', () => {
  it('gültige UUID ⇒ 200, das Feld steht im Response-User und bleibt persistiert', async () => {
    const { app, member } = makeApp();
    const cookie = await loginCookie(app, 'jan@straightup-digital.de', 'admin-pass-123');

    const res = await request(app).patch(`/api/users/${member.id}`).set('Cookie', cookie)
      .send({ aworkUserId: AWORK_ID_A });
    expect(res.status).toBe(200);
    expect(res.body.aworkUserId).toBe(AWORK_ID_A);

    const nachgelesen = await request(app).get('/api/users').set('Cookie', cookie);
    expect(nachgelesen.body.find((u: any) => u.id === member.id).aworkUserId).toBe(AWORK_ID_A);
  });

  it('keine gültige UUID ⇒ 400, nichts geändert', async () => {
    const { app, member } = makeApp();
    const cookie = await loginCookie(app, 'jan@straightup-digital.de', 'admin-pass-123');

    const res = await request(app).patch(`/api/users/${member.id}`).set('Cookie', cookie)
      .send({ aworkUserId: 'nicht-mal-annaehernd-eine-uuid' });
    expect(res.status).toBe(400);

    const nachgelesen = await request(app).get('/api/users').set('Cookie', cookie);
    expect(nachgelesen.body.find((u: any) => u.id === member.id).aworkUserId).toBeNull();
  });

  it('null löscht ein vorhandenes Mapping wieder', async () => {
    const { app, member } = makeApp();
    const cookie = await loginCookie(app, 'jan@straightup-digital.de', 'admin-pass-123');

    await request(app).patch(`/api/users/${member.id}`).set('Cookie', cookie)
      .send({ aworkUserId: AWORK_ID_A });
    const res = await request(app).patch(`/api/users/${member.id}`).set('Cookie', cookie)
      .send({ aworkUserId: null });
    expect(res.status).toBe(200);
    expect(res.body.aworkUserId).toBeNull();
  });

  it('dieselbe awork-ID bei einem zweiten Nutzer ⇒ 409, der erste bleibt unverändert', async () => {
    const { app, admin, member } = makeApp();
    const cookie = await loginCookie(app, 'jan@straightup-digital.de', 'admin-pass-123');

    const erster = await request(app).patch(`/api/users/${member.id}`).set('Cookie', cookie)
      .send({ aworkUserId: AWORK_ID_A });
    expect(erster.status).toBe(200);

    const zweiter = await request(app).patch(`/api/users/${admin.id}`).set('Cookie', cookie)
      .send({ aworkUserId: AWORK_ID_A });
    expect(zweiter.status).toBe(409);

    const nachgelesen = await request(app).get('/api/users').set('Cookie', cookie);
    expect(nachgelesen.body.find((u: any) => u.id === member.id).aworkUserId).toBe(AWORK_ID_A);
    expect(nachgelesen.body.find((u: any) => u.id === admin.id).aworkUserId).toBeNull();
  });

  it('Regressionstest: der bestehende Self-Lockout-Guard blockt weiterhin die eigene role/disabled-Änderung, NICHT aber die eigene awork-Zuordnung', async () => {
    const { app, admin } = makeApp();
    const cookie = await loginCookie(app, 'jan@straightup-digital.de', 'admin-pass-123');

    // Unverändert aus hub-routes.test.ts: eigene Rolle/Aktivierung bleibt gesperrt.
    expect((await request(app).patch(`/api/users/${admin.id}`).set('Cookie', cookie)
      .send({ disabled: true })).status).toBe(400);
    expect((await request(app).patch(`/api/users/${admin.id}`).set('Cookie', cookie)
      .send({ role: 'member' })).status).toBe(400);

    // Neu (Task 10): die eigene awork-Zuordnung darf ein Admin sehr wohl ändern.
    const res = await request(app).patch(`/api/users/${admin.id}`).set('Cookie', cookie)
      .send({ aworkUserId: AWORK_ID_B });
    expect(res.status).toBe(200);
    expect(res.body.aworkUserId).toBe(AWORK_ID_B);
  });
});
