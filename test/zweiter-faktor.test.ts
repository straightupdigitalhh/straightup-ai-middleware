import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHash } from 'crypto';
import { createServer, type Server } from 'http';
import { format } from 'util';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../src/core/db.js';
import { UserStore } from '../src/core/users.js';
import { SessionStore, SESSION_COOKIE } from '../src/core/sessions.js';
import { ZweiterFaktorStore } from '../src/core/zweiter-faktor.js';
import { pruefeTotp, totpCode } from '../src/core/totp.js';
import { createAuthRouter } from '../src/routes/auth.js';
import { createApiAuth, createPageAuth } from '../src/services/auth.js';
import { FixedWindowLimiter } from '../src/services/rate-limit.js';
import { SicherheitSpeicher } from '../src/services/sicherheit/speicher.js';
import {
  ZWEITER_FAKTOR_PFAD,
  createSicherheitDienstRouter,
  createSicherheitNutzerRouter,
  createSicherheitZweiterFaktorRouter,
  createZweiterFaktorPruefung,
  leseSicherheitKonfig,
} from '../src/routes/sicherheit.js';

// Sicherheitsplattform Teil 1, Task 9: zweiter Faktor (TOTP) für /sicherheit.
// Alle Tests laufen gegen die echte Kette aus Routern, /api-Auth, Sessions und
// SQLite im Speicher, in der Reihenfolge von src/index.ts; ersetzt sind nur die
// Uhr und (wo ein Test feste Codes braucht) das Geheimnis, das per SQL gesetzt
// wird. Die Uhr beginnt an einem festen Schrittanfang und die Geheimnisse sind
// fest: Die Codes sind dann feste Werte, und kein Test hängt daran, dass zwei
// Zufallsgeheimnisse zufällig denselben Code ergeben.

const MASTER_KEY = 'master-key-fuer-tests';
const DIENST_KEY = 'dienst-key-fuer-tests';
const JAN = 'jan@example.test';
const GABI = 'gabi@example.test';
const FREMD = 'fremd@example.test';
const PASSWORT = 'passwort-fuer-tests';
const EIGENER_HOST = 'sicherheit.example.test';
const EIGENE_ORIGIN = `http://${EIGENER_HOST}`;
const SCHRITT = 30_000;
const ZWOELF_STUNDEN = 12 * 60 * 60 * 1000;
/** Ein Zeitschritt-Anfang (12:00:00 teilt sich durch 30 s). */
const START = new Date('2026-10-24T12:00:00.000Z');

/** Feste Geheimnisse (Base32, 20 Bytes): das der RFC 6238 und ein anderes. */
const GEHEIMNIS_JAN = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const GEHEIMNIS_GABI = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const ANGREIFER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const FEST: Record<string, string> = { [JAN]: GEHEIMNIS_JAN, [GABI]: GEHEIMNIS_GABI };

// ─── Aufbau der App wie in src/index.ts ──────────────────────────

interface Aufbau {
  dienstSchluessel?: string | undefined;
  nutzer?: string | undefined;
  codeFehlversuche?: FixedWindowLimiter;
  trustProxy?: boolean;
  /** Ohne die globalen Body-Parser von index.ts: der Router muss das Formular dann selbst lesen. */
  ohneGlobaleParser?: boolean;
}

/** Die Testserver, die ein Test geöffnet hat; afterEach schließt sie. */
const offeneServer: Server[] = [];

/**
 * Baut die App wie in index.ts und startet EINEN Server dafür, an 127.0.0.1
 * gebunden (supertest bände sonst für jede Anfrage einen Server auf dem
 * Wildcard-Port, und ein fremder Listener mit derselben Portnummer auf
 * 127.0.0.1 beantwortet die Anfrage; siehe test/sicherheit.test.ts).
 */
async function makeApp(aufbau: Aufbau = {}) {
  const db = openDb(':memory:');
  const users = new UserStore(db);
  const sessions = new SessionStore(db, users);
  const speicher = new SicherheitSpeicher(db);
  const store = new ZweiterFaktorStore(db);
  const uhr = { jetzt: new Date(START) };
  const jetzt = () => uhr.jetzt;
  const konfig = leseSicherheitKonfig({
    SICHERHEIT_DIENSTSCHLUESSEL: 'dienstSchluessel' in aufbau ? aufbau.dienstSchluessel : DIENST_KEY,
    SICHERHEIT_NUTZER: 'nutzer' in aufbau ? aufbau.nutzer : `${JAN}, ${GABI}`,
  });
  const deps = { speicher, ...konfig, zweiterFaktorBestaetigt: createZweiterFaktorPruefung(store, jetzt), jetzt };

  const app = express();
  if (aufbau.trustProxy) app.set('trust proxy', 1);
  app.use(createSicherheitDienstRouter(deps));
  if (!aufbau.ohneGlobaleParser) {
    app.use(express.json({ limit: '5mb' }));
    app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  }
  app.use(createAuthRouter({ users, sessions }));
  app.use('/api', createApiAuth(MASTER_KEY, sessions, new FixedWindowLimiter(100, 60_000)));
  app.use(createSicherheitNutzerRouter(deps));
  app.use(createSicherheitZweiterFaktorRouter({
    ...konfig,
    store,
    pageAuth: createPageAuth(sessions, '/app/'),
    codeFehlversuche: aufbau.codeFehlversuche,
    jetzt,
  }));
  app.use((_req, res) => { res.status(404).json({ error: 'nicht_gefunden' }); });

  const server = createServer(app);
  offeneServer.push(server);
  await new Promise<void>((fertig) => server.listen(0, '127.0.0.1', fertig));

  /** Legt das Konto an, falls es fehlt, und startet eine neue Session dafür (Cookie-Header und Token). */
  function anmelden(email: string, role: 'admin' | 'member' = 'admin') {
    const user = users.findByEmail(email) ?? users.create({ email, name: email, role, password: PASSWORT });
    const { token } = sessions.create(user.id);
    // Die Session läuft in echter Zeit ab, die Uhr der Tests steht fest: damit das Datum des Rechners nichts ausmacht, gilt sie "für immer".
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?')
      .run('2099-12-31T23:59:59.000Z', createHash('sha256').update(token).digest('hex'));
    return { cookie: `${SESSION_COOKIE}=${token}`, token };
  }
  /** Ein Konto mit schon eingerichtetem zweiten Faktor (festes Geheimnis) und einer neuen, noch unbestätigten Session. */
  function mitFaktor(email: string, geheimnis = FEST[email]) {
    const sitzung = anmelden(email);
    db.prepare('UPDATE users SET totp_geheimnis = ? WHERE email = ?').run(geheimnis, email);
    return { ...sitzung, geheimnis };
  }
  /** Ein Konto mitten in der Einrichtung: der Entwurf steht fest, die Seite zeigt ihn dann wieder. */
  function mitEntwurf(email: string, entwurf = FEST[email]) {
    const sitzung = anmelden(email);
    db.prepare('UPDATE users SET totp_entwurf = ? WHERE email = ?').run(entwurf, email);
    return { ...sitzung, geheimnis: entwurf };
  }
  const weiter = (ms: number) => { uhr.jetzt = new Date(uhr.jetzt.getTime() + ms); };
  /** Der Code, den die App zu `geheimnis` jetzt (oder `abweichungMs` früher oder später) zeigt. */
  const code = (geheimnis: string, abweichungMs = 0) => totpCode(geheimnis, uhr.jetzt.getTime() + abweichungMs);
  return { app: server, db, users, sessions, store, uhr, anmelden, mitFaktor, mitEntwurf, weiter, code };
}
type Ctx = Awaited<ReturnType<typeof makeApp>>;

// ─── Aufrufe und Auswertung ──────────────────────────────────────

const seite = (app: Server, cookie?: string) => {
  const r = request(app).get(ZWEITER_FAKTOR_PFAD);
  return cookie ? r.set('Cookie', cookie) : r;
};

