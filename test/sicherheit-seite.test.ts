import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { createServer, type Server } from 'http';
import { format } from 'util';
import { openDb } from '../src/core/db.js';
import { UserStore } from '../src/core/users.js';
import { SessionStore, SESSION_COOKIE } from '../src/core/sessions.js';
import { ZweiterFaktorStore } from '../src/core/zweiter-faktor.js';
import { totpCode } from '../src/core/totp.js';
import { createAuthRouter } from '../src/routes/auth.js';
import { createApiAuth, createPageAuth } from '../src/services/auth.js';
import { FixedWindowLimiter } from '../src/services/rate-limit.js';
import { SicherheitSpeicher } from '../src/services/sicherheit/speicher.js';
import { DARSTELLUNG_FUNKTIONEN, kopfSatz, standAlterText, waechterText } from '../src/services/sicherheit/darstellung.js';
import {
  ZWEITER_FAKTOR_PFAD,
  createSicherheitDienstRouter,
  createSicherheitNutzerRouter,
  createSicherheitSeiteRouter,
  createSicherheitZweiterFaktorRouter,
  createZweiterFaktorPruefung,
  leseSicherheitKonfig,
} from '../src/routes/sicherheit.js';

// Sicherheitsplattform Teil 1, Task 10: die Seite /sicherheit. Zugang wie bei
// den Nutzer-Endpunkten (Task 8) und der Seite für den zweiten Faktor (Task 9):
// Session eines Kontos aus SICHERHEIT_NUTZER und bestätigter zweiter Faktor,
// sonst Anmeldung (302), 403 oder der Sprung zur Bestätigung (302). Alles läuft
// gegen die echte Kette aus Routern, Sessions, zweitem Faktor und SQLite im
// Speicher, in der Reihenfolge von src/index.ts; ersetzt ist nur die Uhr.

const MASTER_KEY = 'master-key-fuer-tests';
const DIENST_KEY = 'dienst-key-fuer-tests';
const JAN = 'jan@example.test';
const FREMD = 'fremd@example.test';
const EIGENER_HOST = 'sicherheit.example.test';
const EIGENE_ORIGIN = `http://${EIGENER_HOST}`;
const START = new Date('2026-10-24T12:00:00.000Z');
const GEHEIMNIS = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const ANSICHTEN = ['Lage', 'Flotte', 'Abdeckung', 'Aufräumen', 'Wächter'];

const BEISPIEL: any = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/sicherheit-stand.json', import.meta.url)), 'utf-8'),
);

// ─── Aufbau der App wie in src/index.ts ──────────────────────────

const offeneServer: Server[] = [];

/** Baut die App wie index.ts und startet EINEN Server an 127.0.0.1 (siehe test/sicherheit.test.ts, warum nicht supertest je Anfrage). */
async function makeApp(aufbau: { nutzer?: string | undefined } = {}) {
  const db = openDb(':memory:');
  const users = new UserStore(db);
  const sessions = new SessionStore(db, users);
  const speicher = new SicherheitSpeicher(db);
  const store = new ZweiterFaktorStore(db);
  const uhr = { jetzt: new Date(START) };
  const jetzt = () => uhr.jetzt;
  const konfig = leseSicherheitKonfig({
    SICHERHEIT_DIENSTSCHLUESSEL: DIENST_KEY,
    SICHERHEIT_NUTZER: 'nutzer' in aufbau ? aufbau.nutzer : JAN,
  });
  const deps = { speicher, ...konfig, zweiterFaktorBestaetigt: createZweiterFaktorPruefung(store, jetzt), jetzt };

  const app = express();
  app.use(createSicherheitDienstRouter(deps));
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(createAuthRouter({ users, sessions }));
  app.use('/api', createApiAuth(MASTER_KEY, sessions, new FixedWindowLimiter(100, 60_000)));
  app.use(createSicherheitNutzerRouter(deps));
  app.use(createSicherheitZweiterFaktorRouter({ ...konfig, store, pageAuth: createPageAuth(sessions, '/app/'), jetzt }));
  app.use(createSicherheitSeiteRouter({ ...konfig, pageAuth: createPageAuth(sessions, '/app/'), zweiterFaktorBestaetigt: deps.zweiterFaktorBestaetigt }));
  app.use((_req, res) => { res.status(404).json({ error: 'nicht_gefunden' }); });

  const server = createServer(app);
  offeneServer.push(server);
  await new Promise<void>((fertig) => server.listen(0, '127.0.0.1', fertig));

  /** Konto (falls nötig) und eine neue Session; die Session gilt „für immer", weil die Uhr der Tests feststeht. */
  function anmelden(email: string, role: 'admin' | 'member' = 'admin') {
    const user = users.findByEmail(email) ?? users.create({ email, name: email, role, password: 'passwort-fuer-tests' });
    const { token } = sessions.create(user.id);
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?')
      .run('2099-12-31T23:59:59.000Z', createHash('sha256').update(token).digest('hex'));
    return `${SESSION_COOKIE}=${token}`;
  }
  /** Jans Konto mit eingerichtetem zweiten Faktor und einer Session, die ihn noch nicht bestätigt hat. */
  function mitFaktor(): string {
    const cookie = anmelden(JAN);
    db.prepare('UPDATE users SET totp_geheimnis = ? WHERE email = ?').run(GEHEIMNIS, JAN);
    return cookie;
  }
  /** Bestätigt die Session über die Seite des zweiten Faktors, wie im Browser. */
  async function bestaetigen(cookie: string) {
    const res = await request(server).post(ZWEITER_FAKTOR_PFAD).set('Cookie', cookie).set('Host', EIGENER_HOST)
      .set('Origin', EIGENE_ORIGIN).type('form').send({ code: totpCode(GEHEIMNIS, uhr.jetzt.getTime()) });
    expect([res.status, res.headers.location]).toEqual([303, '/sicherheit']);
  }
  return { app: server, speicher, uhr, anmelden, mitFaktor, bestaetigen };
}

