import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createTeamboardRouter } from '../src/routes/teamboard.js';
import { createApiAuth, type AuthContext } from '../src/services/auth.js';
import { GENERIC_ERROR_MESSAGE } from '../src/services/errors.js';
import { openDb } from '../src/core/db.js';
import { UserStore } from '../src/core/users.js';
import { SessionStore } from '../src/core/sessions.js';
import { createAuthRouter } from '../src/routes/auth.js';
import { TeamboardEinstellungenStore } from '../src/core/teamboard-einstellungen.js';
import type { ZeitenProNutzer } from '../src/services/teamboard/zeiten.js';

const MASTER_KEY = 'master-key';

// ─── Fixtures ──────────────────────────────────────────────────────

const boardStandFixture = {
  board: {
    stand: '2026-08-26T10:00:00.000Z',
    lanes: [
      { userId: 'u-lea', name: 'Lea Stöber', timer: null, aufgaben: [] },
      { userId: 'u-max', name: 'Max Mendel', timer: null, aufgaben: [] },
    ],
  },
  alterSekunden: 0,
};

const zeitenFixture: ZeitenProNutzer = {
  'u-lea': { heuteSekunden: 100, vortagSekunden: 200, wocheSekunden: 300 },
  'u-max': { heuteSekunden: 400, vortagSekunden: 500, wocheSekunden: 600 },
};

function fakeEinstellungenStore() {
  const data = new Map<string, { reihenfolge: string[] | null; ausgeblendet: string[] }>();
  return {
    get: vi.fn((userId: string) => data.get(userId) ?? { reihenfolge: null, ausgeblendet: [] }),
    set: vi.fn((userId: string, e: { reihenfolge: string[] | null; ausgeblendet: string[] }) => {
      data.set(userId, e);
    }),
  };
}

function makeDeps(overrides: Partial<Parameters<typeof createTeamboardRouter>[0]> = {}) {
  return {
    ladeBoard: vi.fn().mockResolvedValue(boardStandFixture),
    ladeZeiten: vi.fn().mockResolvedValue(zeitenFixture),
    ladeNutzerBild: vi.fn().mockResolvedValue(null),
    einstellungen: fakeEinstellungenStore(),
    ...overrides,
  };
}

// Muster B: Auth-Stub setzt res.locals.auth direkt, kein echter Login nötig.
function makeApp(deps: ReturnType<typeof makeDeps>, auth: AuthContext) {
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.auth = auth;
    next();
  });
  app.use(createTeamboardRouter(deps as any));
  return app;
}

const adminSession: AuthContext = { via: 'session', role: 'admin', user: { id: 'admin-1', email: 'jan@x.de', name: 'Jan', role: 'admin', disabledAt: null, createdAt: '2026-01-01', aworkUserId: null } };
const apiKeyAuth: AuthContext = { via: 'api-key', role: 'admin', user: undefined };

function memberAuth(aworkUserId: string | null): AuthContext {
  return {
    via: 'session',
    role: 'member',
    user: { id: 'member-1', email: 'lea@x.de', name: 'Lea', role: 'member', disabledAt: null, createdAt: '2026-01-01', aworkUserId },
  };
}

// ─── (a) GET /board ────────────────────────────────────────────────

describe('GET /api/teamboard/board', () => {
  it('via api-key ⇒ 200 + BoardStand-JSON', async () => {
    const deps = makeDeps();
    const res = await request(makeApp(deps, apiKeyAuth)).get('/api/teamboard/board');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(boardStandFixture);
  });

  it('via session ⇒ 200 + BoardStand-JSON', async () => {
    const deps = makeDeps();
    const res = await request(makeApp(deps, adminSession)).get('/api/teamboard/board');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(boardStandFixture);
  });

  it('werfender ladeBoard ⇒ 502 mit clientErrorMessage-Body, kein Stacktrace', async () => {
    const deps = makeDeps({ ladeBoard: vi.fn().mockRejectedValue(new Error('awork API 500: geheimer Pfad /interna')) });
    const res = await request(makeApp(deps, apiKeyAuth)).get('/api/teamboard/board');
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'awork_unreachable', message: GENERIC_ERROR_MESSAGE });
    expect(JSON.stringify(res.body)).not.toContain('geheimer Pfad');
    expect(res.body).not.toHaveProperty('stack');
  });
});

