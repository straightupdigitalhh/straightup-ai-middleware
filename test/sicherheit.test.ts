import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { createServer, type Server } from 'http';
import { format } from 'util';
import { openDb } from '../src/core/db.js';
import { UserStore } from '../src/core/users.js';
import { SessionStore, SESSION_COOKIE } from '../src/core/sessions.js';
import { createAuthRouter } from '../src/routes/auth.js';
import { createApiAuth, getAuth } from '../src/services/auth.js';
import { FixedWindowLimiter } from '../src/services/rate-limit.js';
import { SicherheitSpeicher } from '../src/services/sicherheit/speicher.js';
import {
  createSicherheitDienstRouter,
  createSicherheitNutzerRouter,
  leseSicherheitKonfig,
} from '../src/routes/sicherheit.js';

// Sicherheitsplattform Teil 1, Task 8: Speicher und API in der Middleware.
// Der Kern schiebt alle fünf Minuten den Stand und holt Aufträge ab (Dienst-
// Endpunkte, Header X-Dienst-Schluessel); das Dashboard liest den Stand und
// legt Aufträge an (Nutzer-Endpunkte: Session, Konto aus SICHERHEIT_NUTZER,
// zweiter Faktor). Alle Tests laufen gegen die echte Kette aus Routern,
// /api-Auth und SQLite im Speicher; nur der zweite Faktor (Task 9) und die
// Uhr sind ersetzbar. Beispieldaten: test/fixtures/sicherheit-stand.json.