const seite = (app: Server, cookie?: string) => {
  const r = request(app).get('/sicherheit');
  return cookie ? r.set('Cookie', cookie) : r;
};

/** Der Inhalt eines Skript-Blocks der Seite. */
function skript(html: string, kennung: string | null): string {
  const bloecke = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
  const block = bloecke.find((b) => (kennung === null ? !b[1].includes('id=') : b[1].includes(`id="${kennung}"`)));
  if (!block) throw new Error(`Skript ${kennung ?? '(Seite)'} fehlt`);
  return block[2];
}

let protokoll: string[];
beforeEach(() => {
  protokoll = [];
  for (const kanal of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, kanal).mockImplementation((...args: unknown[]) => { protokoll.push(format(...args)); });
  }
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(offeneServer.splice(0).map((server) => new Promise<void>((fertig) => {
    server.close(() => fertig());
    server.closeAllConnections();
  })));
});

// ═════════════════════════════════════════════════════════════════
// Zugang
// ═════════════════════════════════════════════════════════════════

describe('Zugang zur Seite /sicherheit', () => {
  it('seite_ohne_session_302: ohne gültige Session geht es zur Anmeldung, auch mit Master-Key', async () => {
    const { app, anmelden } = await makeApp();
    anmelden(JAN); // das Konto gibt es, der Aufrufer ist nur nicht angemeldet
    const faelle: [string, request.Test][] = [
      ['ohne Cookie', seite(app)],
      ['mit Master-Key', seite(app).set('X-API-Key', MASTER_KEY)],
      ['mit erfundenem Cookie', seite(app, `${SESSION_COOKIE}=gibt-es-nicht`)],
    ];
    for (const [name, aufruf] of faelle) {
      const res = await aufruf;
      expect(res.status, name).toBe(302);
      expect(res.headers.location, name).toBe('/app/?next=%2Fsicherheit');
      expect(res.text, name).not.toContain('tab-lage');
    }
  });

  it('seite_fremdes_konto_403: ein Konto, das nicht in SICHERHEIT_NUTZER steht, bekommt 403, auch als Admin', async () => {
    const { app, anmelden } = await makeApp();
    const res = await seite(app, anmelden(FREMD, 'admin'));
    expect(res.status).toBe(403);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toContain('keinen Zugang');
    expect(res.text).not.toContain('tab-lage');
    expect(protokoll.join('\n')).toMatch(/Zugriff verweigert \(konto\) von \S+: GET \/sicherheit/);
  });

  it('seite_ohne_zweiten_faktor_weiter: ohne bestätigten zweiten Faktor 302 zur Bestätigung, danach die Seite', async () => {
    const ctx = await makeApp();
    // Noch gar nicht eingerichtet: auch dorthin, die Seite richtet ihn dann ein.
    const ohneGeheimnis = await seite(ctx.app, ctx.anmelden(JAN));
    expect([ohneGeheimnis.status, ohneGeheimnis.headers.location]).toEqual([302, ZWEITER_FAKTOR_PFAD]);
    // Eingerichtet, aber diese Session hat noch keinen Code eingegeben.
    const cookie = ctx.mitFaktor();
    const vorher = await seite(ctx.app, cookie);
    expect([vorher.status, vorher.headers.location]).toEqual([302, ZWEITER_FAKTOR_PFAD]);
    expect(vorher.headers['cache-control']).toBe('no-store');
    expect(vorher.text).not.toContain('tab-lage');
    // Nach dem Code führt der Sprung der Bestätigung (303 /sicherheit) auf die Seite.
    await ctx.bestaetigen(cookie);
    expect((await seite(ctx.app, cookie)).status).toBe(200);
    // Nach 12 Stunden fragt sie wieder.
    ctx.uhr.jetzt = new Date(START.getTime() + 12 * 60 * 60 * 1000);
    const spaeter = await seite(ctx.app, cookie);
    expect([spaeter.status, spaeter.headers.location]).toEqual([302, ZWEITER_FAKTOR_PFAD]);
  });

  it('seite_ohne_konfiguration_503: fehlt SICHERHEIT_NUTZER, ist die Seite aus, mit und ohne Anmeldung', async () => {
    const { app, anmelden } = await makeApp({ nutzer: undefined });
    for (const antwort of [await seite(app, anmelden(JAN)), await seite(app)]) {
      expect(antwort.status).toBe(503);
      expect(antwort.text).toContain('nicht eingerichtet');
      expect(antwort.text).not.toContain('tab-lage');
    }
  });
});