// ─── (b) GET /zeiten ───────────────────────────────────────────────

describe('GET /api/teamboard/zeiten', () => {
  it('via api-key ⇒ 403 (nur Session)', async () => {
    const deps = makeDeps();
    const res = await request(makeApp(deps, apiKeyAuth)).get('/api/teamboard/zeiten');
    expect(res.status).toBe(403);
    expect(deps.ladeZeiten).not.toHaveBeenCalled();
  });

  it('via session, role admin ⇒ alle Zeiten, hinweis null', async () => {
    const deps = makeDeps();
    const res = await request(makeApp(deps, adminSession)).get('/api/teamboard/zeiten');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ zeiten: zeitenFixture, hinweis: null });
  });

  it('role member mit aworkUserId ⇒ NUR der eigene Schlüssel, fremder Schlüssel fehlt', async () => {
    const deps = makeDeps();
    const res = await request(makeApp(deps, memberAuth('u-lea'))).get('/api/teamboard/zeiten');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ zeiten: { 'u-lea': zeitenFixture['u-lea'] }, hinweis: null });
    expect(res.body.zeiten).not.toHaveProperty('u-max');
    expect(JSON.stringify(res.body)).not.toContain('u-max');
  });

  it('role member ohne aworkUserId ⇒ leere Zeiten + hinweis kein_mapping', async () => {
    const deps = makeDeps();
    const res = await request(makeApp(deps, memberAuth(null))).get('/api/teamboard/zeiten');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ zeiten: {}, hinweis: 'kein_mapping' });
  });

  it('role member mit aworkUserId ohne eigenen Cache-Eintrag ⇒ Nullen statt Fehler', async () => {
    const deps = makeDeps({ ladeZeiten: vi.fn().mockResolvedValue({ 'u-max': zeitenFixture['u-max'] }) });
    const res = await request(makeApp(deps, memberAuth('u-lea'))).get('/api/teamboard/zeiten');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      zeiten: { 'u-lea': { heuteSekunden: 0, vortagSekunden: 0, wocheSekunden: 0 } },
      hinweis: null,
    });
  });
});

// ─── (b2) GET /nutzer ────────────────────────────────────────────

describe('GET /api/teamboard/nutzer', () => {
  it('role admin ⇒ 200 mit {id,name}[] aus den Board-Lanes', async () => {
    const deps = makeDeps();
    const res = await request(makeApp(deps, adminSession)).get('/api/teamboard/nutzer');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 'u-lea', name: 'Lea Stöber' },
      { id: 'u-max', name: 'Max Mendel' },
    ]);
  });

  it('role member ⇒ 403', async () => {
    const deps = makeDeps();
    const res = await request(makeApp(deps, memberAuth('u-lea'))).get('/api/teamboard/nutzer');
    expect(res.status).toBe(403);
    expect(deps.ladeBoard).not.toHaveBeenCalled();
  });
});

// ─── (c) GET/PUT /einstellungen ─────────────────────────────────

const uuidA = '11111111-1111-1111-1111-111111111111';
const uuidB = '22222222-2222-2222-2222-222222222222';
const uuidC = '33333333-3333-3333-3333-333333333333';