const MASTER_KEY = 'master-key-fuer-tests';
const DIENST_KEY = 'dienst-key-fuer-tests';
const DIENST = 'X-Dienst-Schluessel';
const JAN = 'jan@example.test';
const EIGENER_HOST = 'sicherheit.example.test';
const EIGENE_ORIGIN = `http://${EIGENER_HOST}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const START = new Date('2026-10-24T12:00:00.000Z');

// ─── Beispiel-Stand ──────────────────────────────────────────────

const BEISPIEL: any = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/sicherheit-stand.json', import.meta.url)), 'utf-8'),
);
/** Eine Lage-Zeile einer echten Site (keine Sammel- oder Quellenzeile): Vorbild für die Befund-Aufträge. */
const BEFUND = BEISPIEL.lage.find((z: any) => !z.site.startsWith('_'));
const SITE: string = BEFUND.site;
/** Ein Kundenname aus dem Beispiel: darf nie im Log stehen. */
const FIRMA: string = BEISPIEL.flotte.find((z: any) => z.kunde).kunde.firma;

/** Ein kleiner Stand, in dem die Site genau in einem Abschnitt steht. */
function kleinerStand(abschnitt: string, site: string): any {
  const stand: any = { version: 1, lage: [], flotte: [], nichtUeberwacht: [], abdeckung: { neu: [], ohneMysites: [], premiumUnbestaetigt: [], widersprueche: [] } };
  if (abschnitt.startsWith('abdeckung.')) stand.abdeckung[abschnitt.slice('abdeckung.'.length)].push({ site });
  else stand[abschnitt].push({ site });
  return stand;
}

// ─── Aufbau der App wie in src/index.ts ──────────────────────────

interface Aufbau {
  dienstSchluessel?: string | undefined;
  nutzer?: string | undefined;
  fehlversuche?: FixedWindowLimiter;
  trustProxy?: boolean;
  zweiterFaktorBestaetigt?: (req: express.Request, res: express.Response) => boolean;
}

/** Die Testserver, die ein Test geöffnet hat; afterEach schließt sie. */
const offeneServer: Server[] = [];

/**
 * Baut die App wie in index.ts und startet EINEN Server dafür, gezielt an
 * 127.0.0.1 gebunden. supertest bände sonst für jede einzelne Anfrage einen
 * Server auf dem Wildcard-Port und riefe 127.0.0.1:<Port> an. Hält ein fremder
 * Prozess auf 127.0.0.1 dieselbe Portnummer (macOS lässt das zu, hier etwa ein
 * Lima-Portforward), antwortet er statt des Testservers, und der Test scheitert
 * zufällig mit "Parse Error" oder einer Zeitüberschreitung. Die Datei stellt
 * rund 600 Anfragen, das träfe jeden 25. Lauf.
 */
async function makeApp(aufbau: Aufbau = {}) {
  const db = openDb(':memory:');
  const users = new UserStore(db);
  const sessions = new SessionStore(db, users);
  const speicher = new SicherheitSpeicher(db);
  const uhr = { jetzt: new Date(START) };
  const faktor = { bestaetigt: true };
  const konfig = leseSicherheitKonfig({
    SICHERHEIT_DIENSTSCHLUESSEL: 'dienstSchluessel' in aufbau ? aufbau.dienstSchluessel : DIENST_KEY,
    SICHERHEIT_NUTZER: 'nutzer' in aufbau ? aufbau.nutzer : JAN,
  });
  const deps = {
    speicher,
    ...konfig,
    zweiterFaktorBestaetigt: aufbau.zweiterFaktorBestaetigt ?? (() => faktor.bestaetigt),
    fehlversuche: aufbau.fehlversuche,
    jetzt: () => uhr.jetzt,
  };

  const app = express();
  if (aufbau.trustProxy) app.set('trust proxy', 1);
  // Reihenfolge wie in src/index.ts: der Dienst-Router steht VOR dem globalen
  // 5-MB-Parser (eigene Grenzen) und vor der /api-Auth, der Nutzer-Router dahinter.
  app.use(createSicherheitDienstRouter(deps));
  app.use(express.json({ limit: '5mb' }));
  app.use(createAuthRouter({ users, sessions }));
  app.use('/api', createApiAuth(MASTER_KEY, sessions, new FixedWindowLimiter(100, 60_000)));
  app.use(createSicherheitNutzerRouter(deps));
  app.use((_req, res) => { res.status(404).json({ error: 'nicht_gefunden' }); });

  const server = createServer(app);
  offeneServer.push(server);
  await new Promise<void>((fertig) => server.listen(0, '127.0.0.1', fertig));

  /** Legt ein Konto samt Session an und liefert den Cookie-Header. */
  function anmelden(email: string, role: 'admin' | 'member' = 'admin'): string {
    const user = users.create({ email, name: email, role, password: 'passwort-fuer-tests' });
    return `${SESSION_COOKIE}=${sessions.create(user.id).token}`;
  }
  return { app: server, db, users, speicher, uhr, faktor, anmelden };
}

// ─── Aufrufe ─────────────────────────────────────────────────────

/** JSON-Körper, auch wenn er kein Objekt ist (superagent könnte eine Zahl oder null nicht senden). */
const alsJson = (r: request.Test, koerper: unknown) => r.set('Content-Type', 'application/json').send(JSON.stringify(koerper));

const dienst = (app: Server) => ({
  stand: (koerper: unknown, schluessel = DIENST_KEY) => alsJson(request(app).post('/api/sicherheit/stand').set(DIENST, schluessel), koerper),
  offene: (schluessel = DIENST_KEY) => request(app).get('/api/sicherheit/auftraege?offen=1').set(DIENST, schluessel),
  quittung: (id: string, koerper: unknown, schluessel = DIENST_KEY) =>
    alsJson(request(app).post(`/api/sicherheit/auftraege/${encodeURIComponent(id)}/quittung`).set(DIENST, schluessel), koerper),
});

const nutzer = (app: Server, cookie: string) => ({
  stand: () => request(app).get('/api/sicherheit/stand').set('Cookie', cookie),
  verlauf: (suche = '') => request(app).get(`/api/sicherheit/auftraege${suche}`).set('Cookie', cookie),
  anlegen: (koerper: unknown, origin: string | null = EIGENE_ORIGIN) => {
    const r = request(app).post('/api/sicherheit/auftraege').set('Cookie', cookie).set('Host', EIGENER_HOST);
    if (origin !== null) r.set('Origin', origin);
    return r.send(koerper as object);
  },
});

/** App mit Beispiel-Stand und angemeldetem Nutzer, der alles darf. */
async function bereit(aufbau: Aufbau = {}) {
  const ctx = await makeApp(aufbau);
  const cookie = ctx.anmelden(JAN);
  const gespeichert = await dienst(ctx.app).stand(BEISPIEL);
  expect(gespeichert.status).toBe(200);
  return { ...ctx, cookie, dienst: dienst(ctx.app), nutzer: nutzer(ctx.app, cookie) };
}

// ─── Protokoll mitschreiben (und die Testausgabe sauber halten) ──

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
// Konfiguration
// ═════════════════════════════════════════════════════════════════

describe('Konfiguration', () => {
  it('leseSicherheitKonfig: Schlüssel getrimmt, Konten klein geschrieben und getrimmt, Leeres zählt als fehlend', () => {
    expect(leseSicherheitKonfig({ SICHERHEIT_DIENSTSCHLUESSEL: '  abc \n', SICHERHEIT_NUTZER: ' Jan@Example.test , ,andere@example.test ' }))
      .toEqual({ dienstSchluessel: 'abc', nutzer: ['jan@example.test', 'andere@example.test'] });
    expect(leseSicherheitKonfig({})).toEqual({ dienstSchluessel: undefined, nutzer: [] });
    expect(leseSicherheitKonfig({ SICHERHEIT_DIENSTSCHLUESSEL: '   ', SICHERHEIT_NUTZER: ' , ' }))
      .toEqual({ dienstSchluessel: undefined, nutzer: [] });
  });

  const fehlend: [string, Aufbau][] = [
    ['ohne Dienstschlüssel', { dienstSchluessel: undefined }],
    ['mit leerem Dienstschlüssel', { dienstSchluessel: '   ' }],
    ['ohne Konten', { nutzer: undefined }],
    ['mit leerer Kontenliste', { nutzer: ' , ' }],
  ];
  for (const [name, aufbau] of fehlend) {
    it(`ohne_konfiguration_503: ${name} antwortet jeder Endpunkt unter /api/sicherheit mit 503, Dienst wie Nutzer`, async () => {
      const { app, anmelden } = await makeApp(aufbau);
      const cookie = anmelden(JAN);
      const n = nutzer(app, cookie);
      const antworten = [
        await dienst(app).stand({ version: 1 }),
        await dienst(app).offene(),
        await dienst(app).quittung('irgendeine-id', { ok: true, text: 'x' }),
        await n.stand(),
        await n.verlauf(),
        await n.anlegen({ art: 'ueberwachen', site: SITE, werte: {} }),
        await request(app).get('/api/sicherheit/stand'), // auch ohne jede Anmeldung
      ];
      for (const antwort of antworten) {
        expect(antwort.status).toBe(503);
        expect(antwort.body.error).toBe('nicht_konfiguriert');
      }
    });
  }

  it('ohne_konfiguration_503 (Gegenprobe): mit beiden Werten läuft die Funktion, andere /api-Pfade bleiben unberührt', async () => {
    const { app } = await makeApp();
    expect((await dienst(app).stand({ version: 1 })).status).toBe(200);
    expect((await request(app).get('/api/anderes')).status).toBe(401); // weiter hinter der Master-Key-Auth
  });
});

// ═════════════════════════════════════════════════════════════════
// Dienst-Endpunkte: Schlüssel, Drosselung, keine Session, kein Master-Key
// ═════════════════════════════════════════════════════════════════

describe('Dienst-Endpunkte: Schlüssel', () => {
  it('ohne_dienstschluessel_401: ohne oder mit falschem Schlüssel antwortet jeder Dienst-Endpunkt 401 und ändert nichts', async () => {
    const { app, speicher } = await makeApp();
    const id = speicher.legeAuftragAn({ art: 'ueberwachen', site: SITE, werte: {}, durch: JAN });
    for (const schluessel of [undefined, '', 'falsch', DIENST_KEY + 'x', DIENST_KEY.slice(0, -1)]) {
      const mit = (r: request.Test) => (schluessel === undefined ? r : r.set(DIENST, schluessel));
      const antworten = [
        await mit(request(app).post('/api/sicherheit/stand')).send(BEISPIEL),
        await mit(request(app).get('/api/sicherheit/auftraege?offen=1')),
        await mit(request(app).post(`/api/sicherheit/auftraege/${id}/quittung`)).send({ ok: true, text: 'x' }),
      ];
      for (const antwort of antworten) {
        expect(antwort.status, `Schlüssel ${JSON.stringify(schluessel)}`).toBe(401);
        expect(antwort.body.error).toBe('invalid_key');
      }
    }
    expect(speicher.aktuellerStand()).toBeNull();
    expect(speicher.offeneAuftraege()).toHaveLength(1); // nicht quittiert
  });

  it('dienst_endpunkte_ohne_session_und_ohne_master_key: weder Session noch X-API-Key öffnen sie, und umgekehrt öffnet der Dienstschlüssel keinen Nutzer-Endpunkt', async () => {
    const { app, speicher, anmelden } = await makeApp();
    const cookie = anmelden(JAN);
    const id = speicher.legeAuftragAn({ art: 'ueberwachen', site: SITE, werte: {}, durch: JAN });
    for (const kopf of [{ Cookie: cookie }, { 'X-API-Key': MASTER_KEY }, { Cookie: cookie, 'X-API-Key': MASTER_KEY }]) {
      const antworten = [
        await request(app).post('/api/sicherheit/stand').set(kopf).send(BEISPIEL),
        await request(app).get('/api/sicherheit/auftraege?offen=1').set(kopf),
        await request(app).post(`/api/sicherheit/auftraege/${id}/quittung`).set(kopf).send({ ok: true, text: 'x' }),
      ];
      for (const antwort of antworten) expect(antwort.status, JSON.stringify(Object.keys(kopf))).toBe(401);
    }
    expect(speicher.aktuellerStand()).toBeNull();
    expect(speicher.verlauf()[0].status).toBe('offen');

    // Umgekehrt: der Dienstschlüssel allein ist kein Nutzer (die /api-Auth antwortet 401).
    for (const antwort of [
      await request(app).get('/api/sicherheit/stand').set(DIENST, DIENST_KEY),
      await request(app).get('/api/sicherheit/auftraege').set(DIENST, DIENST_KEY),
      await request(app).post('/api/sicherheit/auftraege').set(DIENST, DIENST_KEY).set('Host', EIGENER_HOST).set('Origin', EIGENE_ORIGIN)
        .send({ art: 'ueberwachen', site: SITE, werte: {} }),
    ]) {
      expect(antwort.status).toBe(401);
    }
  });

  it('fehlversuche_werden_gedrosselt: nach dem Limit 429 mit Retry-After, auch mit richtigem Schlüssel; die IP steht im Log, kein Schlüssel', async () => {
    const { app } = await makeApp({ trustProxy: true, fehlversuche: new FixedWindowLimiter(3, 60_000) });
    const ip = '203.0.113.7';
    const aufruf = (schluessel: string, von = ip) => request(app).get('/api/sicherheit/auftraege?offen=1').set('X-Forwarded-For', von).set(DIENST, schluessel);
    for (let i = 0; i < 3; i++) expect((await aufruf(`falsch-${i}`)).status).toBe(401);

    const gesperrt = await aufruf(DIENST_KEY);
    expect(gesperrt.status).toBe(429);
    expect(gesperrt.body.error).toBe('rate_limited');
    expect(Number(gesperrt.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect((await aufruf(DIENST_KEY, '203.0.113.8')).status).toBe(200); // andere IP unberührt

    const log = protokoll.join('\n');
    expect(log).toContain(ip);
    expect(log).not.toContain(DIENST_KEY);
    expect(log).not.toContain('falsch-');
  });

  it('kern_aufrufe_ohne_weiterleitung: genau die Aufrufe des Kerns, auch mit Schrägstrich am Ende, werden direkt mit 200 beantwortet (der Kern wertet jedes 3xx als Fehler)', async () => {
    const { app, speicher } = await makeApp();
    const id = speicher.legeAuftragAn({ art: 'durchgesehen', site: SITE, werte: {}, durch: JAN });
    for (const ende of ['', '/']) {
      const stand = await request(app).post(`/api/sicherheit/stand${ende}`).set(DIENST, DIENST_KEY).send(BEISPIEL);
      expect([stand.status, stand.body]).toEqual([200, { ok: true }]);
      const offen = await request(app).get(`/api/sicherheit/auftraege${ende}?offen=1`).set(DIENST, DIENST_KEY);
      expect([offen.status, offen.body.auftraege.map((a: any) => a.id)]).toEqual([200, [id]]);
    }
    const quittung = await request(app).post(`/api/sicherheit/auftraege/${id}/quittung/`).set(DIENST, DIENST_KEY).send({ ok: true, text: 'x' });
    expect([quittung.status, quittung.body]).toEqual([200, { ok: true }]);
  });
});

// ═════════════════════════════════════════════════════════════════
// Stand
// ═════════════════════════════════════════════════════════════════

describe('Stand', () => {
  it('stand_wird_ersetzt: der zweite Stand ersetzt den ersten ganz, auch für die Prüfung der Sites', async () => {
    const { app, uhr, anmelden } = await makeApp();
    const cookie = anmelden(JAN);
    const n = nutzer(app, cookie);

    const leer = await n.stand();
    expect(leer.status).toBe(200);
    expect(leer.body).toEqual({ stand: null, empfangenIso: null, alterMinuten: null });

    const gepusht = await dienst(app).stand(BEISPIEL);
    expect([gepusht.status, gepusht.body]).toEqual([200, { ok: true }]);
    const erster = await n.stand();
    expect(erster.status).toBe(200);
    expect(erster.body.stand).toEqual(BEISPIEL);
    expect(erster.body.empfangenIso).toBe(START.toISOString());
    expect(erster.body.alterMinuten).toBe(0);
    expect((await n.anlegen({ art: 'ueberwachen', site: SITE, werte: {} })).status).toBe(200);

    uhr.jetzt = new Date(START.getTime() + 5 * 60_000);
    const zweiterStand = kleinerStand('flotte', 'zweite-site.test');
    expect((await dienst(app).stand(zweiterStand)).status).toBe(200);
    const zweiter = await n.stand();
    expect(zweiter.body.stand).toEqual(zweiterStand); // nicht gemischt
    expect(zweiter.body.empfangenIso).toBe(uhr.jetzt.toISOString());
    expect((await n.anlegen({ art: 'ueberwachen', site: SITE, werte: {} })).body.error).toBe('unbekannte_site');
    expect((await n.anlegen({ art: 'ueberwachen', site: 'zweite-site.test', werte: {} })).status).toBe(200);
  });

  it('stand_antwort_ist_der_unveraenderte_inhalt: auch Felder, die die Middleware nicht kennt, kommen heil durch', async () => {
    const { app, anmelden } = await makeApp();
    const stand = { ...BEISPIEL, neuesFeld: { tief: [1, 2, { x: null }] }, umlaute: 'äöü ß „Zitat“' };
    await dienst(app).stand(stand);
    expect((await nutzer(app, anmelden(JAN)).stand()).body.stand).toEqual(stand);
  });

  it('falsche_version_400: fehlende, andere oder falsch getypte Version und Nicht-Objekte werden abgewiesen, der alte Stand bleibt', async () => {
    const { app, speicher } = await makeApp();
    await dienst(app).stand(BEISPIEL);
    const vorher = speicher.aktuellerStand();
    const faelle: unknown[] = [{}, { ...BEISPIEL, version: 2 }, { ...BEISPIEL, version: '1' }, { ...BEISPIEL, version: 0 }, { ...BEISPIEL, version: null }, [BEISPIEL], [], 'text', 42, null];
    for (const koerper of faelle) {
      const res = await dienst(app).stand(koerper);
      expect(res.status, JSON.stringify(koerper).slice(0, 40)).toBe(400);
      expect(res.body.error).toBe('validation');
    }
    expect(speicher.aktuellerStand()).toEqual(vorher);
  });

  it('kaputtes_json_400: ein Körper, der kein JSON ist, bekommt 400 als JSON, nicht die HTML-Fehlerseite', async () => {
    const { app } = await makeApp();
    const res = await request(app).post('/api/sicherheit/stand').set(DIENST, DIENST_KEY).set('Content-Type', 'application/json').send('{"version": 1,');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation');
  });

  it('stand_bis_10_mb: ein Stand über dem globalen 5-MB-Limit, aber unter 10 MB wird angenommen', async () => {
    const { app, speicher } = await makeApp();
    const gross = { ...BEISPIEL, fueller: 'x'.repeat(6 * 1024 * 1024) };
    const res = await dienst(app).stand(gross);
    expect(res.status).toBe(200);
    expect(speicher.aktuellerStand()?.stand.fueller).toHaveLength(6 * 1024 * 1024);
  });

  it('stand_ueber_10_mb_413: ein größerer Stand wird mit 413 als JSON abgewiesen, der alte bleibt; das globale Limit für andere Pfade ist unverändert', async () => {
    const { app, speicher, anmelden } = await makeApp();
    await dienst(app).stand(BEISPIEL);
    const vorher = speicher.aktuellerStand();
    const res = await dienst(app).stand({ ...BEISPIEL, fueller: 'x'.repeat(11 * 1024 * 1024) });
    expect(res.status).toBe(413);
    expect(res.body.error).toBe('payload_too_large');
    expect(speicher.aktuellerStand()).toEqual(vorher);

    // Ein Auftrag, der größer ist als das globale 5-MB-Limit, scheitert weiter am globalen Parser.
    const cookie = anmelden(JAN);
    const zuGross = await nutzer(app, cookie).anlegen({ art: 'nicht-ueberwacht', site: SITE, werte: { grund: 'x'.repeat(6 * 1024 * 1024) } });
    expect(zuGross.status).toBe(413);
  });

  it('alter_in_minuten: abgerundet, nie negativ', async () => {
    const { app, uhr, anmelden } = await makeApp();
    const n = nutzer(app, anmelden(JAN));
    await dienst(app).stand(BEISPIEL);
    for (const [vergangen, erwartet] of [[0, 0], [59_000, 0], [60_000, 1], [119 * 60_000 + 59_000, 119], [120 * 60_000, 120], [-5 * 60_000, 0]] as const) {
      uhr.jetzt = new Date(START.getTime() + vergangen);
      expect((await n.stand()).body.alterMinuten, `nach ${vergangen} ms`).toBe(erwartet);
    }
  });
});

// ═════════════════════════════════════════════════════════════════
// Kennzahlen je Berliner Tag
// ═════════════════════════════════════════════════════════════════

describe('Kennzahlen', () => {
  const standMit = (n: number) => ({ ...BEISPIEL, kennzahlen: { installationen: n } });
  const tagVorStart = (tage: number) => new Date(START.getTime() - tage * 86_400_000);
  const tag = (d: Date) => d.toISOString().slice(0, 10);

  it('kennzahlen_nur_30_tage: heute und die 30 Tage davor bleiben, Älteres wird beim Speichern gelöscht', () => {
    const speicher = new SicherheitSpeicher(openDb(':memory:'));
    for (let tage = 40; tage >= 0; tage--) speicher.speichereStand(standMit(100 + tage), tagVorStart(tage));

    const verlauf = speicher.kennzahlenVerlauf();
    expect(verlauf).toHaveLength(31);
    expect(verlauf[0]).toEqual({ tag: tag(tagVorStart(30)), kennzahlen: { installationen: 130 } });
    expect(verlauf[30]).toEqual({ tag: tag(tagVorStart(0)), kennzahlen: { installationen: 100 } });
    expect(verlauf.map((z) => z.tag)).toEqual([...verlauf.map((z) => z.tag)].sort());
  });

  it('kennzahlen_letzter_stand_des_berliner_tages: der spätere Stand desselben Tages gewinnt, der Tag zählt nach Berliner Zeit', () => {
    const speicher = new SicherheitSpeicher(openDb(':memory:'));
    // Berlin ist im Oktober UTC+2: 22:30 UTC am 23.10. ist schon der 24.10.
    speicher.speichereStand(standMit(1), new Date('2026-10-23T21:30:00.000Z')); // 23.10. 23:30 Berlin
    speicher.speichereStand(standMit(2), new Date('2026-10-23T22:30:00.000Z')); // 24.10. 00:30 Berlin
    speicher.speichereStand(standMit(3), new Date('2026-10-24T16:00:00.000Z')); // 24.10. 18:00 Berlin
    expect(speicher.kennzahlenVerlauf()).toEqual([
      { tag: '2026-10-23', kennzahlen: { installationen: 1 } },
      { tag: '2026-10-24', kennzahlen: { installationen: 3 } },
    ]);
  });

  it('kennzahlen_ueber_die_schnittstelle: ein gepushter Stand schreibt die Kennzahlen des Tages; ohne Kennzahlen bleibt der Stand trotzdem gespeichert', async () => {
    const { app, speicher, uhr } = await makeApp();
    await dienst(app).stand(BEISPIEL);
    expect(speicher.kennzahlenVerlauf()).toEqual([{ tag: '2026-10-24', kennzahlen: BEISPIEL.kennzahlen }]);

    uhr.jetzt = new Date(START.getTime() + 86_400_000);
    const ohne = { ...BEISPIEL };
    delete ohne.kennzahlen;
    expect((await dienst(app).stand(ohne)).status).toBe(200);
    expect(speicher.aktuellerStand()?.stand).toEqual(ohne);
    expect(speicher.kennzahlenVerlauf()).toHaveLength(1); // kein Tageswert ohne Kennzahlen
  });
});

// ═════════════════════════════════════════════════════════════════
// Nutzer-Zugang
// ═════════════════════════════════════════════════════════════════

describe('Nutzer-Zugang', () => {
  const alle = (app: Server, auth: { cookie?: string; apiKey?: string }) => {
    const mit = (r: request.Test) => {
      if (auth.cookie) r.set('Cookie', auth.cookie);
      if (auth.apiKey) r.set('X-API-Key', auth.apiKey);
      return r;
    };
    return [
      ['GET stand', () => mit(request(app).get('/api/sicherheit/stand'))],
      ['GET auftraege', () => mit(request(app).get('/api/sicherheit/auftraege'))],
      ['POST auftraege', () => mit(request(app).post('/api/sicherheit/auftraege')).set('Host', EIGENER_HOST).set('Origin', EIGENE_ORIGIN).send({ art: 'ueberwachen', site: SITE, werte: {} })],
    ] as const;
  };

  it('master_key_bekommt_403: der Master-Key reicht für keinen Nutzer-Endpunkt, und es wird nichts angelegt', async () => {
    const { app, speicher } = await bereit();
    for (const [name, aufruf] of alle(app, { apiKey: MASTER_KEY })) {
      const res = await aufruf();
      expect(res.status, name).toBe(403);
      expect(res.body.error, name).toBe('forbidden');
    }
    expect(speicher.verlauf()).toHaveLength(0);
  });

  it('fremdes_konto_bekommt_403: eine gültige Session eines Kontos, das nicht in SICHERHEIT_NUTZER steht, reicht nicht (auch nicht als Admin)', async () => {
    const { app, speicher, anmelden } = await bereit();
    const fremd = anmelden('fremd@example.test', 'admin');
    for (const [name, aufruf] of alle(app, { cookie: fremd })) {
      const res = await aufruf();
      expect(res.status, name).toBe(403);
      expect(res.body.error, name).toBe('forbidden');
    }
    expect(speicher.verlauf()).toHaveLength(0);
  });

  it('konten_ohne_gross_und_kleinschreibung_getrimmt: die Liste in SICHERHEIT_NUTZER wird so gelesen, wie der Brief sie beschreibt', async () => {
    const { app, anmelden } = await makeApp({ nutzer: ' Andere@Example.test ,  JAN@EXAMPLE.TEST ' });
    await dienst(app).stand(BEISPIEL);
    const res = await nutzer(app, anmelden('Jan@Example.test')).stand();
    expect(res.status).toBe(200);
    expect(res.body.stand).toEqual(BEISPIEL);
  });

  it('ohne_zweiten_faktor_403: ohne bestätigten zweiten Faktor 403 mit dem Hinweis auf /sicherheit/zweiter-faktor; mit ihm sofort 200', async () => {
    const { app, faktor, speicher, cookie } = await bereit();
    faktor.bestaetigt = false;
    for (const [name, aufruf] of alle(app, { cookie })) {
      const res = await aufruf();
      expect(res.status, name).toBe(403);
      expect(res.body.error, name).toBe('zweiter_faktor_fehlt');
      expect(res.body.message, name).toContain('/sicherheit/zweiter-faktor');
    }
    expect(speicher.verlauf()).toHaveLength(0);

    faktor.bestaetigt = true; // die Prüfung läuft bei jeder Anfrage neu
    for (const [name, aufruf] of alle(app, { cookie })) expect((await aufruf()).status, name).toBe(200);
  });

  it('zweiter_faktor_bekommt_anfrage_und_konto: die Prüffunktion (Task 9) sieht Request und Antwort mit dem angemeldeten Konto', async () => {
    const gesehen: { konto?: string; cookie?: string }[] = [];
    const { app, anmelden } = await makeApp({
      zweiterFaktorBestaetigt: (req, res) => {
        gesehen.push({ konto: getAuth(res)?.user?.email, cookie: req.headers.cookie });
        return true;
      },
    });
    const cookie = anmelden(JAN);
    await nutzer(app, cookie).stand();
    expect(gesehen).toEqual([{ konto: JAN, cookie }]);
  });

  it('master_key_und_fremdes_konto_sehen_den_zweiten_faktor_nicht: die Prüfung läuft erst nach Master-Key- und Konto-Prüfung', async () => {
    const pruefung = vi.fn(() => true);
    const { app, anmelden } = await makeApp({ zweiterFaktorBestaetigt: pruefung });
    expect((await request(app).get('/api/sicherheit/stand').set('X-API-Key', MASTER_KEY)).status).toBe(403);
    expect((await nutzer(app, anmelden('fremd@example.test')).stand()).status).toBe(403);
    expect(pruefung).not.toHaveBeenCalled();
    // Gegenprobe: ein berechtigtes Konto löst genau eine Prüfung aus
    expect((await nutzer(app, anmelden(JAN)).stand()).status).toBe(200);
    expect(pruefung).toHaveBeenCalledTimes(1);
  });

  it('ohne_anmeldung_401: ohne Session und ohne Schlüssel antwortet die /api-Auth', async () => {
    const { app } = await bereit();
    for (const [name, aufruf] of alle(app, {})) expect((await aufruf()).status, name).toBe(401);
  });
});

// ═════════════════════════════════════════════════════════════════
// Aufträge: Lebenslauf
// ═════════════════════════════════════════════════════════════════

describe('Aufträge: Lebenslauf', () => {
  it('auftrag_lebenslauf_offen_angewandt: angelegt, vom Kern geholt, quittiert; der Verlauf zeigt jeden Schritt', async () => {
    // Echter Login statt direkter Session: die ganze Kette vom Passwort bis zum Auftrag.
    const ctx = await makeApp();
    ctx.users.create({ email: JAN, name: 'Jan', role: 'admin', password: 'ein-langes-passwort' });
    const login = await request(ctx.app).post('/auth/login').send({ email: JAN, password: 'ein-langes-passwort' });
    expect(login.status).toBe(200);
    const cookie = String(login.headers['set-cookie'][0]).split(';')[0];
    const n = nutzer(ctx.app, cookie);
    const d = dienst(ctx.app);
    await d.stand(BEISPIEL);

    // 1. Anlegen
    ctx.uhr.jetzt = new Date('2026-10-24T12:01:00.000Z');
    const angelegt = await n.anlegen({ art: 'stufe', site: SITE, werte: { stufe: 'premium' } });
    expect(angelegt.status).toBe(200);
    expect(Object.keys(angelegt.body)).toEqual(['id']);
    const id: string = angelegt.body.id;
    expect(id).toMatch(UUID);

    // 2. Der Kern holt ihn ab: genau die Form aus dem Datenmodell, ohne typ und ohne Statusfelder
    const offen = await d.offene();
    expect(offen.status).toBe(200);
    expect(offen.body).toEqual({
      auftraege: [{ id, art: 'stufe', site: SITE, werte: { stufe: 'premium' }, durch: JAN, erstelltIso: '2026-10-24T12:01:00.000Z' }],
    });
    const verlaufOffen = (await n.verlauf()).body.auftraege;
    expect(verlaufOffen).toEqual([
      { id, art: 'stufe', site: SITE, werte: { stufe: 'premium' }, durch: JAN, erstelltIso: '2026-10-24T12:01:00.000Z', status: 'offen', quittungText: null, quittiertIso: null },
    ]);

    // 3. Quittung: angewandt
    ctx.uhr.jetzt = new Date('2026-10-24T12:05:00.000Z');
    const quittung = await d.quittung(id, { ok: true, text: 'Stufe gesetzt und bestätigt.' });
    expect(quittung.status).toBe(200);
    expect(quittung.body).toEqual({ ok: true });
    expect((await d.offene()).body).toEqual({ auftraege: [] });
    expect((await n.verlauf()).body.auftraege).toEqual([
      { id, art: 'stufe', site: SITE, werte: { stufe: 'premium' }, durch: JAN, erstelltIso: '2026-10-24T12:01:00.000Z', status: 'angewandt', quittungText: 'Stufe gesetzt und bestätigt.', quittiertIso: '2026-10-24T12:05:00.000Z' },
    ]);

    // 4. Ein zweiter Auftrag, den der Kern ablehnt: Status fehler mit dem Text des Kerns
    ctx.uhr.jetzt = new Date('2026-10-24T12:06:00.000Z');
    const zweiter = (await n.anlegen({ art: 'erledigt', site: SITE, typ: BEFUND.typ, werte: {} })).body.id;
    await d.quittung(zweiter, { ok: false, text: 'Kein offener Befund.' });
    const verlauf = (await n.verlauf()).body.auftraege;
    expect(verlauf.map((a: any) => [a.id, a.status, a.quittungText])).toEqual([
      [zweiter, 'fehler', 'Kein offener Befund.'], // jüngster zuerst
      [id, 'angewandt', 'Stufe gesetzt und bestätigt.'],
    ]);
  });

  it('zweite_quittung_aendert_nichts: sie überschreibt weder Status noch Text noch Zeit und antwortet trotzdem {ok: true}', async () => {
    const { nutzer: n, dienst: d, uhr } = await bereit();
    for (const [erst, zweit] of [[true, false], [false, true]] as const) {
      const id = (await n.anlegen({ art: 'durchgesehen', site: SITE, werte: {} })).body.id;
      uhr.jetzt = new Date(uhr.jetzt.getTime() + 60_000);
      await d.quittung(id, { ok: erst, text: 'erste Antwort' });
      const nach = uhr.jetzt.toISOString();
      uhr.jetzt = new Date(uhr.jetzt.getTime() + 60_000);

      const noch = await d.quittung(id, { ok: zweit, text: 'zweite Antwort' });
      expect(noch.status).toBe(200);
      expect(noch.body).toEqual({ ok: true });
      const zeile = (await n.verlauf()).body.auftraege.find((a: any) => a.id === id);
      expect(zeile).toMatchObject({ status: erst ? 'angewandt' : 'fehler', quittungText: 'erste Antwort', quittiertIso: nach });
    }
  });

  it('quittung_zu_unbekannter_id_404 und quittung_mit_falschem_koerper_400', async () => {
    const { nutzer: n, dienst: d } = await bereit();
    const unbekannt = await d.quittung('00000000-0000-4000-8000-000000000000', { ok: true, text: 'x' });
    expect(unbekannt.status).toBe(404);
    expect(unbekannt.body.error).toBe('auftrag_unbekannt'); // vom Router, nicht der Auffang-404 der App

    const id = (await n.anlegen({ art: 'durchgesehen', site: SITE, werte: {} })).body.id;
    for (const koerper of [{}, { ok: 'ja', text: 'x' }, { ok: 1, text: 'x' }, { ok: true }, { ok: true, text: 5 }, { text: 'x' }, [], 'ok']) {
      const res = await d.quittung(id, koerper);
      expect(res.status, JSON.stringify(koerper)).toBe(400);
      expect(res.body.error).toBe('validation');
    }
    expect((await n.verlauf()).body.auftraege[0].status).toBe('offen'); // nichts davon hat quittiert
  });

  it('quittung_text_wird_gekuerzt_statt_abgelehnt: ein langer Text darf die Quittung nicht scheitern lassen (der Kern merkte sich den Auftrag sonst vergeblich)', async () => {
    const { nutzer: n, dienst: d } = await bereit();
    const id = (await n.anlegen({ art: 'durchgesehen', site: SITE, werte: {} })).body.id;
    expect((await d.quittung(id, { ok: true, text: 'ä'.repeat(5000) })).status).toBe(200);
    const zeile = (await n.verlauf()).body.auftraege[0];
    expect(zeile.status).toBe('angewandt');
    expect(zeile.quittungText).toHaveLength(4000);
  });

  it('offene_auftraege_aelteste_zuerst_nur_offene: der Kern bekommt nur, was noch offen ist, in der Reihenfolge der Erstellung; typ steht nur bei erledigt und stumm', async () => {
    const { nutzer: n, dienst: d, uhr } = await bereit();
    const ids: string[] = [];
    const koerper = [
      { art: 'erledigt', site: SITE, typ: BEFUND.typ, werte: {} },
      { art: 'ueberwachen', site: SITE, werte: {} },
      { art: 'stimmt', site: SITE, werte: { befundId: BEFUND.befundId } },
    ];
    for (const k of koerper) {
      uhr.jetzt = new Date(uhr.jetzt.getTime() + 60_000);
      ids.push((await n.anlegen(k)).body.id);
    }
    await d.quittung(ids[1], { ok: true, text: 'fertig' });

    const offen = (await d.offene()).body.auftraege;
    expect(offen.map((a: any) => a.id)).toEqual([ids[0], ids[2]]);
    expect(offen[0]).toMatchObject({ art: 'erledigt', typ: BEFUND.typ, werte: {} });
    expect('typ' in offen[1]).toBe(false);
    expect(offen[1].werte).toEqual({ befundId: BEFUND.befundId });
  });

  it('ids_sind_eindeutige_uuids und durch_ist_das_konto: die ID vergibt der Server, den Urheber auch', async () => {
    const { nutzer: n, dienst: d } = await bereit();
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const id = (await n.anlegen({ art: 'durchgesehen', site: SITE, werte: {} })).body.id;
      expect(id).toMatch(UUID);
      ids.add(id);
    }
    expect(ids.size).toBe(5);
    expect((await d.offene()).body.auftraege.every((a: any) => a.durch === JAN)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════
// Aufträge: Herkunft
// ═════════════════════════════════════════════════════════════════

describe('Aufträge: Herkunft', () => {
  const auftrag = { art: 'durchgesehen', site: SITE, werte: {} };

  it('fremde_origin_400: ohne, mit fremder oder mit "null"-Origin wird kein Auftrag angenommen', async () => {
    const { nutzer: n, speicher } = await bereit();
    for (const origin of [null, 'https://boese.example.test', 'null', 'http://sicherheit.example.test:8080', 'https://sicherheit.example.test', `${EIGENE_ORIGIN}/pfad`, `${EIGENE_ORIGIN}.boese.test`]) {
      const res = await n.anlegen(auftrag, origin);
      expect(res.status, String(origin)).toBe(400);
      expect(res.body.error).toBe('fremde_origin');
    }
    expect(speicher.verlauf()).toHaveLength(0);
    expect((await n.anlegen(auftrag, EIGENE_ORIGIN)).status).toBe(200); // Gegenprobe
  });

  it('eigene_origin_hinter_dem_proxy: Schema aus X-Forwarded-Proto, Host aus X-Forwarded-Host oder Host', async () => {
    const { app, anmelden } = await makeApp({ trustProxy: true });
    await dienst(app).stand(BEISPIEL);
    const cookie = anmelden(JAN);
    const senden = (kopf: Record<string, string>) =>
      request(app).post('/api/sicherheit/auftraege').set('Cookie', cookie).set(kopf).send(auftrag);

    // Der Ingress reicht den öffentlichen Host als Host durch: https://oeffentlich.example.test
    expect((await senden({ Host: 'oeffentlich.example.test', 'X-Forwarded-Proto': 'https', Origin: 'https://oeffentlich.example.test' })).status).toBe(200);
    // Der Ingress setzt den Host um und nennt den öffentlichen in X-Forwarded-Host
    expect((await senden({ Host: 'intern:3500', 'X-Forwarded-Host': 'oeffentlich.example.test', 'X-Forwarded-Proto': 'https', Origin: 'https://oeffentlich.example.test' })).status).toBe(200);
    // Falsches Schema: der Browser ruft über http auf, die Origin sagt https (oder umgekehrt)
    expect((await senden({ Host: 'oeffentlich.example.test', 'X-Forwarded-Proto': 'https', Origin: 'http://oeffentlich.example.test' })).status).toBe(400);
    // Fremder Host bleibt fremd
    expect((await senden({ Host: 'oeffentlich.example.test', 'X-Forwarded-Proto': 'https', Origin: 'https://boese.example.test' })).status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════
// Aufträge: Form je Art
// ═════════════════════════════════════════════════════════════════

describe('Aufträge: Form je Art', () => {
  const morgen = '2026-10-25';
  const heute = '2026-10-24';
  const gestern = '2026-10-23';

  // Je Art ungültige Fälle (Brief: auftrag_mit_falscher_form_400, je Art ein ungültiger Fall)
  const ungueltig: [string, unknown][] = [
    ['erledigt ohne typ', { art: 'erledigt', site: SITE, werte: {} }],
    ['erledigt mit leerem typ', { art: 'erledigt', site: SITE, typ: '', werte: {} }],
    ['erledigt mit Leerzeichen im typ', { art: 'erledigt', site: SITE, typ: 'A 1', werte: {} }],
    ['erledigt mit werten', { art: 'erledigt', site: SITE, typ: BEFUND.typ, werte: { bis: morgen } }],
    ['stumm ohne bis', { art: 'stumm', site: SITE, typ: BEFUND.typ, werte: {} }],
    ['stumm ohne typ', { art: 'stumm', site: SITE, werte: { bis: morgen } }],
    ['stumm mit Datum in der Vergangenheit', { art: 'stumm', site: SITE, typ: BEFUND.typ, werte: { bis: gestern } }],
    ['stumm mit Datum, das es nicht gibt', { art: 'stumm', site: SITE, typ: BEFUND.typ, werte: { bis: '2026-02-30' } }],
    ['stumm mit deutschem Datum', { art: 'stumm', site: SITE, typ: BEFUND.typ, werte: { bis: '25.10.2026' } }],
    ['stumm mit Uhrzeit im Datum', { art: 'stumm', site: SITE, typ: BEFUND.typ, werte: { bis: '2026-10-25T10:00:00Z' } }],
    ['stumm mit Zahl als Datum', { art: 'stumm', site: SITE, typ: BEFUND.typ, werte: { bis: 20261025 } }],
    ['stumm mit fremdem Wert', { art: 'stumm', site: SITE, typ: BEFUND.typ, werte: { bis: morgen, grund: 'x' } }],
    ['stimmt ohne befundId', { art: 'stimmt', site: SITE, werte: {} }],
    ['stimmt mit befundId 0', { art: 'stimmt', site: SITE, werte: { befundId: 0 } }],
    ['stimmt mit Dezimalzahl', { art: 'stimmt', site: SITE, werte: { befundId: 1.5 } }],
    ['stimmt mit Text als befundId', { art: 'stimmt', site: SITE, werte: { befundId: '3' } }],
    ['stimmt mit zu großer befundId', { art: 'stimmt', site: SITE, werte: { befundId: 2 ** 60 } }],
    ['kein-hack mit negativer befundId', { art: 'kein-hack', site: SITE, werte: { befundId: -3 } }],
    ['kein-hack mit typ', { art: 'kein-hack', site: SITE, typ: BEFUND.typ, werte: { befundId: BEFUND.befundId } }],
    ['stufe ohne stufe', { art: 'stufe', site: SITE, werte: {} }],
    ['stufe unbekannt', { art: 'stufe', site: SITE, werte: { stufe: 'gold' } }],
    ['stufe mit Prototyp-Name', { art: 'stufe', site: SITE, werte: { stufe: 'toString' } }],
    ['stufe mit zweitem Wert', { art: 'stufe', site: SITE, werte: { stufe: 'premium', vip: true } }],
    ['merker ohne Merker', { art: 'merker', site: SITE, werte: {} }],
    ['merker mit Text statt boolean', { art: 'merker', site: SITE, werte: { vip: 'ja' } }],
    ['merker mit unbekanntem Merker', { art: 'merker', site: SITE, werte: { vip: true, geheim: true } }],
    ['merker mit pause_bis in der Vergangenheit', { art: 'merker', site: SITE, werte: { pause_bis: gestern } }],
    ['merker mit pause_bis als Zahl', { art: 'merker', site: SITE, werte: { pause_bis: 5 } }],
    ['nicht-ueberwacht ohne grund', { art: 'nicht-ueberwacht', site: SITE, werte: {} }],
    ['nicht-ueberwacht mit leerem grund', { art: 'nicht-ueberwacht', site: SITE, werte: { grund: '   ' } }],
    ['nicht-ueberwacht mit grund über 500 Zeichen', { art: 'nicht-ueberwacht', site: SITE, werte: { grund: 'x'.repeat(501) } }],
    ['nicht-ueberwacht mit Zahl als grund', { art: 'nicht-ueberwacht', site: SITE, werte: { grund: 7 } }],
    ['ueberwachen mit werten', { art: 'ueberwachen', site: SITE, werte: { grund: 'x' } }],
    ['durchgesehen mit werten', { art: 'durchgesehen', site: SITE, werte: { x: 1 } }],
    ['durchgesehen mit typ', { art: 'durchgesehen', site: SITE, typ: BEFUND.typ, werte: {} }],
    // quer zu den Arten
    ['unbekannte Art', { art: 'loeschen', site: SITE, werte: {} }],
    ['Art mit Prototyp-Name', { art: 'constructor', site: SITE, werte: {} }],
    ['ohne Art', { site: SITE, werte: {} }],
    ['ohne site', { art: 'durchgesehen', werte: {} }],
    ['leere site', { art: 'durchgesehen', site: '', werte: {} }],
    ['site als Zahl', { art: 'durchgesehen', site: 5, werte: {} }],
    ['werte kein Objekt', { art: 'durchgesehen', site: SITE, werte: 'x' }],
    ['werte eine Liste', { art: 'durchgesehen', site: SITE, werte: [] }],
    ['durch vom Client', { art: 'durchgesehen', site: SITE, werte: {}, durch: 'chef@example.test' }],
    ['id vom Client', { art: 'durchgesehen', site: SITE, werte: {}, id: 'meine-id' }],
    ['Körper eine Liste', [{ art: 'durchgesehen', site: SITE, werte: {} }]],
    ['Körper leer', {}],
  ];

  it('auftrag_mit_falscher_form_400: je Art mindestens ein ungültiger Fall, nichts wird angelegt', async () => {
    const { nutzer: n, speicher } = await bereit();
    for (const [name, koerper] of ungueltig) {
      const res = await n.anlegen(koerper);
      expect(res.status, name).toBe(400);
      expect(res.body.error, name).toBe('validation');
      expect(typeof res.body.message, name).toBe('string');
    }
    expect(speicher.verlauf()).toHaveLength(0);
    // Jede der neun Arten kommt unter den ungültigen Fällen vor
    const arten = new Set(ungueltig.map(([, k]) => (k as any)?.art));
    for (const art of ['erledigt', 'stumm', 'stimmt', 'kein-hack', 'stufe', 'merker', 'nicht-ueberwacht', 'ueberwachen', 'durchgesehen']) expect(arten.has(art), art).toBe(true);
  });

  it('auftrag_gueltige_formen_je_art: jede Art wird angenommen und in genau der Form gespeichert, die der Kern erwartet', async () => {
    const { nutzer: n, dienst: d, uhr } = await bereit();
    const gueltig: [unknown, object][] = [
      [{ art: 'erledigt', site: SITE, typ: BEFUND.typ, werte: {} }, { art: 'erledigt', site: SITE, typ: BEFUND.typ, werte: {} }],
      [{ art: 'erledigt', site: SITE, typ: 'B6b' }, { art: 'erledigt', site: SITE, typ: 'B6b', werte: {} }], // werte darf fehlen
      [{ art: 'stumm', site: SITE, typ: BEFUND.typ, werte: { bis: morgen } }, { art: 'stumm', site: SITE, typ: BEFUND.typ, werte: { bis: morgen } }],
      [{ art: 'stumm', site: SITE, typ: BEFUND.typ, werte: { bis: heute } }, { art: 'stumm', site: SITE, typ: BEFUND.typ, werte: { bis: heute } }], // bis zum UTC-Tagesende, wie im Kern
      [{ art: 'stimmt', site: SITE, werte: { befundId: BEFUND.befundId } }, { art: 'stimmt', site: SITE, werte: { befundId: BEFUND.befundId } }],
      [{ art: 'kein-hack', site: SITE, werte: { befundId: 7 } }, { art: 'kein-hack', site: SITE, werte: { befundId: 7 } }],
      ...['premium', 'standard', 'ohne', 'bewusst-ohne', 'intern', 'neu'].map((stufe) => [{ art: 'stufe', site: SITE, werte: { stufe } }, { art: 'stufe', site: SITE, werte: { stufe } }] as [unknown, object]),
      [{ art: 'merker', site: SITE, werte: { vip: true } }, { art: 'merker', site: SITE, werte: { vip: true } }],
      [{ art: 'merker', site: SITE, werte: { fremdhosting: false, kein_ssh_moeglich: true } }, { art: 'merker', site: SITE, werte: { fremdhosting: false, kein_ssh_moeglich: true } }],
      [{ art: 'merker', site: SITE, werte: { pause_bis: morgen } }, { art: 'merker', site: SITE, werte: { pause_bis: morgen } }],
      [{ art: 'merker', site: SITE, werte: { pause_bis: null, vip: false } }, { art: 'merker', site: SITE, werte: { pause_bis: null, vip: false } }],
      [{ art: 'nicht-ueberwacht', site: SITE, werte: { grund: '  Testkopie, wird gelöscht  ' } }, { art: 'nicht-ueberwacht', site: SITE, werte: { grund: 'Testkopie, wird gelöscht' } }], // getrimmt wie im Kern
      [{ art: 'nicht-ueberwacht', site: SITE, werte: { grund: 'x'.repeat(500) } }, { art: 'nicht-ueberwacht', site: SITE, werte: { grund: 'x'.repeat(500) } }],
      [{ art: 'ueberwachen', site: SITE, werte: {} }, { art: 'ueberwachen', site: SITE, werte: {} }],
      [{ art: 'durchgesehen', site: SITE, werte: {} }, { art: 'durchgesehen', site: SITE, werte: {} }],
    ];
    for (const [i, [eingabe, erwartet]] of gueltig.entries()) {
      uhr.jetzt = new Date(START.getTime() + (i + 1) * 1000);
      const res = await n.anlegen(eingabe);
      expect(res.status, JSON.stringify(eingabe)).toBe(200);
      const gespeichert = (await d.offene()).body.auftraege.find((a: any) => a.id === res.body.id);
      expect(gespeichert, JSON.stringify(eingabe)).toEqual({ ...erwartet, id: res.body.id, durch: JAN, erstelltIso: uhr.jetzt.toISOString() });
    }
  });

  it('stumm_am_tagesende: um 23:59 UTC am Stichtag geht "bis heute" noch, nach dem UTC-Tagesende nicht mehr (dieselbe Regel wie im Kern)', async () => {
    const { nutzer: n, uhr } = await bereit();
    const stumm = { art: 'stumm', site: SITE, typ: BEFUND.typ, werte: { bis: heute } };
    uhr.jetzt = new Date('2026-10-24T23:59:59.000Z');
    expect((await n.anlegen(stumm)).status).toBe(200);
    uhr.jetzt = new Date('2026-10-25T00:00:00.000Z');
    expect((await n.anlegen(stumm)).status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════
// Aufträge: Sites
// ═════════════════════════════════════════════════════════════════

describe('Aufträge: Sites', () => {
  it('auftrag_fuer_unbekannte_site_400: eine Site, die im Stand nirgends vorkommt, wird abgewiesen', async () => {
    const { nutzer: n, speicher } = await bereit();
    const res = await n.anlegen({ art: 'ueberwachen', site: 'gibt-es-nicht.test', werte: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unbekannte_site');
    expect(speicher.verlauf()).toHaveLength(0);
    // Ein Treffer im Namen genügt nicht: gleiche Zeichenkette, nicht Teilstück
    expect((await n.anlegen({ art: 'ueberwachen', site: SITE.slice(1), werte: {} })).status).toBe(400);
    expect((await n.anlegen({ art: 'ueberwachen', site: `www.${SITE}`, werte: {} })).status).toBe(400);
  });

  for (const abschnitt of ['flotte', 'lage', 'nichtUeberwacht', 'abdeckung.neu', 'abdeckung.ohneMysites', 'abdeckung.premiumUnbestaetigt', 'abdeckung.widersprueche']) {
    it(`site_aus_dem_stand: eine Site, die nur in "${abschnitt}" steht, wird angenommen`, async () => {
      const { app, anmelden } = await makeApp();
      await dienst(app).stand(kleinerStand(abschnitt, 'nur-hier.test'));
      const n = nutzer(app, anmelden(JAN));
      expect((await n.anlegen({ art: 'ueberwachen', site: 'nur-hier.test', werte: {} })).status).toBe(200);
      expect((await n.anlegen({ art: 'ueberwachen', site: 'woanders.test', werte: {} })).status).toBe(400);
    });
  }

  it('auftrag_ohne_stand_409_auch_fuer_sammelzeilen: solange noch kein Stand da ist, hilft auch ein Sammelbefund nichts', async () => {
    const { app, anmelden } = await makeApp();
    const res = await nutzer(app, anmelden(JAN)).anlegen({ art: 'erledigt', site: '_alle', typ: 'A3', werte: {} });
    expect(res.status).toBe(409);
  });

  it('auftrag_ohne_stand_409: solange noch kein Stand da ist, kann kein Auftrag entstehen', async () => {
    const { app, anmelden, speicher } = await makeApp();
    const n = nutzer(app, anmelden(JAN));
    const res = await n.anlegen({ art: 'ueberwachen', site: SITE, werte: {} });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('kein_stand');
    expect(speicher.verlauf()).toHaveLength(0);
    // Eine falsche Form bleibt auch ohne Stand ein 400 (die Form hängt nicht am Zustand)
    expect((await n.anlegen({ art: 'loeschen', site: SITE, werte: {} })).status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════
// Aufträge: Sammel- und Quellenzeilen
// ═════════════════════════════════════════════════════════════════
//
// Ein Sammelbefund (site "_alle") oder ein Quellenalarm (site "_quelle:<name>")
// steht in der Lage unter diesem Namen. Schließen (erledigt) und Stummschalten
// (stumm) gelten ihm selbst; jedes andere Urteil gilt einer Mitglieds-Site,
// die API nimmt "_..." dafür nicht an.

describe('Aufträge: Sammel- und Quellenzeilen', () => {
  const SAMMEL = BEISPIEL.lage.find((z: any) => z.site.startsWith('_'));

  it('der_beispiel_stand_hat_einen_sammelbefund_in_der_lage: Voraussetzung der folgenden Tests', () => {
    expect(SAMMEL).toBeDefined();
  });

  for (const site of ['_alle', '_quelle:beispiel']) {
    it(`sammelzeile_in_der_lage: "${site}" nimmt die API für erledigt und stumm an und reicht sie dem Kern unverändert`, async () => {
      const { app, anmelden } = await makeApp();
      await dienst(app).stand(kleinerStand('lage', site));
      const n = nutzer(app, anmelden(JAN));
      const erledigt = await n.anlegen({ art: 'erledigt', site, typ: 'A3', werte: {} });
      const stumm = await n.anlegen({ art: 'stumm', site, typ: 'A3', werte: { bis: '2026-10-25' } });
      expect([erledigt.status, stumm.status]).toEqual([200, 200]);
      const offen = (await dienst(app).offene()).body.auftraege;
      expect(offen.map((a: any) => [a.id, a.art, a.site, a.typ, a.werte])).toEqual([
        [erledigt.body.id, 'erledigt', site, 'A3', {}],
        [stumm.body.id, 'stumm', site, 'A3', { bis: '2026-10-25' }],
      ]);
    });
  }

  it('sammelzeile_im_beispiel_stand: der Sammelbefund aus der Lage des Beispiels geht für erledigt und stumm durch', async () => {
    const { nutzer: n } = await bereit();
    expect((await n.anlegen({ art: 'erledigt', site: SAMMEL.site, typ: SAMMEL.typ, werte: {} })).status).toBe(200);
    expect((await n.anlegen({ art: 'stumm', site: SAMMEL.site, typ: SAMMEL.typ, werte: { bis: '2026-10-25' } })).status).toBe(200);
  });

  it('sammelzeile_fuer_andere_arten_400: stufe, merker, nicht-ueberwacht, ueberwachen, durchgesehen, stimmt und kein-hack weisen "_..." ab, auch wenn die Lage es trägt', async () => {
    const { nutzer: n, speicher } = await bereit();
    const andere = [
      { art: 'stufe', werte: { stufe: 'premium' } },
      { art: 'merker', werte: { vip: true } },
      { art: 'nicht-ueberwacht', werte: { grund: 'Test' } },
      { art: 'ueberwachen', werte: {} },
      { art: 'durchgesehen', werte: {} },
      { art: 'stimmt', werte: { befundId: SAMMEL.befundId } },
      { art: 'kein-hack', werte: { befundId: SAMMEL.befundId } },
    ];
    for (const auftrag of andere) {
      const res = await n.anlegen({ ...auftrag, site: SAMMEL.site });
      expect(res.status, auftrag.art).toBe(400);
      expect(res.body.error, auftrag.art).toBe('validation');
    }
    expect(speicher.verlauf()).toHaveLength(0);
    // Gegenprobe: dieselben Aufträge für eine Site aus der Flotte sind in Ordnung
    for (const auftrag of andere) expect((await n.anlegen({ ...auftrag, site: SITE })).status, auftrag.art).toBe(200);
  });

  it('sammelzeile_nicht_in_der_lage_400: steht "_..." in keiner Zeile der Lage, auch wenn andere Abschnitte es nennen, wird selbst erledigt und stumm abgewiesen', async () => {
    const { app, anmelden, speicher } = await makeApp();
    const n = nutzer(app, anmelden(JAN));
    const stand = {
      ...kleinerStand('flotte', '_alle'),
      nichtUeberwacht: [{ site: '_alle' }],
      abdeckung: { neu: [{ site: '_alle' }], ohneMysites: [], premiumUnbestaetigt: [], widersprueche: [{ site: '_alle' }] },
    };
    await dienst(app).stand(stand);
    for (const site of ['_alle', '_quelle:mysites']) {
      for (const koerper of [
        { art: 'erledigt', site, typ: 'A3', werte: {} },
        { art: 'stumm', site, typ: 'A3', werte: { bis: '2026-10-25' } },
      ]) {
        const res = await n.anlegen(koerper);
        expect(res.status, `${koerper.art} ${site}`).toBe(400);
        expect(res.body.error, `${koerper.art} ${site}`).toBe('unbekannte_site');
      }
    }
    expect(speicher.verlauf()).toHaveLength(0);
  });

  it('sammelzeile_braucht_weiter_typ_und_form: erledigt ohne typ und stumm mit Datum in der Vergangenheit scheitern auch für "_..."', async () => {
    const { nutzer: n } = await bereit();
    expect((await n.anlegen({ art: 'erledigt', site: SAMMEL.site, werte: {} })).status).toBe(400);
    expect((await n.anlegen({ art: 'stumm', site: SAMMEL.site, typ: SAMMEL.typ, werte: { bis: '2026-10-23' } })).status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════
// Aufträge: Verlauf
// ═════════════════════════════════════════════════════════════════

describe('Aufträge: Verlauf', () => {
  it('verlauf_seit: nur Aufträge ab dem Zeitpunkt (einschließlich), jüngste zuerst; ohne seit alle', async () => {
    const { nutzer: n, speicher } = await bereit();
    const ids = [0, 1, 2].map((i) => speicher.legeAuftragAn({ art: 'durchgesehen', site: SITE, werte: {}, durch: JAN }, new Date(START.getTime() + i * 3_600_000)));

    const ab = START.getTime() + 3_600_000;
    const res = await n.verlauf(`?seit=${encodeURIComponent(new Date(ab).toISOString())}`);
    expect(res.status).toBe(200);
    expect(res.body.auftraege.map((a: any) => a.id)).toEqual([ids[2], ids[1]]);
    expect((await n.verlauf()).body.auftraege.map((a: any) => a.id)).toEqual([ids[2], ids[1], ids[0]]);
    expect((await n.verlauf('?seit=2026-10-24')).body.auftraege).toHaveLength(3); // auch nur ein Datum
    expect((await n.verlauf('?seit=2026-10-25T00:00:00.000Z')).body.auftraege).toHaveLength(0);
  });

  it('verlauf_seit_ungueltig_400: was kein Zeitpunkt ist, wird nicht geraten', async () => {
    const { nutzer: n } = await bereit();
    for (const seit of ['gestern', '1', '12', '2026-13-45', '2026-10-24T25:00:00Z', '']) {
      const res = await n.verlauf(`?seit=${encodeURIComponent(seit)}`);
      expect(res.status, seit).toBe(400);
      expect(res.body.error, seit).toBe('validation');
    }
  });

  it('verlauf_hoechstens_200: bei mehr Aufträgen nur die 200 jüngsten', async () => {
    const { nutzer: n, speicher } = await bereit();
    let juengster = '';
    for (let i = 0; i < 205; i++) juengster = speicher.legeAuftragAn({ art: 'durchgesehen', site: SITE, werte: {}, durch: JAN }, new Date(START.getTime() + i * 1000));
    const res = await n.verlauf();
    expect(res.body.auftraege).toHaveLength(200);
    expect(res.body.auftraege[0].id).toBe(juengster);
  });

  it('dienst_liste_ohne_grenze: die 200 gelten nur für den Verlauf der Nutzer, der Kern bekommt alle offenen', async () => {
    const { dienst: d, speicher } = await bereit();
    for (let i = 0; i < 205; i++) speicher.legeAuftragAn({ art: 'durchgesehen', site: SITE, werte: {}, durch: JAN }, new Date(START.getTime() + i * 1000));
    expect((await d.offene()).body.auftraege).toHaveLength(205);
  });
});

// ═════════════════════════════════════════════════════════════════
// Antwort-Header
// ═════════════════════════════════════════════════════════════════

describe('Antwort-Header', () => {
  it('antworten_werden_nicht_gecacht: Stand, Aufträge und auch Ablehnungen tragen Cache-Control no-store (die Daten sind eine Landkarte der Schwachstellen)', async () => {
    const { app, dienst: d, nutzer: n } = await bereit();
    const antworten = [
      await d.stand(BEISPIEL),
      await d.offene(),
      await d.stand(BEISPIEL, 'falsch'), // 401
      await n.stand(),
      await n.verlauf(),
      await n.anlegen({ art: 'durchgesehen', site: SITE, werte: {} }),
      await n.anlegen({ art: 'loeschen' }), // 400
      await request(app).get('/api/sicherheit/stand').set('X-API-Key', MASTER_KEY), // 403
    ];
    for (const antwort of antworten) expect(antwort.headers['cache-control'], String(antwort.status)).toBe('no-store');
  });
});

// ═════════════════════════════════════════════════════════════════
// Geheimnisse und Inhalte bleiben aus dem Log
// ═════════════════════════════════════════════════════════════════

describe('Log', () => {
  it('schluessel_und_stand_stehen_nie_im_log: weder Dienst- noch Master-Key, Sessiontoken, Quittungstext noch Sites aus dem Stand', async () => {
    const { app, anmelden } = await makeApp({ trustProxy: true });
    const cookie = anmelden(JAN);
    const token = cookie.split('=')[1];
    const d = dienst(app);
    const n = nutzer(app, cookie);

    await d.stand(BEISPIEL, 'falscher-schluessel-xyz');
    await d.stand(BEISPIEL);
    await n.stand();
    await request(app).get('/api/sicherheit/stand').set('X-API-Key', MASTER_KEY);
    const id = (await n.anlegen({ art: 'nicht-ueberwacht', site: SITE, werte: { grund: 'Grund-der-nicht-ins-Log-soll' } })).body.id;
    await n.anlegen({ art: 'ueberwachen', site: 'unbekannte-site.test', werte: {} });
    await d.offene();
    await d.quittung(id, { ok: true, text: 'Quittungstext-der-nicht-ins-Log-soll' });
    await d.stand({ version: 99 });
    await request(app).post('/api/sicherheit/stand').set(DIENST, DIENST_KEY).set('Content-Type', 'application/json').send('{kaputt');

    const log = protokoll.join('\n');
    // Gegenprobe: die Abläufe sind tatsächlich gelaufen und protokolliert, nur ohne Geheimnisse
    expect(log).toMatch(/Stand empfangen/);
    expect(log).toMatch(/ungültiger Dienstschlüssel/);
    expect(log).toMatch(/Auftrag nicht-ueberwacht angelegt/);
    for (const geheim of [DIENST_KEY, 'falscher-schluessel-xyz', MASTER_KEY, token, 'Quittungstext-der-nicht-ins-Log-soll', 'Grund-der-nicht-ins-Log-soll', SITE, 'unbekannte-site.test', FIRMA]) {
      expect(log, geheim).not.toContain(geheim);
    }
  });

  it('stand_eingang_und_auftrag_werden_protokolliert: damit sich der erste Stand im Log belegen lässt', async () => {
    const { nutzer: n } = await bereit();
    await n.anlegen({ art: 'durchgesehen', site: SITE, werte: {} });
    const log = protokoll.join('\n');
    expect(log).toMatch(/Stand empfangen/);
    expect(log).toMatch(/Auftrag durchgesehen angelegt/);
  });

  it('abweisungen_stehen_mit_pfad_im_log: der Betrieb sieht, welcher Aufruf scheitert (zu großer Stand, falsche Version, falscher Schlüssel, Master-Key)', async () => {
    const { app } = await bereit();
    await dienst(app).stand({ version: 2 });
    await dienst(app).stand({ ...BEISPIEL, fueller: 'x'.repeat(11 * 1024 * 1024) });
    await request(app).get('/api/sicherheit/auftraege?offen=1');
    await request(app).get('/api/sicherheit/stand').set('X-API-Key', MASTER_KEY);
    const log = protokoll.join('\n');
    expect(log).toMatch(/Stand abgewiesen \(Version 2, erwartet 1\)/);
    expect(log).toMatch(/Anfrage abgewiesen \(413\): POST \/api\/sicherheit\/stand/);
    expect(log).toMatch(/ungültiger Dienstschlüssel von \S+: GET \/api\/sicherheit\/auftraege/);
    expect(log).toMatch(/Zugriff verweigert \(master-key\) von \S+: GET \/api\/sicherheit\/stand/);
    expect(log).not.toContain('xxxxxxxxxx'); // nie Inhalte des Körpers
  });
});
