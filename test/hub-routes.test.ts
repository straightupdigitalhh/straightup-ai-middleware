import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { openDb } from '../src/core/db.js';
import { UserStore } from '../src/core/users.js';
import { SessionStore } from '../src/core/sessions.js';
import { Scheduler } from '../src/core/scheduler.js';
import { createAuthRouter } from '../src/routes/auth.js';
import { createUsersAdminRouter } from '../src/routes/users-admin.js';
import { createAutomationsRouter } from '../src/routes/automations.js';
import { createApiAuth } from '../src/services/auth.js';
import { FixedWindowLimiter } from '../src/services/rate-limit.js';

const MASTER_KEY = 'master-key';

function makeApp(loginLimiter = new FixedWindowLimiter(100, 60_000)) {
  const db = openDb(':memory:');
  const users = new UserStore(db);
  const sessions = new SessionStore(db, users);
  const scheduler = new Scheduler(db);
  scheduler.register({
    id: 'demo',
    name: 'Demo-Automation',
    description: 'Für Tests',
    defaultCron: '0 9 * * 1-5',
    run: async () => 'demo gelaufen',
  });

  const app = express();
  app.use(express.json());
  app.use(createAuthRouter({ users, sessions, loginLimiter }));
  app.use('/api', createApiAuth(MASTER_KEY, sessions, new FixedWindowLimiter(100, 60_000)));
  app.use(createUsersAdminRouter({ users, sessions }));
  app.use(createAutomationsRouter({ scheduler }));

  const admin = users.create({ email: 'jan@straightup-digital.de', name: 'Jan', role: 'admin', password: 'admin-pass-123' });
  const member = users.create({ email: 'team@straightup-digital.de', name: 'Team', role: 'member', password: 'member-pass-123' });
  return { app, users, sessions, scheduler, admin, member };
}

async function loginCookie(app: express.Express, email: string, password: string): Promise<string> {
  const res = await request(app).post('/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  const setCookie = res.headers['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  return cookies[0].split(';')[0];
}

describe('POST /auth/login + GET /auth/me + Logout', () => {
  it('Login setzt httpOnly-Cookie, /auth/me liefert den Nutzer', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/auth/login')
      .send({ email: 'jan@straightup-digital.de', password: 'admin-pass-123' });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('jan@straightup-digital.de');
    expect(String(res.headers['set-cookie'])).toContain('HttpOnly');

    const cookie = String(res.headers['set-cookie']).split(';')[0];
    const me = await request(app).get('/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.user.role).toBe('admin');
  });

  it('falsches Passwort → 401, ohne Session → /auth/me 401', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/auth/login')
      .send({ email: 'jan@straightup-digital.de', password: 'falsch' });
    expect(res.status).toBe(401);
    expect((await request(app).get('/auth/me')).status).toBe(401);
  });

  it('Login-Brute-Force → 429', async () => {
    const { app } = makeApp(new FixedWindowLimiter(2, 60_000));
    for (let i = 0; i < 2; i++) {
      await request(app).post('/auth/login').send({ email: 'jan@straightup-digital.de', password: 'falsch' });
    }
    const blocked = await request(app).post('/auth/login')
      .send({ email: 'jan@straightup-digital.de', password: 'admin-pass-123' });
    expect(blocked.status).toBe(429);
  });

  it('Logout beendet die Session', async () => {
    const { app } = makeApp();
    const cookie = await loginCookie(app, 'jan@straightup-digital.de', 'admin-pass-123');
    await request(app).post('/auth/logout').set('Cookie', cookie);
    expect((await request(app).get('/auth/me').set('Cookie', cookie)).status).toBe(401);
  });
});

describe('POST /auth/password', () => {
  it('ändert das Passwort und invalidiert alte Sessions', async () => {
    const { app } = makeApp();
    const oldCookie = await loginCookie(app, 'jan@straightup-digital.de', 'admin-pass-123');
    const secondCookie = await loginCookie(app, 'jan@straightup-digital.de', 'admin-pass-123');

    const res = await request(app).post('/auth/password').set('Cookie', oldCookie)
      .send({ currentPassword: 'admin-pass-123', newPassword: 'neues-pass-456' });
    expect(res.status).toBe(204);

    // andere Session ist tot, neues Passwort gilt
    expect((await request(app).get('/auth/me').set('Cookie', secondCookie)).status).toBe(401);
    const relogin = await request(app).post('/auth/login')
      .send({ email: 'jan@straightup-digital.de', password: 'neues-pass-456' });
    expect(relogin.status).toBe(200);
  });

  it('falsches aktuelles Passwort → 401, zu kurzes neues → 400', async () => {
    const { app } = makeApp();
    const cookie = await loginCookie(app, 'jan@straightup-digital.de', 'admin-pass-123');
    expect((await request(app).post('/auth/password').set('Cookie', cookie)
      .send({ currentPassword: 'falsch', newPassword: 'neues-pass-456' })).status).toBe(401);
    expect((await request(app).post('/auth/password').set('Cookie', cookie)
      .send({ currentPassword: 'admin-pass-123', newPassword: 'kurz' })).status).toBe(400);
  });
});