interface EingabeOpt {
  /** Der Origin-Header; null lässt ihn weg. Standard: die eigene Origin. */
  origin?: string | null;
  /** Zusätzliche Formularfelder neben dem Code. */
  felder?: Record<string, string | string[]>;
  kopf?: Record<string, string>;
}
/** Das Formular absenden, so wie ein Browser es von der eigenen Seite aus tut. */
const eingabe = (app: Server, cookie: string | undefined, code: string | null, opt: EingabeOpt = {}) => {
  const r = request(app).post(ZWEITER_FAKTOR_PFAD).set('Host', EIGENER_HOST).set(opt.kopf ?? {});
  if (cookie) r.set('Cookie', cookie);
  const origin = 'origin' in opt ? opt.origin : EIGENE_ORIGIN;
  if (origin !== null && origin !== undefined) r.set('Origin', origin);
  return r.type('form').send({ ...(code === null ? {} : { code }), ...opt.felder } as object);
};

/** Ein Nutzer-Endpunkt hinter dem zweiten Faktor: 200, wenn die Session bestätigt ist, sonst 403. */
const api = (app: Server, cookie: string) => request(app).get('/api/sicherheit/stand').set('Cookie', cookie);

const entschluessele = (html: string) => html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
/** Der Inhalt von <code id="...">…</code> aus der Seite, so wie der Browser ihn zeigt. */
const feld = (html: string, id: string): string | null => {
  const treffer = new RegExp(`<code id="${id}">([^<]*)</code>`).exec(html);
  return treffer ? entschluessele(treffer[1]) : null;
};
const geheimnisAusSeite = (html: string): string => (feld(html, 'geheimnis') ?? '').replace(/\s+/g, '');
const vierergruppen = (geheimnis: string) => geheimnis.match(/.{1,4}/g)!.join(' ');

/** Ein Code, der zu `geheimnis` im Fenster um `zeitMs` sicher nicht passt (höchstens drei Codes passen, ein paar Versuche genügen). */
function falscherCode(geheimnis: string, zeitMs: number): string {
  for (let n = 135_790; n < 135_790 + 20; n++) {
    const kandidat = String(n).padStart(6, '0');
    if (!pruefeTotp(geheimnis, kandidat, zeitMs)) return kandidat;
  }
  throw new Error('Kein falscher Code gefunden: pruefeTotp lässt zu viele Codes durch.');
}

const nutzerZeile = (db: DatabaseSync, email: string) => ({
  ...(db.prepare('SELECT totp_geheimnis, totp_entwurf, totp_letzter_schritt FROM users WHERE email = ?').get(email) as object),
}) as { totp_geheimnis: string | null; totp_entwurf: string | null; totp_letzter_schritt: number | null };

/** zweiter_faktor_bis der Session; der Hash wird hier unabhängig vom Quelltext gebildet. */
const bestaetigtBis = (db: DatabaseSync, token: string): string | null =>
  (db.prepare('SELECT zweiter_faktor_bis FROM sessions WHERE token_hash = ?')
    .get(createHash('sha256').update(token).digest('hex')) as { zweiter_faktor_bis: string | null }).zweiter_faktor_bis;

const schrittVon = (zeitMs: number) => Math.floor(zeitMs / SCHRITT);

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
// Einrichten
// ═════════════════════════════════════════════════════════════════