describe('GET/PUT /api/teamboard/einstellungen', () => {
  it('GET via api-key ⇒ 403', async () => {
    const deps = makeDeps();
    const res = await request(makeApp(deps, apiKeyAuth)).get('/api/teamboard/einstellungen');
    expect(res.status).toBe(403);
  });

  it('PUT via api-key ⇒ 403', async () => {
    const deps = makeDeps();
    const res = await request(makeApp(deps, apiKeyAuth))
      .put('/api/teamboard/einstellungen')
      .send({ reihenfolge: null, ausgeblendet: [] });
    expect(res.status).toBe(403);
  });

  it('Session-Roundtrip: PUT dann GET liefert denselben Stand', async () => {
    const deps = makeDeps();
    const app = makeApp(deps, adminSession);
    const put = await request(app)
      .put('/api/teamboard/einstellungen')
      .send({ reihenfolge: [uuidB, uuidA], ausgeblendet: [uuidC] });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ reihenfolge: [uuidB, uuidA], ausgeblendet: [uuidC] });

    const get = await request(app).get('/api/teamboard/einstellungen');
    expect(get.status).toBe(200);
    expect(get.body).toEqual({ reihenfolge: [uuidB, uuidA], ausgeblendet: [uuidC] });
  });

  it('PUT ⇒ 400 wenn reihenfolge kein Array ist', async () => {
    const deps = makeDeps();
    const res = await request(makeApp(deps, adminSession))
      .put('/api/teamboard/einstellungen')
      .send({ reihenfolge: 'nicht-array', ausgeblendet: [] });
    expect(res.status).toBe(400);
    expect(deps.einstellungen.set).not.toHaveBeenCalled();
  });

  it('PUT ⇒ 400 bei mehr als 100 Einträgen', async () => {
    const deps = makeDeps();
    const zuViele = Array.from({ length: 101 }, (_, i) => `11111111-1111-1111-1111-${String(i).padStart(12, '0')}`);
    const res = await request(makeApp(deps, adminSession))
      .put('/api/teamboard/einstellungen')
      .send({ reihenfolge: null, ausgeblendet: zuViele });
    expect(res.status).toBe(400);
    expect(deps.einstellungen.set).not.toHaveBeenCalled();
  });

  it('PUT ⇒ 400 bei Nicht-UUID-Werten', async () => {
    const deps = makeDeps();
    const res = await request(makeApp(deps, adminSession))
      .put('/api/teamboard/einstellungen')
      .send({ reihenfolge: null, ausgeblendet: ['nicht-uuid'] });
    expect(res.status).toBe(400);
    expect(deps.einstellungen.set).not.toHaveBeenCalled();
  });
});

// ─── (d) GET /avatar/:userId ─────────────────────────────────────

const avatarUuid1 = '44444444-4444-4444-4444-444444444444';
const avatarUuid2 = '55555555-5555-5555-5555-555555555555';