// ═════════════════════════════════════════════════════════════════
// Die Seite
// ═════════════════════════════════════════════════════════════════

describe('Die Seite /sicherheit', () => {
  async function bestaetigteSeite() {
    const ctx = await makeApp();
    const cookie = ctx.mitFaktor();
    await ctx.bestaetigen(cookie);
    ctx.speicher.speichereStand(BEISPIEL, START);
    const res = await seite(ctx.app, cookie);
    return { ...ctx, cookie, res };
  }

  it('seite_mit_allem_200_mit_ansichten: die fünf Ansichten der Anprobe ohne Welle, als HTML, nie im Cache', async () => {
    const { res } = await bestaetigteSeite();
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html; charset=utf-8/);
    expect(res.headers['cache-control']).toBe('no-store');
    const html: string = res.text;
    const reiter = [...html.matchAll(/<button[^>]*role="tab"[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
    expect(reiter).toEqual(ANSICHTEN);
    for (const id of ['lage', 'flotte', 'abdeckung', 'aufraeumen', 'waechter']) {
      expect(html).toContain(`id="tab-${id}"`);
      expect(html).toMatch(new RegExp(`<section[^>]*id="${id}"[^>]*role="tabpanel"`));
    }
    expect(html).not.toMatch(/Welle/);
    expect(html).toContain('id="akte"');
    // Die Daten kommen aus der API, nicht aus der Seite: kein Kundenname, keine Site im Dokument.
    expect(html).toContain('/api/sicherheit/stand');
    expect(html).not.toContain(BEISPIEL.flotte.find((z: any) => z.kunde).kunde.firma);
    expect(html).not.toContain(BEISPIEL.lage[0].site);
  });

  it('nichts von fremden Origins, kein Geviertstrich, beide Skripte sind gültiges JavaScript', async () => {
    const { res } = await bestaetigteSeite();
    const html: string = res.text;
    expect(html).not.toMatch(/https?:\/\//); // keine Fonts, Skripte, Bilder oder Aufrufe von außen
    expect(html).not.toMatch(/@import|@font-face/);
    expect(html).not.toContain('\u2014');
    expect(html).not.toContain('__name(');
    expect(html).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    // eslint-disable-next-line no-new-func
    expect(() => new Function(skript(html, 'darstellung'))).not.toThrow();
    // eslint-disable-next-line no-new-func
    expect(() => new Function(skript(html, null))).not.toThrow();
  });

  it('die reinen Funktionen stehen alle im Skript und rechnen dort wie auf dem Server', async () => {
    const { res } = await bestaetigteSeite();
    const quelle = skript(res.text, 'darstellung');
    const namen = DARSTELLUNG_FUNKTIONEN.map((f) => f.name);
    // eslint-disable-next-line no-new-func
    const imSkript = new Function(`${quelle}\nreturn { ${namen.join(', ')} };`)() as Record<string, (...a: unknown[]) => unknown>;
    for (const name of namen) expect(typeof imSkript[name], name).toBe('function');
    expect(imSkript.standAlterText(119)).toEqual(standAlterText(119));
    expect(imSkript.standAlterText(121)).toEqual(standAlterText(121));
    expect(imSkript.kopfSatz(BEISPIEL.kennzahlen)).toBe(kopfSatz(BEISPIEL.kennzahlen));
    expect(imSkript.waechterText(BEISPIEL.runde, BEISPIEL.waechter.quellen)).toEqual(waechterText(BEISPIEL.runde, BEISPIEL.waechter.quellen));
  });

  it('mit der Session der Seite liefert die API den Stand, den die Seite rendert', async () => {
    const { app, cookie } = await bestaetigteSeite();
    const api = await request(app).get('/api/sicherheit/stand').set('Cookie', cookie);
    expect(api.status).toBe(200);
    expect(api.body.stand).toEqual(BEISPIEL);
  });
});