describe('Einrichten', () => {
  it('einrichten_zeigt_geheimnis_und_adresse: ohne Geheimnis zeigt die Seite einen neuen Schlüssel in Vierergruppen und die otpauth-Adresse zum Abtippen', async () => {
    const { app, db, anmelden } = await makeApp();
    const { cookie } = anmelden(JAN);
    const res = await seite(app, cookie);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html; charset=utf-8/);
    const geheimnis = geheimnisAusSeite(res.text);
    expect(geheimnis).toMatch(/^[A-Z2-7]{32}$/); // 20 Zufallsbytes
    expect(feld(res.text, 'geheimnis')).toBe(vierergruppen(geheimnis));
    expect(feld(res.text, 'otpauth')).toBe(
      `otpauth://totp/straightup%20Sicherheit:${JAN}?secret=${geheimnis}&issuer=straightup%20Sicherheit&algorithm=SHA1&digits=6&period=30`,
    );
    expect(res.text).toContain('<form method="post" action="/sicherheit/zweiter-faktor">');
    expect(res.text).toContain('name="code"');
    // Der Server hat das Geheimnis als Entwurf abgelegt, eingerichtet ist noch nichts
    expect(nutzerZeile(db, JAN)).toEqual({ totp_geheimnis: null, totp_entwurf: geheimnis, totp_letzter_schritt: null });
  });

  it('einrichten_zeigt_denselben_entwurf_wieder: bei jedem Aufruf, in jeder Session des Kontos; ein anderes Konto bekommt einen anderen', async () => {
    const { app, anmelden } = await makeApp();
    const erste = geheimnisAusSeite((await seite(app, anmelden(JAN).cookie)).text);
    const zweite = geheimnisAusSeite((await seite(app, anmelden(JAN).cookie)).text);
    const dritte = geheimnisAusSeite((await seite(app, anmelden(JAN).cookie)).text);
    expect(erste).toMatch(/^[A-Z2-7]{32}$/);
    expect([zweite, dritte]).toEqual([erste, erste]);
    const gabi = geheimnisAusSeite((await seite(app, anmelden(GABI).cookie)).text);
    expect(gabi).toMatch(/^[A-Z2-7]{32}$/);
    expect(gabi).not.toBe(erste);
  });

  it('einrichten_speichert_erst_nach_richtigem_code: ein falscher Code ändert nichts, der richtige macht den Entwurf zum Geheimnis und bestätigt die Session gleich mit', async () => {
    const ctx = await makeApp();
    const { app, db } = ctx;
    const s = ctx.mitEntwurf(JAN);
    const gezeigt = await seite(app, s.cookie);
    expect(geheimnisAusSeite(gezeigt.text)).toBe(GEHEIMNIS_JAN);

    // falscher Code: nichts wird eingerichtet, die Seite zeigt denselben Schlüssel noch einmal
    const falsch = await eingabe(app, s.cookie, falscherCode(GEHEIMNIS_JAN, START.getTime()));
    expect(falsch.status).toBe(401);
    expect(geheimnisAusSeite(falsch.text)).toBe(GEHEIMNIS_JAN);
    expect(nutzerZeile(db, JAN)).toEqual({ totp_geheimnis: null, totp_entwurf: GEHEIMNIS_JAN, totp_letzter_schritt: null });
    expect(bestaetigtBis(db, s.token)).toBeNull();
    expect((await api(app, s.cookie)).status).toBe(403);

    // richtiger Code: der Entwurf wird zum Geheimnis, der Entwurf verschwindet
    const richtig = await eingabe(app, s.cookie, ctx.code(GEHEIMNIS_JAN));
    expect(richtig.status).toBe(303);
    expect(richtig.headers.location).toBe('/sicherheit');
    expect(nutzerZeile(db, JAN)).toEqual({
      totp_geheimnis: GEHEIMNIS_JAN,
      totp_entwurf: null,
      totp_letzter_schritt: schrittVon(START.getTime()),
    });
    // Wer gerade eingerichtet hat, muss nicht gleich noch einen Code tippen: der Code von eben war ja einer
    expect((await api(app, s.cookie)).status).toBe(200);
    expect(bestaetigtBis(db, s.token)).toBe(new Date(START.getTime() + ZWOELF_STUNDEN).toISOString());
  });

  it('einrichten_nur_ohne_geheimnis: ist eins eingerichtet, zeigt die Seite keinen Schlüssel und legt keinen Entwurf an', async () => {
    const { app, db, mitFaktor } = await makeApp();
    const s = mitFaktor(JAN);
    const res = await seite(app, s.cookie);

    expect(res.status).toBe(200);
    expect(res.text).toContain('name="code"'); // die Seite fragt nur noch nach dem Code
    for (const spur of ['id="geheimnis"', 'id="otpauth"', 'otpauth://', GEHEIMNIS_JAN, vierergruppen(GEHEIMNIS_JAN)]) {
      expect(res.text, spur).not.toContain(spur);
    }
    expect(nutzerZeile(db, JAN).totp_entwurf).toBeNull();
  });

  it('einrichten_nur_ohne_geheimnis (Rest): ein übrig gebliebener Entwurf wird weder gezeigt noch angenommen, das Geheimnis bleibt', async () => {
    const { app, db, mitFaktor, code } = await makeApp();
    const s = mitFaktor(JAN);
    db.prepare('UPDATE users SET totp_entwurf = ? WHERE email = ?').run(ANGREIFER, JAN);

    const res = await seite(app, s.cookie);
    expect(res.text).not.toContain(ANGREIFER);
    expect(res.text).not.toContain('id="geheimnis"');

    // Auch ein Code zum Entwurf (samt Feldern, die ein Geheimnis setzen wollen) richtet nichts neu ein
    const versuch = await eingabe(app, s.cookie, code(ANGREIFER), { felder: { geheimnis: ANGREIFER, entwurf: ANGREIFER } });
    expect(versuch.status).toBe(401);
    expect(nutzerZeile(db, JAN).totp_geheimnis).toBe(GEHEIMNIS_JAN);
    expect((await api(app, s.cookie)).status).toBe(403);
  });

  it('der_browser_schickt_nie_ein_geheimnis: Felder mit einem Geheimnis im Formular werden ignoriert, es zählt der Entwurf des Servers', async () => {
    const ctx = await makeApp();
    const { app, db } = ctx;
    const s = ctx.mitEntwurf(JAN);
    await seite(app, s.cookie);
    const felder = { geheimnis: ANGREIFER, entwurf: ANGREIFER, secret: ANGREIFER, totp_geheimnis: ANGREIFER };

    // der Code passt zum Geheimnis des Angreifers, nicht zum Entwurf des Servers
    expect(pruefeTotp(GEHEIMNIS_JAN, ctx.code(ANGREIFER), START.getTime())).toBe(false); // Voraussetzung des Tests
    const fremd = await eingabe(app, s.cookie, ctx.code(ANGREIFER), { felder });
    expect(fremd.status).toBe(401);
    expect(nutzerZeile(db, JAN)).toMatchObject({ totp_geheimnis: null, totp_entwurf: GEHEIMNIS_JAN });

    // mit dem Code zum Entwurf gilt das Geheimnis des Servers, was auch im Formular steht
    const richtig = await eingabe(app, s.cookie, ctx.code(GEHEIMNIS_JAN), { felder });
    expect(richtig.status).toBe(303);
    expect(nutzerZeile(db, JAN)).toMatchObject({ totp_geheimnis: GEHEIMNIS_JAN, totp_entwurf: null });
  });

  it('einrichten_ohne_vorherigen_aufruf_der_seite: ein Code ohne Entwurf richtet nichts ein, der Schlüssel wird angelegt und gezeigt', async () => {
    const { app, db, anmelden } = await makeApp();
    const s = anmelden(JAN);
    expect(nutzerZeile(db, JAN).totp_entwurf).toBeNull();

    const res = await eingabe(app, s.cookie, '123456');
    expect(res.status).toBe(400);
    expect(res.text).toContain('Lege zuerst den Eintrag in der App an');
    const entwurf = nutzerZeile(db, JAN).totp_entwurf;
    expect(entwurf).toMatch(/^[A-Z2-7]{32}$/);
    expect(geheimnisAusSeite(res.text)).toBe(entwurf);
    expect(nutzerZeile(db, JAN).totp_geheimnis).toBeNull();
    expect((await api(app, s.cookie)).status).toBe(403);
  });

  it('einrichten_zuruecksetzen: ohne Geheimnis (Spalte NULL) richtet das Konto neu ein, schon im selben Schritt wie der letzte alte Code', async () => {
    const ctx = await makeApp();
    const { app, db } = ctx;
    const s = ctx.mitEntwurf(JAN);
    await seite(app, s.cookie);
    expect((await eingabe(app, s.cookie, ctx.code(GEHEIMNIS_JAN))).status).toBe(303); // eingerichtet im Schritt s0

    db.prepare('UPDATE users SET totp_geheimnis = NULL WHERE email = ?').run(JAN); // der Weg zum Zurücksetzen
    expect((await api(app, s.cookie)).status).toBe(403); // die bestätigte Session verliert ihre Bestätigung sofort

    const neu = geheimnisAusSeite((await seite(app, s.cookie)).text);
    expect(neu).toMatch(/^[A-Z2-7]{32}$/);
    expect(neu).not.toBe(GEHEIMNIS_JAN);
    expect(nutzerZeile(db, JAN).totp_letzter_schritt).toBe(schrittVon(START.getTime())); // der alte Stand ist noch da ...
    const erster = await eingabe(app, s.cookie, ctx.code(neu)); // ... und steht dem neuen Geheimnis nicht im Weg
    expect(erster.status).toBe(303);
    expect((await api(app, s.cookie)).status).toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════
// Code eingeben
// ═════════════════════════════════════════════════════════════════

describe('Code eingeben', () => {
  it('ohne_zweiten_faktor_weiter_zur_eingabe: eine Session ohne Bestätigung bekommt vom API den Hinweis auf die Eingabeseite, und die Seite fragt nach dem Code', async () => {
    const { app, mitFaktor } = await makeApp();
    const s = mitFaktor(JAN);

    const gesperrt = await api(app, s.cookie);
    expect(gesperrt.status).toBe(403);
    expect(gesperrt.body.error).toBe('zweiter_faktor_fehlt');
    expect(gesperrt.body.message).toContain(ZWEITER_FAKTOR_PFAD);
    expect(ZWEITER_FAKTOR_PFAD).toBe('/sicherheit/zweiter-faktor');

    // Die Eingabeseite selbst liegt nicht hinter dem zweiten Faktor
    const eingabeSeite = await seite(app, s.cookie);
    expect(eingabeSeite.status).toBe(200);
    expect(eingabeSeite.text).toContain('<form method="post" action="/sicherheit/zweiter-faktor">');
    expect(eingabeSeite.text).toContain('name="code"');
    expect(eingabeSeite.text).toContain('12 Stunden');
    expect(eingabeSeite.text).not.toContain('id="geheimnis"');
  });

  it('richtiger_code_bestaetigt_nur_diese_session: 303 nach /sicherheit, danach 200 im API; andere Sessions und andere Konten bleiben zu', async () => {
    const ctx = await makeApp();
    const { app } = ctx;
    const a = ctx.mitFaktor(JAN);
    const b = ctx.anmelden(JAN); // zweite Anmeldung desselben Kontos
    const gabi = ctx.mitFaktor(GABI);

    const res = await eingabe(app, a.cookie, ctx.code(GEHEIMNIS_JAN));
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/sicherheit');
    expect(res.headers['cache-control']).toBe('no-store');
    expect((await api(app, a.cookie)).status).toBe(200);
    expect((await api(app, b.cookie)).status).toBe(403);
    expect((await api(app, gabi.cookie)).status).toBe(403);
    // Der Code von Jan öffnet Gabi nichts: jedes Konto hat sein Geheimnis
    expect((await eingabe(app, gabi.cookie, ctx.code(GEHEIMNIS_JAN))).status).toBe(401);
    expect((await eingabe(app, gabi.cookie, ctx.code(GEHEIMNIS_GABI))).status).toBe(303);
    expect((await api(app, gabi.cookie)).status).toBe(200);
  });

  it('falscher_code: 401 mit deutschem Hinweis und derselben Eingabeseite, die Session bleibt unbestätigt, nichts wird gemerkt', async () => {
    const ctx = await makeApp();
    const { app, db } = ctx;
    const s = ctx.mitFaktor(JAN);
    for (const falsch of [falscherCode(GEHEIMNIS_JAN, START.getTime()), ctx.code(GEHEIMNIS_GABI), ctx.code(GEHEIMNIS_JAN, -2 * SCHRITT), ctx.code(GEHEIMNIS_JAN, 2 * SCHRITT)]) {
      const res = await eingabe(app, s.cookie, falsch);
      expect(res.status, falsch).toBe(401);
      expect(res.headers['content-type']).toMatch(/^text\/html/);
      expect(res.text).toContain('Der Code stimmt nicht oder wurde schon verwendet');
      expect(res.text).toContain('name="code"');
      expect(res.text).not.toContain(falsch);
    }
    expect((await api(app, s.cookie)).status).toBe(403);
    expect(bestaetigtBis(db, s.token)).toBeNull();
    expect(nutzerZeile(db, JAN).totp_letzter_schritt).toBeNull();
    // Gegenprobe: danach geht der richtige Code durch (vier Fehlversuche sind noch keine Sperre)
    expect((await eingabe(app, s.cookie, ctx.code(GEHEIMNIS_JAN))).status).toBe(303);
  });

  it('code_zweimal_wird_abgelehnt: derselbe Code gilt nicht noch einmal, weder in der Session noch in einer anderen; der nächste Code geht', async () => {
    const ctx = await makeApp();
    const { app } = ctx;
    const a = ctx.mitFaktor(JAN);
    const b = ctx.anmelden(JAN);
    const code = ctx.code(GEHEIMNIS_JAN);

    expect((await eingabe(app, a.cookie, code)).status).toBe(303);
    expect((await eingabe(app, a.cookie, code)).status).toBe(401); // dieselbe Session
    const andere = await eingabe(app, b.cookie, code); // eine andere Anmeldung desselben Kontos
    expect(andere.status).toBe(401);
    expect((await api(app, b.cookie)).status).toBe(403);

    // Auch der Code des Schritts davor (liegt im Fenster) ist verbraucht, der des nächsten Schritts nicht
    expect((await eingabe(app, b.cookie, ctx.code(GEHEIMNIS_JAN, -SCHRITT))).status).toBe(401);
    expect((await eingabe(app, b.cookie, ctx.code(GEHEIMNIS_JAN, SCHRITT))).status).toBe(303); // Fenster +30 s
    expect((await api(app, b.cookie)).status).toBe(200);
  });

  it('code_aus_dem_nachbarschritt_gilt: eine Uhr, die 30 s vor oder nach der App geht, stört nicht; 60 s sind zu viel', async () => {
    const ctx = await makeApp();
    const { app } = ctx;
    ctx.weiter(10 * SCHRITT);
    const jan = ctx.mitFaktor(JAN);
    const gabi = ctx.mitFaktor(GABI); // noch kein Code angenommen: Ablehnungen liegen hier am Fenster, nicht an einer Wiederholung

    expect((await eingabe(app, jan.cookie, ctx.code(GEHEIMNIS_JAN, -SCHRITT))).status).toBe(303); // Handy geht 30 s nach
    expect((await eingabe(app, gabi.cookie, ctx.code(GEHEIMNIS_GABI, -2 * SCHRITT))).status).toBe(401); // 60 s nach
    expect((await eingabe(app, gabi.cookie, ctx.code(GEHEIMNIS_GABI, 2 * SCHRITT))).status).toBe(401); // 60 s vor
    expect((await eingabe(app, gabi.cookie, ctx.code(GEHEIMNIS_GABI, SCHRITT))).status).toBe(303); // 30 s vor
  });

  it('eingabe_wird_bereinigt: Leerzeichen im Code sind in Ordnung (so zeigen Apps ihn an), alles andere ist 400 und zählt nicht als Fehlversuch', async () => {
    const ctx = await makeApp();
    const { app } = ctx;
    const s = ctx.mitFaktor(JAN);
    const richtig = ctx.code(GEHEIMNIS_JAN);

    for (const unlesbar of ['', '12345', '1234567', 'abcdef', '12-3456', '１２３４５６']) {
      const res = await eingabe(app, s.cookie, unlesbar);
      expect(res.status, JSON.stringify(unlesbar)).toBe(400);
      expect(res.text).toContain('sechsstelligen Code');
    }
    expect((await eingabe(app, s.cookie, null)).status).toBe(400); // Feld fehlt
    expect((await eingabe(app, s.cookie, null, { felder: { code: ['1', '2'] } })).status).toBe(400); // zweimal angegeben
    expect((await eingabe(app, s.cookie, null, { felder: { 'code[x]': '123456' } })).status).toBe(400); // verschachtelt
    // neun Eingaben, die kein Code sind, haben die Sperre nicht angerührt (sie schlüge nach fünf zu)
    expect((await api(app, s.cookie)).status).toBe(403);
    const mitLeerzeichen = `${richtig.slice(0, 3)} ${richtig.slice(3)}`;
    expect((await eingabe(app, s.cookie, mitLeerzeichen)).status).toBe(303);
    expect((await api(app, s.cookie)).status).toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════
// Gültigkeit der Bestätigung
// ═════════════════════════════════════════════════════════════════

describe('Gültigkeit der Bestätigung', () => {
  it('bestaetigung_endet_nach_12_stunden: bis 12 Stunden minus eine Millisekunde offen, dann fragt die Seite wieder nach dem Code', async () => {
    const ctx = await makeApp();
    const { app, uhr } = ctx;
    const s = ctx.mitFaktor(JAN);
    expect((await eingabe(app, s.cookie, ctx.code(GEHEIMNIS_JAN))).status).toBe(303);

    uhr.jetzt = new Date(START.getTime() + ZWOELF_STUNDEN - 1);
    expect((await api(app, s.cookie)).status).toBe(200);
    uhr.jetzt = new Date(START.getTime() + ZWOELF_STUNDEN);
    const zu = await api(app, s.cookie);
    expect(zu.status).toBe(403);
    expect(zu.body.error).toBe('zweiter_faktor_fehlt');

    // Die Seite fragt wieder nach dem Code (ohne den Schlüssel noch einmal zu zeigen) ...
    const eingabeSeite = await seite(app, s.cookie);
    expect(eingabeSeite.text).toContain('name="code"');
    expect(eingabeSeite.text).not.toContain('id="geheimnis"');
    // ... und ein neuer Code öffnet wieder für 12 Stunden
    expect((await eingabe(app, s.cookie, ctx.code(GEHEIMNIS_JAN))).status).toBe(303);
    const zweiteBestaetigung = uhr.jetzt.getTime();
    uhr.jetzt = new Date(zweiteBestaetigung + ZWOELF_STUNDEN - 1);
    expect((await api(app, s.cookie)).status).toBe(200);
    uhr.jetzt = new Date(zweiteBestaetigung + ZWOELF_STUNDEN);
    expect((await api(app, s.cookie)).status).toBe(403);
  });

  it('bestaetigung_gilt_hoechstens_bis_zum_ablauf_der_session: läuft die Session früher ab, endet die Bestätigung mit ihr', async () => {
    const ctx = await makeApp();
    const { app, db, uhr } = ctx;
    uhr.jetzt = new Date(Math.floor(Date.now() / SCHRITT) * SCHRITT); // die Session läuft in echter Zeit ab: die Uhr bleibt in ihrer Nähe
    const s = ctx.mitFaktor(JAN);
    const ablauf = new Date(uhr.jetzt.getTime() + 60 * 60 * 1000); // in einer Stunde
    db.prepare('UPDATE sessions SET expires_at = ?').run(ablauf.toISOString());

    expect((await eingabe(app, s.cookie, ctx.code(GEHEIMNIS_JAN))).status).toBe(303);
    expect(bestaetigtBis(db, s.token)).toBe(ablauf.toISOString()); // nicht 12 Stunden

    const start = uhr.jetzt.getTime();
    uhr.jetzt = new Date(ablauf.getTime() - 1);
    expect((await api(app, s.cookie)).status).toBe(200);
    uhr.jetzt = new Date(ablauf.getTime());
    expect((await api(app, s.cookie)).status).toBe(403);
    expect(start).toBeLessThan(ablauf.getTime());
  });

  it('abmelden_beendet_die_bestaetigung: nach dem Abmelden und der nächsten Anmeldung braucht es wieder einen Code', async () => {
    const ctx = await makeApp();
    const { app, db } = ctx;
    const s = ctx.mitFaktor(JAN);
    expect((await eingabe(app, s.cookie, ctx.code(GEHEIMNIS_JAN))).status).toBe(303);
    expect((await api(app, s.cookie)).status).toBe(200);

    expect((await request(app).post('/auth/logout').set('Cookie', s.cookie)).status).toBe(204);
    expect((await api(app, s.cookie)).status).toBe(401); // die Session ist weg ...
    const uebrig = db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE zweiter_faktor_bis IS NOT NULL').get() as { n: number };
    expect(uebrig.n).toBe(0); // ... und mit ihr die Bestätigung

    const login = await request(app).post('/auth/login').send({ email: JAN, password: PASSWORT });
    expect(login.status).toBe(200);
    const neu = String(login.headers['set-cookie'][0]).split(';')[0];
    expect((await api(app, neu)).status).toBe(403);
  });

  it('session_loeschen_beendet_die_bestaetigung: auch wenn die Session auf anderem Weg endet (Passwortwechsel, Deaktivierung)', async () => {
    const ctx = await makeApp();
    const { app, sessions, users } = ctx;
    const s = ctx.mitFaktor(JAN);
    await eingabe(app, s.cookie, ctx.code(GEHEIMNIS_JAN));
    expect((await api(app, s.cookie)).status).toBe(200);
    sessions.deleteForUser(users.findByEmail(JAN)!.id);
    expect((await api(app, s.cookie)).status).toBe(401);
    // eine neue Session für dasselbe Konto erbt nichts
    expect((await api(app, ctx.anmelden(JAN).cookie)).status).toBe(403);
  });

  it('zuruecksetzen_beendet_bestaetigte_sessions: wer das Geheimnis zurücksetzt (Spalte NULL), sperrt damit auch die schon bestätigten Sessions', async () => {
    const ctx = await makeApp();
    const { app, db } = ctx;
    const s = ctx.mitFaktor(JAN);
    await eingabe(app, s.cookie, ctx.code(GEHEIMNIS_JAN));
    expect((await api(app, s.cookie)).status).toBe(200);
    db.prepare('UPDATE users SET totp_geheimnis = NULL WHERE email = ?').run(JAN);
    const res = await api(app, s.cookie);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('zweiter_faktor_fehlt');
  });
});

// ═════════════════════════════════════════════════════════════════
// Sperre nach Fehlversuchen
// ═════════════════════════════════════════════════════════════════

describe('Sperre nach Fehlversuchen', () => {
  it('sperre_nach_fuenf_fehlversuchen: fünf falsche Codes sperren die Eingabe des Kontos für 15 Minuten, auch für den richtigen Code und für andere Sessions', async () => {
    const ctx = await makeApp();
    const { app } = ctx;
    const a = ctx.mitFaktor(JAN);
    const falsch = falscherCode(GEHEIMNIS_JAN, START.getTime());
    for (let i = 1; i <= 5; i++) {
      expect((await eingabe(app, a.cookie, falsch)).status, `Versuch ${i}`).toBe(401);
    }

    const richtig = ctx.code(GEHEIMNIS_JAN);
    const gesperrt = await eingabe(app, a.cookie, richtig);
    expect(gesperrt.status).toBe(429);
    expect(gesperrt.headers['content-type']).toMatch(/^text\/html/);
    expect(gesperrt.text).toContain('gesperrt');
    expect(gesperrt.text).toMatch(/in 15 Minuten/);
    const wartezeit = Number(gesperrt.headers['retry-after']);
    expect(wartezeit).toBeGreaterThan(14 * 60);
    expect(wartezeit).toBeLessThanOrEqual(15 * 60);
    expect((await api(app, a.cookie)).status).toBe(403); // der richtige Code hat nichts geöffnet

    // Die Sperre gilt dem Konto: eine andere Anmeldung von Jan ist ebenso gesperrt ...
    const b = ctx.anmelden(JAN);
    expect((await eingabe(app, b.cookie, richtig)).status).toBe(429);
    expect((await eingabe(app, b.cookie, falsch)).status).toBe(429); // und weitere Versuche verlängern nichts
    // ... aber kein anderes Konto
    const gabi = ctx.mitFaktor(GABI);
    expect((await eingabe(app, gabi.cookie, ctx.code(GEHEIMNIS_GABI))).status).toBe(303);
    expect((await api(app, gabi.cookie)).status).toBe(200);
  });

  it('sperre_nach_fuenf_fehlversuchen (vier genügen nicht): nach vier falschen Codes geht der richtige noch', async () => {
    const ctx = await makeApp();
    const { app } = ctx;
    const s = ctx.mitFaktor(JAN);
    const falsch = falscherCode(GEHEIMNIS_JAN, START.getTime());
    for (let i = 1; i <= 4; i++) expect((await eingabe(app, s.cookie, falsch)).status).toBe(401);
    expect((await eingabe(app, s.cookie, ctx.code(GEHEIMNIS_JAN))).status).toBe(303);
  });

  it('sperre_gilt_auch_beim_einrichten: wer den Schlüssel in der App falsch abgetippt hat, wird nach fünf Versuchen gebremst', async () => {
    const ctx = await makeApp();
    const { app, db } = ctx;
    const s = ctx.mitEntwurf(JAN);
    const falsch = falscherCode(GEHEIMNIS_JAN, START.getTime());
    for (let i = 1; i <= 5; i++) expect((await eingabe(app, s.cookie, falsch)).status).toBe(401);
    const gesperrt = await eingabe(app, s.cookie, ctx.code(GEHEIMNIS_JAN));
    expect(gesperrt.status).toBe(429);
    expect(geheimnisAusSeite(gesperrt.text)).toBe(GEHEIMNIS_JAN); // die Seite zeigt den Schlüssel weiter
    expect(nutzerZeile(db, JAN).totp_geheimnis).toBeNull();
  });

  it('sperre_zaehlt_nur_falsche_codes_dieses_kontos: eine abgewiesene Origin und die Versuche fremder Konten zählen nicht', async () => {
    const ctx = await makeApp();
    const { app } = ctx;
    const s = ctx.mitFaktor(JAN);
    const falsch = falscherCode(GEHEIMNIS_JAN, START.getTime());
    for (let i = 0; i < 8; i++) {
      expect((await eingabe(app, s.cookie, falsch, { origin: 'https://boese.example.test' })).status).toBe(400);
      expect((await eingabe(app, s.cookie, falsch, { origin: null })).status).toBe(400);
    }
    const fremd = ctx.anmelden(FREMD);
    for (let i = 0; i < 8; i++) expect((await eingabe(app, fremd.cookie, falsch)).status).toBe(403);
    expect((await eingabe(app, s.cookie, ctx.code(GEHEIMNIS_JAN))).status).toBe(303); // Jan ist nicht gesperrt
  });

  it('eigene_bremse_ist_austauschbar: der Router nimmt die Bremse aus den Abhängigkeiten', async () => {
    const ctx = await makeApp({ codeFehlversuche: new FixedWindowLimiter(2, 60_000) });
    const s = ctx.mitFaktor(JAN);
    const falsch = falscherCode(GEHEIMNIS_JAN, START.getTime());
    expect((await eingabe(ctx.app, s.cookie, falsch)).status).toBe(401);
    expect((await eingabe(ctx.app, s.cookie, falsch)).status).toBe(401);
    expect((await eingabe(ctx.app, s.cookie, falsch)).status).toBe(429);
  });
});

// ═════════════════════════════════════════════════════════════════
// Zugang zur Seite
// ═════════════════════════════════════════════════════════════════

describe('Zugang zur Seite', () => {
  it('ohne_session_302_zum_login: GET und POST ohne gültige Session leiten zur Anmeldung, auch mit Master-Key; es wird nichts angelegt', async () => {
    const { app, db, anmelden } = await makeApp();
    anmelden(JAN); // Konto da, aber der Aufrufer ist nicht angemeldet
    const ziel = '/app/?next=%2Fsicherheit%2Fzweiter-faktor';
    const faelle: [string, request.Test][] = [
      ['GET ohne Cookie', seite(app)],
      ['GET mit Master-Key', seite(app).set('X-API-Key', MASTER_KEY)],
      ['GET mit erfundenem Cookie', seite(app, `${SESSION_COOKIE}=gibt-es-nicht`)],
      ['POST ohne Cookie', eingabe(app, undefined, '123456')],
      ['POST mit Master-Key', eingabe(app, undefined, '123456', { kopf: { 'X-API-Key': MASTER_KEY } })],
    ];
    for (const [name, aufruf] of faelle) {
      const res = await aufruf;
      expect(res.status, name).toBe(302);
      expect(res.headers.location, name).toBe(ziel);
    }
    expect(nutzerZeile(db, JAN)).toEqual({ totp_geheimnis: null, totp_entwurf: null, totp_letzter_schritt: null });
  });

  it('fremdes_konto_403: eine Session eines Kontos, das nicht in SICHERHEIT_NUTZER steht, bekommt 403, auch als Admin, und nichts wird angelegt', async () => {
    const { app, db, anmelden } = await makeApp();
    const fremd = anmelden(FREMD, 'admin');

    const get = await seite(app, fremd.cookie);
    expect(get.status).toBe(403);
    expect(get.headers['content-type']).toMatch(/^text\/html/);
    expect(get.text).toContain('keinen Zugang');
    expect(get.text).not.toContain('name="code"');
    const post = await eingabe(app, fremd.cookie, '123456');
    expect(post.status).toBe(403);
    expect(nutzerZeile(db, FREMD)).toEqual({ totp_geheimnis: null, totp_entwurf: null, totp_letzter_schritt: null });
    expect(protokoll.join('\n')).toMatch(/Zugriff verweigert \(konto\) von \S+: GET \/sicherheit\/zweiter-faktor/);
  });

  it('konten_ohne_gross_und_kleinschreibung: Jans Konto gilt auch, wenn die Liste anders schreibt als das Konto', async () => {
    const { app, anmelden } = await makeApp({ nutzer: ' JAN@EXAMPLE.TEST ' });
    const res = await seite(app, anmelden('Jan@Example.test').cookie);
    expect(res.status).toBe(200);
  });

  it('fremde_origin_400: ohne, mit fremder oder mit "null"-Origin wird der Code nicht einmal geprüft', async () => {
    const ctx = await makeApp();
    const { app, db } = ctx;
    const s = ctx.mitFaktor(JAN);
    const richtig = ctx.code(GEHEIMNIS_JAN);
    for (const origin of [null, 'https://boese.example.test', 'null', 'http://sicherheit.example.test:8080', 'https://sicherheit.example.test', `${EIGENE_ORIGIN}.boese.test`]) {
      const res = await eingabe(app, s.cookie, richtig, { origin });
      expect(res.status, String(origin)).toBe(400);
      expect(res.text).toContain('nicht von dieser Seite');
    }
    expect((await api(app, s.cookie)).status).toBe(403); // der richtige Code hat nichts geöffnet
    expect(nutzerZeile(db, JAN).totp_letzter_schritt).toBeNull(); // und ist nicht verbraucht
    expect((await eingabe(app, s.cookie, richtig)).status).toBe(303); // Gegenprobe mit eigener Origin
  });

  it('eigene_origin_hinter_dem_proxy: Schema aus X-Forwarded-Proto, Host aus Host oder X-Forwarded-Host (wie bei den Aufträgen)', async () => {
    const ctx = await makeApp({ trustProxy: true });
    const s = ctx.mitFaktor(JAN);
    const senden = (kopf: Record<string, string>, code: string) =>
      request(ctx.app).post(ZWEITER_FAKTOR_PFAD).set('Cookie', s.cookie).set(kopf).type('form').send({ code });
    const richtig = ctx.code(GEHEIMNIS_JAN);
    expect((await senden({ Host: 'oeffentlich.example.test', 'X-Forwarded-Proto': 'https', Origin: 'http://oeffentlich.example.test' }, richtig)).status).toBe(400);
    expect((await senden({ Host: 'oeffentlich.example.test', 'X-Forwarded-Proto': 'https', Origin: 'https://boese.example.test' }, richtig)).status).toBe(400);
    expect((await senden({ Host: 'intern:3500', 'X-Forwarded-Host': 'oeffentlich.example.test', 'X-Forwarded-Proto': 'https', Origin: 'https://oeffentlich.example.test' }, richtig)).status).toBe(303);
  });

  const fehlend: [string, Aufbau][] = [
    ['ohne Dienstschlüssel', { dienstSchluessel: undefined }],
    ['mit leerem Dienstschlüssel', { dienstSchluessel: '   ' }],
    ['ohne Konten', { nutzer: undefined }],
    ['mit leerer Kontenliste', { nutzer: ' , ' }],
  ];
  for (const [name, aufbau] of fehlend) {
    it(`ohne_konfiguration_503: ${name} ist die Funktion aus, auch die Seite für den zweiten Faktor (GET und POST, mit und ohne Anmeldung)`, async () => {
      const { app, db, anmelden } = await makeApp(aufbau);
      const s = anmelden(JAN);
      const antworten = [
        await seite(app, s.cookie),
        await seite(app),
        await eingabe(app, s.cookie, '123456'),
        await eingabe(app, undefined, '123456'),
      ];
      for (const antwort of antworten) {
        expect(antwort.status).toBe(503);
        expect(antwort.text).toContain('nicht eingerichtet');
      }
      expect(nutzerZeile(db, JAN)).toEqual({ totp_geheimnis: null, totp_entwurf: null, totp_letzter_schritt: null });
    });
  }
});

// ═════════════════════════════════════════════════════════════════
// Die Seiten selbst
// ═════════════════════════════════════════════════════════════════

describe('Die Seiten selbst', () => {
  it('antworten_werden_nicht_gecacht_und_geben_keinen_referrer_preis: Cache-Control no-store und Referrer-Policy same-origin auf jeder Antwort', async () => {
    const ctx = await makeApp();
    const { app } = ctx;
    const s = ctx.mitFaktor(JAN);
    const einrichtend = ctx.mitEntwurf(GABI);
    const fremd = ctx.anmelden(FREMD);
    const falsch = falscherCode(GEHEIMNIS_JAN, START.getTime());
    const antworten = [
      await seite(app, s.cookie), // Eingabe
      await seite(app, einrichtend.cookie), // Einrichten mit Schlüssel auf der Seite
      await eingabe(app, s.cookie, falsch), // 401
      await eingabe(app, s.cookie, 'x'), // 400
      await eingabe(app, s.cookie, falsch, { origin: null }), // 400 Origin
      await seite(app, fremd.cookie), // 403
      await eingabe(app, s.cookie, ctx.code(GEHEIMNIS_JAN)), // 303
    ];
    expect(antworten.map((a) => a.status)).toEqual([200, 200, 401, 400, 400, 403, 303]);
    for (const antwort of antworten) {
      expect(antwort.headers['cache-control'], String(antwort.status)).toBe('no-store');
      // Browser senden bei einem Formular-POST unter "no-referrer" (helmets Voreinstellung) den Origin "null";
      // "same-origin" lässt die echte Origin stehen, auf der die Prüfung beruht, und gibt nach außen nichts preis.
      expect(antwort.headers['referrer-policy'], String(antwort.status)).toBe('same-origin');
    }
    // Die 429-Antwort trägt sie auch
    const gesperrt = await makeApp({ codeFehlversuche: new FixedWindowLimiter(1, 60_000) });
    const g = gesperrt.mitFaktor(JAN);
    await eingabe(gesperrt.app, g.cookie, falsch);
    const antwort429 = await eingabe(gesperrt.app, g.cookie, falsch);
    expect(antwort429.status).toBe(429);
    expect(antwort429.headers['cache-control']).toBe('no-store');
    expect(antwort429.headers['referrer-policy']).toBe('same-origin');
  });

  it('seite_setzt_texte_als_text_ein: E-Mail-Adresse und Meldungen werden maskiert, nie als HTML ausgegeben', async () => {
    const boese = 'a&b"<i>x</i>\'@example.test';
    const ctx = await makeApp({ nutzer: boese });
    const s = ctx.mitEntwurf(boese, GEHEIMNIS_JAN);
    const res = await seite(ctx.app, s.cookie);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('<i>');
    expect(res.text).toContain('a&amp;b&quot;&lt;i&gt;x&lt;/i&gt;&#39;@example.test');
    // Die Adresse zum Abtippen hat die E-Mail URL-kodiert (und dann als Text maskiert)
    const adresse = feld(res.text, 'otpauth')!;
    expect(adresse.startsWith('otpauth://totp/straightup%20Sicherheit:a%26b%22%3Ci%3Ex%3C%2Fi%3E\'@example.test?secret=')).toBe(true);
    expect(() => new URL(adresse)).not.toThrow();
  });

  it('kein_geviertstrich_in_den_seiten: Jans Textsatz-Regel gilt für jede Variante der Seiten', async () => {
    const ctx = await makeApp();
    const { app } = ctx;
    const s = ctx.mitFaktor(JAN);
    const einrichtend = ctx.mitEntwurf(GABI);
    const fremd = ctx.anmelden(FREMD);
    const falsch = falscherCode(GEHEIMNIS_JAN, START.getTime());
    const falschGabi = falscherCode(GEHEIMNIS_GABI, START.getTime());
    const bremse = await makeApp({ codeFehlversuche: new FixedWindowLimiter(1, 60_000) });
    const b = bremse.mitFaktor(JAN);
    await eingabe(bremse.app, b.cookie, falsch);
    const aus = await makeApp({ nutzer: undefined });
    const seiten = [
      await seite(app, s.cookie),
      await seite(app, einrichtend.cookie),
      await eingabe(app, s.cookie, falsch),
      await eingabe(app, einrichtend.cookie, falschGabi),
      await eingabe(app, s.cookie, 'x'),
      await eingabe(app, s.cookie, falsch, { origin: null }),
      await seite(app, fremd.cookie),
      await eingabe(bremse.app, b.cookie, falsch),
      await seite(aus.app, aus.anmelden(JAN).cookie),
    ];
    expect(seiten.map((a) => a.status)).toEqual([200, 200, 401, 401, 400, 400, 403, 429, 503]);
    for (const antwort of seiten) {
      expect(antwort.text.length).toBeGreaterThan(100);
      expect(antwort.text, String(antwort.status)).not.toContain('\u2014'); // der Geviertstrich
    }
  });

  it('unerwarteter_fehler_500_ohne_details: die Seite sagt es allgemein und ohne Aufrufstapel, das Log nennt die Meldung', async () => {
    const ctx = await makeApp();
    const s = ctx.mitFaktor(JAN);
    vi.spyOn(ctx.store, 'zustand').mockImplementation(() => { throw new Error('Datenbank nicht erreichbar'); });

    const res = await seite(ctx.app, s.cookie);
    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toContain('Interner Fehler');
    expect(res.text).not.toContain('Datenbank nicht erreichbar');
    expect(res.text).not.toMatch(/\.ts:\d+|node_modules/); // kein Aufrufstapel
    const log = protokoll.join('\n');
    expect(log).toContain('Datenbank nicht erreichbar');
    expect(log).not.toMatch(/\.ts:\d+|node_modules/);
  });

  it('router_liest_das_formular_selbst: auch ohne die globalen Body-Parser von index.ts', async () => {
    const ctx = await makeApp({ ohneGlobaleParser: true });
    const s = ctx.mitFaktor(JAN);
    const res = await eingabe(ctx.app, s.cookie, ctx.code(GEHEIMNIS_JAN));
    expect(res.status).toBe(303);
    expect((await api(ctx.app, s.cookie)).status).toBe(200);
    // ... und begrenzt ihn: ein großer Körper wird nicht gelesen
    const gross = await eingabe(ctx.app, ctx.anmelden(JAN).cookie, 'x'.repeat(10_000));
    expect(gross.status).toBe(413);
    expect(gross.text).toContain('zu groß');
  });
});

// ═════════════════════════════════════════════════════════════════
// Log
// ═════════════════════════════════════════════════════════════════

describe('Log', () => {
  it('fehlversuche_stehen_mit_konto_und_ip_im_log: falsche Codes, Sperre und Zugriffsverweigerung sind nachzulesen', async () => {
    const ctx = await makeApp({ trustProxy: true });
    const s = ctx.mitFaktor(JAN);
    const ip = { 'X-Forwarded-For': '203.0.113.7' };
    const falsch = falscherCode(GEHEIMNIS_JAN, START.getTime());
    for (let i = 0; i < 6; i++) await eingabe(ctx.app, s.cookie, falsch, { kopf: ip });
    const log = protokoll.join('\n');
    expect(log).toContain('falscher Code für jan@example.test von 203.0.113.7');
    expect(log).toContain('Eingabe gesperrt für jan@example.test von 203.0.113.7');
    expect(log.match(/falscher Code für/g)).toHaveLength(5); // der sechste Versuch war gesperrt, kein weiterer Fehlversuch
  });

  it('erfolge_stehen_im_log: eingerichtet und bestätigt, mit Konto', async () => {
    const ctx = await makeApp();
    const s = ctx.mitEntwurf(JAN);
    await eingabe(ctx.app, s.cookie, ctx.code(GEHEIMNIS_JAN));
    ctx.weiter(SCHRITT);
    const b = ctx.anmelden(JAN);
    await eingabe(ctx.app, b.cookie, ctx.code(GEHEIMNIS_JAN));
    const log = protokoll.join('\n');
    expect(log).toContain('zweiter Faktor eingerichtet für jan@example.test');
    expect(log).toContain('zweiter Faktor bestätigt für jan@example.test');
  });

  it('geheimnis_code_und_token_stehen_nie_im_log: weder Schlüssel (auch in Vierergruppen) noch die gesendeten Codes noch Session-Token', async () => {
    const ctx = await makeApp({ trustProxy: true });
    const ip = { 'X-Forwarded-For': '203.0.113.7' };
    // Einrichtung über die Seite, mit einem Schlüssel, den der Server selbst erzeugt
    const einrichten = ctx.anmelden(GABI);
    const geheimnis = geheimnisAusSeite((await seite(ctx.app, einrichten.cookie)).text);
    const codes: string[] = [];
    const senden = async (cookie: string, code: string, opt: EingabeOpt = {}) => { codes.push(code); return eingabe(ctx.app, cookie, code, { kopf: ip, ...opt }); };

    const falsch = falscherCode(geheimnis, START.getTime());
    await senden(einrichten.cookie, falsch);
    await senden(einrichten.cookie, ctx.code(geheimnis));
    // Anmeldung eines Kontos mit Geheimnis: Fehlversuche bis zur Sperre, Origin, fremdes Konto
    const jan = ctx.mitFaktor(JAN);
    for (let i = 0; i < 5; i++) await senden(jan.cookie, falscherCode(GEHEIMNIS_JAN, START.getTime()));
    await senden(jan.cookie, ctx.code(GEHEIMNIS_JAN));
    await senden(jan.cookie, ctx.code(GEHEIMNIS_JAN), { origin: 'https://boese.example.test' });
    const fremd = ctx.anmelden(FREMD);
    await senden(fremd.cookie, '246802');
    await seite(ctx.app, fremd.cookie);

    const log = protokoll.join('\n');
    expect(log).toContain('falscher Code für'); // Gegenprobe: die Abläufe sind tatsächlich protokolliert
    expect(log).toContain('zweiter Faktor eingerichtet');
    expect(log).toContain('Eingabe gesperrt');
    for (const geheim of [geheimnis, vierergruppen(geheimnis), GEHEIMNIS_JAN, vierergruppen(GEHEIMNIS_JAN), ...codes, einrichten.token, jan.token, fremd.token, MASTER_KEY]) {
      expect(log, geheim).not.toContain(geheim);
    }
  });
});

// ═════════════════════════════════════════════════════════════════
// Speicher und Prüffunktion
// ═════════════════════════════════════════════════════════════════

describe('Speicher und Prüffunktion', () => {
  it('geheimnisse_verlassen_die_datenbank_nur_ueber_die_seite: Nutzerobjekte, /auth/me und /auth/login tragen weder Geheimnis noch Entwurf', async () => {
    const ctx = await makeApp();
    const s = ctx.mitFaktor(JAN);
    ctx.db.prepare('UPDATE users SET totp_entwurf = ? WHERE email = ?').run(ANGREIFER, JAN);
    await eingabe(ctx.app, s.cookie, ctx.code(GEHEIMNIS_JAN));

    const me = await request(ctx.app).get('/auth/me').set('Cookie', s.cookie);
    const login = await request(ctx.app).post('/auth/login').send({ email: JAN, password: PASSWORT });
    const ausgaben = [JSON.stringify(ctx.users.list()), JSON.stringify(ctx.users.findByEmail(JAN)), JSON.stringify(me.body), JSON.stringify(login.body)];
    expect(me.status).toBe(200);
    expect(login.status).toBe(200);
    for (const ausgabe of ausgaben) {
      expect(ausgabe).toContain(JAN); // Gegenprobe: das Konto steht drin
      expect(ausgabe).not.toContain(GEHEIMNIS_JAN);
      expect(ausgabe).not.toContain(ANGREIFER);
      expect(ausgabe).not.toMatch(/totp|zweiter_faktor/i);
    }
  });

  it('migration_v6_nur_neue_spalten: users und sessions bekommen die Spalten, leer; die Tabellen der Sicherheitsplattform bleiben unberührt', () => {
    const db = openDb(':memory:');
    const spalten = (tabelle: string) => (db.prepare(`PRAGMA table_info(${tabelle})`).all() as unknown as { name: string; notnull: number; dflt_value: unknown }[]);
    const users = spalten('users');
    for (const name of ['totp_geheimnis', 'totp_entwurf', 'totp_letzter_schritt']) {
      const spalte = users.find((c) => c.name === name);
      expect(spalte, name).toBeDefined();
      expect(spalte!.notnull, name).toBe(0);
    }
    expect(users.map((c) => c.name)).toEqual(expect.arrayContaining(['id', 'email', 'password_hash', 'awork_user_id']));
    const sessions = spalten('sessions');
    expect(sessions.find((c) => c.name === 'zweiter_faktor_bis')?.notnull).toBe(0);
    expect(sessions.map((c) => c.name)).toEqual(expect.arrayContaining(['token_hash', 'user_id', 'created_at', 'expires_at']));
    expect(spalten('sicherheit_auftraege').map((c) => c.name)).not.toContain('zweiter_faktor_bis');
  });

  it('store_bestaetige_ist_alles_oder_nichts: ohne Geheimnis, bei Wiederholung und bei unbekannter Session bleibt alles, wie es war', async () => {
    const { store, db, users, anmelden } = await makeApp();
    const s = anmelden(JAN);
    const id = users.findByEmail(JAN)!.id;

    expect(store.bestaetige(id, s.token, 5, START)).toBe(false); // kein Geheimnis eingerichtet
    expect(nutzerZeile(db, JAN).totp_letzter_schritt).toBeNull();
    expect(bestaetigtBis(db, s.token)).toBeNull();

    db.prepare('UPDATE users SET totp_geheimnis = ? WHERE email = ?').run(GEHEIMNIS_JAN, JAN);
    expect(store.bestaetige(id, 'gibt-es-nicht', 5, START)).toBe(false); // unbekannte Session: der Schritt wird nicht verbraucht
    expect(nutzerZeile(db, JAN).totp_letzter_schritt).toBeNull();

    expect(store.bestaetige(id, s.token, 5, START)).toBe(true);
    expect(nutzerZeile(db, JAN).totp_letzter_schritt).toBe(5);
    expect(bestaetigtBis(db, s.token)).toBe(new Date(START.getTime() + ZWOELF_STUNDEN).toISOString());
    expect(store.bestaetige(id, s.token, 5, START)).toBe(false); // derselbe Schritt
    expect(store.bestaetige(id, s.token, 4, START)).toBe(false); // ein früherer
    expect(nutzerZeile(db, JAN).totp_letzter_schritt).toBe(5);
    expect(store.bestaetige(id, s.token, 6, START)).toBe(true); // ein späterer
    expect(nutzerZeile(db, JAN).totp_letzter_schritt).toBe(6);
  });

  it('store_richte_ein_ist_alles_oder_nichts: nur mit dem Entwurf, der geprüft wurde, nur ohne Geheimnis, nur mit bekannter Session', async () => {
    const { store, db, users, anmelden } = await makeApp();
    const s = anmelden(JAN);
    const id = users.findByEmail(JAN)!.id;

    expect(store.richteEin(id, s.token, GEHEIMNIS_JAN, 7, START)).toBe(false); // es gibt keinen Entwurf
    db.prepare('UPDATE users SET totp_entwurf = ? WHERE email = ?').run(GEHEIMNIS_JAN, JAN);
    expect(store.richteEin(id, s.token, ANGREIFER, 7, START)).toBe(false); // der Entwurf ist ein anderer als der geprüfte
    expect(store.richteEin(id, 'gibt-es-nicht', GEHEIMNIS_JAN, 7, START)).toBe(false); // unbekannte Session
    expect(nutzerZeile(db, JAN)).toEqual({ totp_geheimnis: null, totp_entwurf: GEHEIMNIS_JAN, totp_letzter_schritt: null });

    expect(store.richteEin(id, s.token, GEHEIMNIS_JAN, 7, START)).toBe(true);
    expect(nutzerZeile(db, JAN)).toEqual({ totp_geheimnis: GEHEIMNIS_JAN, totp_entwurf: null, totp_letzter_schritt: 7 });
    expect(bestaetigtBis(db, s.token)).toBe(new Date(START.getTime() + ZWOELF_STUNDEN).toISOString());
    db.prepare('UPDATE users SET totp_entwurf = ? WHERE email = ?').run(ANGREIFER, JAN);
    expect(store.richteEin(id, s.token, ANGREIFER, 9, START)).toBe(false); // ein eingerichtetes Geheimnis wird nie ersetzt
    expect(nutzerZeile(db, JAN)).toMatchObject({ totp_geheimnis: GEHEIMNIS_JAN, totp_letzter_schritt: 7 });
  });

  it('store_entwurf_bereitstellen: legt einen an, behält den vorhandenen, und nach der Einrichtung gibt es keinen mehr', async () => {
    const { store, db, users, anmelden } = await makeApp();
    anmelden(JAN);
    const id = users.findByEmail(JAN)!.id;

    expect(store.entwurfBereitstellen(id, GEHEIMNIS_JAN)).toBe(GEHEIMNIS_JAN);
    expect(store.entwurfBereitstellen(id, ANGREIFER)).toBe(GEHEIMNIS_JAN); // der vorhandene bleibt
    expect(store.zustand(id)).toEqual({ geheimnis: null, entwurf: GEHEIMNIS_JAN });

    db.prepare('UPDATE users SET totp_geheimnis = ?, totp_entwurf = NULL WHERE email = ?').run(GEHEIMNIS_GABI, JAN);
    expect(store.entwurfBereitstellen(id, ANGREIFER)).toBeNull(); // eingerichtet: kein Entwurf
    expect(nutzerZeile(db, JAN).totp_entwurf).toBeNull();
    expect(store.zustand('gibt-es-nicht')).toEqual({ geheimnis: null, entwurf: null });
  });

  it('neue_session_ist_unbestaetigt: eine Anmeldung ohne Code hat zweiter_faktor_bis NULL', async () => {
    const ctx = await makeApp();
    const s = ctx.mitFaktor(JAN);
    expect(bestaetigtBis(ctx.db, s.token)).toBeNull();
  });

  it('pruefung_liest_die_session_aus_dem_cookie: ohne Cookie, mit fremdem Token, nach dem Löschen und nach Ablauf ist die Antwort nein', async () => {
    const ctx = await makeApp();
    const pruefung = createZweiterFaktorPruefung(ctx.store, () => ctx.uhr.jetzt);
    const aufruf = (cookie?: string) => pruefung({ headers: cookie ? { cookie } : {} } as express.Request, {} as express.Response);
    const s = ctx.mitFaktor(JAN);

    expect(aufruf()).toBe(false);
    expect(aufruf(s.cookie)).toBe(false); // noch nicht bestätigt
    await eingabe(ctx.app, s.cookie, ctx.code(GEHEIMNIS_JAN));
    expect(aufruf(s.cookie)).toBe(true);
    expect(aufruf(`${SESSION_COOKIE}=anderes-token`)).toBe(false);
    expect(aufruf(`andere=1; ${s.cookie}; weitere=2`)).toBe(true); // mehrere Cookies im Header
    ctx.uhr.jetzt = new Date(START.getTime() + ZWOELF_STUNDEN);
    expect(aufruf(s.cookie)).toBe(false);
    ctx.uhr.jetzt = new Date(START);
    expect(aufruf(s.cookie)).toBe(true);
    ctx.sessions.delete(s.token);
    expect(aufruf(s.cookie)).toBe(false);
  });
});
