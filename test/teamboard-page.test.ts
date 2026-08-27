import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { openDb } from '../src/core/db.js';
import { UserStore } from '../src/core/users.js';
import { SessionStore } from '../src/core/sessions.js';
import { createAuthRouter } from '../src/routes/auth.js';
import { createPageAuth } from '../src/services/auth.js';
import { createTeamboardPageRouter } from '../src/routes/teamboard.js';
import type { BoardLader, BoardStand } from '../src/services/teamboard/daten.js';
import type { Betrachter } from '../src/services/teamboard/seite.js';

const STUB_MARKER = 'STUB-RENDER-MARKER';

const boardStandFixture: BoardStand = {
  board: {
    stand: '2026-08-26T10:00:00.000Z',
    lanes: [{ userId: 'u-lea', name: 'Lea Stöber', timer: null, aufgaben: [] }],
  },
  alterSekunden: 0,
};

// ─── Test-App (Muster A, s. test/hub-routes.test.ts) ────────────────
// Guard + Seiten-Router werden hier zusammengesteckt, so wie index.ts es
// tut (Task 8, Fix-Runde 1): der Guard wird dem Router als Route-Middleware
// (deps.pageAuth) übergeben und NUR auf GET /teamboard registriert, statt
// global vorgeschaltet zu sein — mit injiziertem ladeBoard/renderSeite-Stub
// statt dem echten renderSeite.

function makeApp(
  opts: {
    ladeBoard?: BoardLader;
    // Task 8, Fix-Runde 1: der Stub trägt den Betrachter-Parameter mit —
    // sonst könnte diese Datei einen Page-Router, der ihn vergisst, nie
    // bemerken (weniger Parameter sind zuweisbar und compilieren stumm).
    renderSeite?: (stand: BoardStand, betrachter: Betrachter | null) => string;
  } = {},
) {
  const db = openDb(':memory:');
  const users = new UserStore(db);
  const sessions = new SessionStore(db, users);

  const ladeBoard = opts.ladeBoard ?? (async () => boardStandFixture);
  const renderSeite =
    opts.renderSeite ??
    ((stand, betrachter) =>
      `<!doctype html><p>${STUB_MARKER} ${stand.board.lanes.length} ${JSON.stringify(betrachter)}</p>`);

  const app = express();
  app.use(express.json());
  app.use(createAuthRouter({ users, sessions }));
  app.use(createTeamboardPageRouter({ ladeBoard, renderSeite, pageAuth: createPageAuth(sessions, '/app/') }));

  const member = users.create({ email: 'team@straightup-digital.de', name: 'Team', role: 'member', password: 'member-pass-123' });
  // awork-Zuordnung, damit der durchgereichte Betrachter unterscheidbar ist.
  users.setAworkUserId(member.id, 'u-lea');
  return { app, db, users, sessions, member };
}

async function loginCookie(app: express.Express, email: string, password: string): Promise<string> {
  const res = await request(app).post('/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  const setCookie = res.headers['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  return cookies[0].split(';')[0];
}

describe('GET /teamboard — Session-Guard', () => {
  it('(a) ohne Cookie → 302 auf /app/?next=%2Fteamboard', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/teamboard');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/app/?next=%2Fteamboard');
  });

  it('(b) mit gültiger Session → 200, text/html, Body enthält den renderSeite-Stub-Marker', async () => {
    const { app, member } = makeApp();
    const cookie = await loginCookie(app, member.email, 'member-pass-123');
    const res = await request(app).get('/teamboard').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain(STUB_MARKER);
  });

  it('(b2) reicht den Betrachter des Aufrufers an renderSeite durch (Task 8, Fix-Runde 1)', async () => {
    const { app, member } = makeApp();
    const cookie = await loginCookie(app, member.email, 'member-pass-123');
    const res = await request(app).get('/teamboard').set('Cookie', cookie);
    expect(res.status).toBe(200);
    // Der Seiten-Router muss den Betrachter selbst aus der Session bilden —
    // BoardStand trägt ihn nicht.
    expect(res.text).toContain('{"aworkUserId":"u-lea","istAdmin":false}');
  });

  it('(c) abgelaufene Session → 302', async () => {
    const { app, db, member } = makeApp();
    const cookie = await loginCookie(app, member.email, 'member-pass-123');
    db.exec("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'");
    const res = await request(app).get('/teamboard').set('Cookie', cookie);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/app/?next=%2Fteamboard');
  });

  it('(c) widerrufene Session → 302', async () => {
    const { app, sessions, member } = makeApp();
    const cookie = await loginCookie(app, member.email, 'member-pass-123');
    const token = cookie.slice(cookie.indexOf('=') + 1);
    sessions.delete(token);
    const res = await request(app).get('/teamboard').set('Cookie', cookie);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/app/?next=%2Fteamboard');
  });

  it('(a) kaputtes/fremdes Cookie (unbekannter Token) → 302, kein Absturz', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/teamboard').set('Cookie', 'su_session=frei-erfundener-token');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/app/?next=%2Fteamboard');
  });

  it('(d) werfender ladeBoard → 503-HTML mit Kaltstart-Meldung + Refresh-Meta (wörtlich aus Stufe 1)', async () => {
    const { app, member } = makeApp({
      ladeBoard: async () => {
        throw new Error('awork nicht erreichbar');
      },
    });
    const cookie = await loginCookie(app, member.email, 'member-pass-123');
    const res = await request(app).get('/teamboard').set('Cookie', cookie);
    expect(res.status).toBe(503);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toBe(
      '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="30"><title>Teamboard</title><p>awork ist gerade nicht erreichbar — nächster Versuch in 30 Sekunden.</p>',
    );
  });

  it('(d) werfendes renderSeite → 500-HTML ohne Stacktrace (wörtlich aus Stufe 1)', async () => {
    const { app, member } = makeApp({
      renderSeite: () => {
        throw new Error('render kaputt: /Users/jan/geheimer/pfad');
      },
    });
    const cookie = await loginCookie(app, member.email, 'member-pass-123');
    const res = await request(app).get('/teamboard').set('Cookie', cookie);
    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toBe('<!doctype html><meta charset="utf-8"><title>Fehler</title><p>Interner Fehler</p>');
    expect(res.text).not.toContain('geheimer');
    expect(res.text).not.toContain('Error');
  });
});