describe('API-Auth: Session ODER Master-Key', () => {
  it('Session-Cookie funktioniert auf /api/*', async () => {
    const { app } = makeApp();
    const cookie = await loginCookie(app, 'team@straightup-digital.de', 'member-pass-123');
    const res = await request(app).get('/api/automations').set('Cookie', cookie);
    expect(res.status).toBe(200);
  });

  it('Master-Key funktioniert weiterhin (zählt als admin)', async () => {
    const { app } = makeApp();
    expect((await request(app).get('/api/automations').set('X-API-Key', MASTER_KEY)).status).toBe(200);
    expect((await request(app).get('/api/users').set('X-API-Key', MASTER_KEY)).status).toBe(200);
  });

  it('ohne beides → 401', async () => {
    const { app } = makeApp();
    expect((await request(app).get('/api/automations')).status).toBe(401);
  });
});

describe('Rollen: member vs admin', () => {
  it('member darf lesen, aber nicht steuern/verwalten', async () => {
    const { app } = makeApp();
    const cookie = await loginCookie(app, 'team@straightup-digital.de', 'member-pass-123');
    expect((await request(app).get('/api/automations').set('Cookie', cookie)).status).toBe(200);
    expect((await request(app).patch('/api/automations/demo').set('Cookie', cookie)
      .send({ enabled: true })).status).toBe(403);
    expect((await request(app).post('/api/automations/demo/run').set('Cookie', cookie)).status).toBe(403);
    expect((await request(app).get('/api/users').set('Cookie', cookie)).status).toBe(403);
  });
});

describe('/api/users (Admin)', () => {
  it('anlegen, Duplikat 409, schwaches Passwort 400', async () => {
    const { app } = makeApp();
    const cookie = await loginCookie(app, 'jan@straightup-digital.de', 'admin-pass-123');

    const created = await request(app).post('/api/users').set('Cookie', cookie)
      .send({ email: 'gabi@straightup-digital.de', name: 'Gabi', role: 'admin', password: 'gabi-pass-1234' });
    expect(created.status).toBe(201);
    expect(created.body.role).toBe('admin');

    expect((await request(app).post('/api/users').set('Cookie', cookie)
      .send({ email: 'gabi@straightup-digital.de', name: 'Gabi', role: 'admin', password: 'gabi-pass-1234' })).status).toBe(409);
    expect((await request(app).post('/api/users').set('Cookie', cookie)
      .send({ email: 'x@y.de', name: 'X', role: 'member', password: 'kurz' })).status).toBe(400);
  });

  it('deaktivieren beendet Sessions des Nutzers', async () => {
    const { app, member } = makeApp();
    const adminCookie = await loginCookie(app, 'jan@straightup-digital.de', 'admin-pass-123');
    const memberCookie = await loginCookie(app, 'team@straightup-digital.de', 'member-pass-123');

    const res = await request(app).patch(`/api/users/${member.id}`).set('Cookie', adminCookie)
      .send({ disabled: true });
    expect(res.status).toBe(200);
    expect(res.body.disabledAt).not.toBeNull();

    expect((await request(app).get('/api/automations').set('Cookie', memberCookie)).status).toBe(401);
  });

  it('sich selbst deaktivieren/degradieren → 400', async () => {
    const { app, admin } = makeApp();
    const cookie = await loginCookie(app, 'jan@straightup-digital.de', 'admin-pass-123');
    expect((await request(app).patch(`/api/users/${admin.id}`).set('Cookie', cookie)
      .send({ disabled: true })).status).toBe(400);
    expect((await request(app).patch(`/api/users/${admin.id}`).set('Cookie', cookie)
      .send({ role: 'member' })).status).toBe(400);
  });
});

describe('/api/automations', () => {
  it('Liste, Konfiguration, manueller Lauf, Run-Historie', async () => {
    const { app, scheduler } = makeApp();
    const cookie = await loginCookie(app, 'jan@straightup-digital.de', 'admin-pass-123');

    const list = await request(app).get('/api/automations').set('Cookie', cookie);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe('demo');
    expect(list.body[0].enabled).toBe(false);

    const patched = await request(app).patch('/api/automations/demo').set('Cookie', cookie)
      .send({ enabled: true, cron: '55 8 * * 1-5' });
    expect(patched.status).toBe(200);
    expect(patched.body.cron).toBe('55 8 * * 1-5');

    expect((await request(app).patch('/api/automations/demo').set('Cookie', cookie)
      .send({ cron: 'quatsch' })).status).toBe(400);

    const run = await request(app).post('/api/automations/demo/run').set('Cookie', cookie);
    expect(run.status).toBe(202);
    expect(run.body.runId).toBeGreaterThan(0);

    // auf Abschluss warten (Ausführung ist asynchron)
    for (let i = 0; i < 50 && scheduler.statusOf('demo').running; i++) {
      await new Promise(r => setTimeout(r, 10));
    }
    const runs = await request(app).get('/api/automations/demo/runs').set('Cookie', cookie);
    expect(runs.status).toBe(200);
    expect(runs.body[0].status).toBe('ok');
    expect(runs.body[0].summary).toBe('demo gelaufen');
  });

  it('unbekannte Automation → 404', async () => {
    const { app } = makeApp();
    const cookie = await loginCookie(app, 'jan@straightup-digital.de', 'admin-pass-123');
    expect((await request(app).get('/api/automations/nix/runs').set('Cookie', cookie)).status).toBe(404);
    expect((await request(app).post('/api/automations/nix/run').set('Cookie', cookie)).status).toBe(404);
  });
});