describe('GET /api/teamboard/avatar/:userId', () => {
  it('gültige UUID + Bild ⇒ 200, Content-Type durchgereicht, Cache-Control private/3600', async () => {
    const bild = { typ: 'image/png', bytes: Buffer.from([1, 2, 3]) };
    const deps = makeDeps({ ladeNutzerBild: vi.fn().mockResolvedValue(bild) });
    const res = await request(makeApp(deps, adminSession)).get(`/api/teamboard/avatar/${avatarUuid1}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('private, max-age=3600');
    expect(Buffer.compare(res.body, bild.bytes)).toBe(0);
  });

  it('kein Bild (null) ⇒ 404 mit Cache-Control private/600', async () => {
    const deps = makeDeps({ ladeNutzerBild: vi.fn().mockResolvedValue(null) });
    const res = await request(makeApp(deps, adminSession)).get(`/api/teamboard/avatar/${avatarUuid1}`);
    expect(res.status).toBe(404);
    expect(res.headers['cache-control']).toBe('private, max-age=600');
  });

  it('zweiter Abruf derselben bildlosen ID ⇒ Loader nur 1×', async () => {
    const deps = makeDeps({ ladeNutzerBild: vi.fn().mockResolvedValue(null) });
    const app = makeApp(deps, adminSession);
    await request(app).get(`/api/teamboard/avatar/${avatarUuid1}`);
    await request(app).get(`/api/teamboard/avatar/${avatarUuid1}`);
    expect(deps.ladeNutzerBild).toHaveBeenCalledTimes(1);
  });

  it('kaputte ID (ein Pfadsegment) ⇒ 404 no-store OHNE Loader-Aufruf', async () => {
    const deps = makeDeps();
    const res = await request(makeApp(deps, adminSession)).get('/api/teamboard/avatar/nicht-gueltig');
    expect(res.status).toBe(404);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(deps.ladeNutzerBild).not.toHaveBeenCalled();
  });

  it('werfender Loader ⇒ 404, direkt folgende ANDERE ID ruft Loader nicht (60-s-Fehlerfenster)', async () => {
    const deps = makeDeps({ ladeNutzerBild: vi.fn().mockRejectedValue(new Error('awork down')) });
    const app = makeApp(deps, adminSession);
    const erste = await request(app).get(`/api/teamboard/avatar/${avatarUuid1}`);
    expect(erste.status).toBe(404);
    expect(erste.headers['cache-control']).toBe('no-store');

    const zweite = await request(app).get(`/api/teamboard/avatar/${avatarUuid2}`);
    expect(zweite.status).toBe(404);
    expect(deps.ladeNutzerBild).toHaveBeenCalledTimes(1);
  });
});

// ─── (e) Wiring (Muster C): Router hinter /api-Auth ────────────────

describe('Wiring: /api/teamboard/* hinter der /api-Auth', () => {
  it('Request ohne Auth auf /api/teamboard/board ⇒ 401 von createApiAuth', async () => {
    const deps = makeDeps();
    const app = express();
    app.use(express.json());
    // Reihenfolge wie in src/index.ts: /api-Auth VOR dem Teamboard-Router.
    app.use('/api', createApiAuth(MASTER_KEY));
    app.use(createTeamboardRouter(deps as any));

    const res = await request(app).get('/api/teamboard/board');
    expect(res.status).toBe(401);
    expect(deps.ladeBoard).not.toHaveBeenCalled();
  });
});

// ─── (f) Muster A: echte Session-Kette ─────────────────────────────

function makeRealApp() {
  const db = openDb(':memory:');
  const users = new UserStore(db);
  const sessions = new SessionStore(db, users);
  const einstellungen = new TeamboardEinstellungenStore(db);
  const deps = makeDeps({ einstellungen: einstellungen as any });

  const app = express();
  app.use(express.json());
  app.use(createAuthRouter({ users, sessions }));
  app.use('/api', createApiAuth(MASTER_KEY, sessions));
  app.use(createTeamboardRouter(deps as any));

  const admin = users.create({ email: 'jan@straightup-digital.de', name: 'Jan', role: 'admin', password: 'admin-pass-123' });
  const member = users.create({ email: 'lea@straightup-digital.de', name: 'Lea', role: 'member', password: 'member-pass-123' });
  users.setAworkUserId(member.id, 'u-lea');

  return { app, users, sessions, admin, member, deps };
}

async function loginCookie(app: express.Express, email: string, password: string): Promise<string> {
  const res = await request(app).post('/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  const setCookie = res.headers['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  return cookies[0].split(';')[0];
}

describe('Muster A: echter Session-Login trägt awork_user_id bis res.locals.auth.user', () => {
  it('Member-Login mit gesetzter awork_user_id ⇒ /zeiten liefert genau den eigenen Schlüssel', async () => {
    const { app, member } = makeRealApp();
    const cookie = await loginCookie(app, member.email, 'member-pass-123');

    const res = await request(app).get('/api/teamboard/zeiten').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ zeiten: { 'u-lea': zeitenFixture['u-lea'] }, hinweis: null });
    expect(Object.keys(res.body.zeiten)).toEqual(['u-lea']);
  });
});
