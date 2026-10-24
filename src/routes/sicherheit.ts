import express, { Router, type ErrorRequestHandler, type Request, type RequestHandler, type Response } from 'express';
import { getAuth, safeEqual } from '../services/auth.js';
import { GENERIC_ERROR_MESSAGE } from '../services/errors.js';
import { FixedWindowLimiter } from '../services/rate-limit.js';
import { AUFTRAG_ARTEN, type AuftragArt, type SicherheitSpeicher } from '../services/sicherheit/speicher.js';

// ─── API der Sicherheitsplattform (Teil 1) ───────────────────────
//
// Zwei Router, weil die Endpunkte zwei verschiedene Anrufer haben:
//
//  Dienst (der Wachdienst im Agenten-Haus, Header X-Dienst-Schluessel): Stand
//  schieben, offene Aufträge holen, Aufträge quittieren. Kennt weder Session
//  noch Master-Key und hängt wie der Mail-Relay VOR der globalen /api-Auth,
//  dazu vor dem globalen JSON-Parser, weil der Stand bis 10 MB groß sein darf.
//
//  Nutzer (das Dashboard im Browser): Stand lesen, Aufträge anlegen und ihren
//  Verlauf lesen. Hängt HINTER der /api-Auth: Session eines Kontos aus
//  SICHERHEIT_NUTZER und bestätigter zweiter Faktor; der Master-Key reicht nie.
//
// Fehlt SICHERHEIT_DIENSTSCHLUESSEL oder SICHERHEIT_NUTZER, antwortet jeder
// Pfad unter /api/sicherheit mit 503. In keinem Log stehen der Schlüssel,
// Session-Token oder Inhalte des Stands.

const STAND_VERSION = 1;
const STAND_MAX = '10mb';
const QUITTUNG_BODY_MAX = '64kb';
/** Fehlversuche mit falschem Dienstschlüssel je IP, wie bei der /api-Auth. */
const FEHLVERSUCHE_MAX = 20;
const FEHLVERSUCHE_FENSTER_MS = 15 * 60 * 1000;
const GRUND_MAX = 500;
const ZWEITER_FAKTOR_PFAD = '/sicherheit/zweiter-faktor';

// ─── Konfiguration ───────────────────────────────────────────────

export interface SicherheitKonfig {
  /** SICHERHEIT_DIENSTSCHLUESSEL, getrimmt. Fehlt er, ist die Funktion aus. */
  dienstSchluessel: string | undefined;
  /** SICHERHEIT_NUTZER: E-Mail-Adressen der Konten, klein geschrieben. Ist die Liste leer, ist die Funktion aus. */
  nutzer: string[];
}

export interface SicherheitDeps extends SicherheitKonfig {
  speicher: SicherheitSpeicher;
  /**
   * Ist der zweite Faktor für die Session dieser Anfrage bestätigt? Läuft
   * erst, wenn Session und Konto geprüft sind; `res.locals.auth` ist gesetzt.
   * Task 9 liefert die echte Prüfung (TOTP); bis dahin gibt index.ts
   * `() => false` mit, und die Nutzer-Endpunkte bleiben für alle zu.
   */
  zweiterFaktorBestaetigt: (req: Request, res: Response) => boolean;
  /** Fehlversuche mit falschem Dienstschlüssel (Standard: 20 je 15 Minuten und IP). */
  fehlversuche?: FixedWindowLimiter;
  jetzt?: () => Date;
}

/** Liest die beiden Einstellungen. Leer oder nur Leerraum zählt als nicht gesetzt. */
export function leseSicherheitKonfig(env: Record<string, string | undefined>): SicherheitKonfig {
  return {
    dienstSchluessel: env.SICHERHEIT_DIENSTSCHLUESSEL?.trim() || undefined,
    nutzer: (env.SICHERHEIT_NUTZER ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  };
}

/** Die Namen (nie die Werte) der Einstellungen, die fehlen. Leer: die Funktion ist an. */
export function fehlendeSicherheitKonfig(konfig: SicherheitKonfig): string[] {
  return [
    ...(konfig.dienstSchluessel ? [] : ['SICHERHEIT_DIENSTSCHLUESSEL']),
    ...(konfig.nutzer.length > 0 ? [] : ['SICHERHEIT_NUTZER']),
  ];
}

/** Steht das Konto in SICHERHEIT_NUTZER? Ohne Rücksicht auf Groß- und Kleinschreibung. */
export function istSicherheitNutzer(nutzer: string[], email: string): boolean {
  return nutzer.includes(email.trim().toLowerCase());
}

// ─── Gemeinsames ─────────────────────────────────────────────────

const istObjekt = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** "METHODE /voller/pfad" fürs Log, ohne Query (ein Router mit Mount-Pfad kürzt req.path). */
const anfrageText = (req: Request) => `${req.method} ${req.baseUrl}${req.path}`;

/** Antworten dieser Pfade tragen Stand- oder Auftragsdaten: in keinen Cache. */
const keinCache: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

function nurWennKonfiguriert(konfig: SicherheitKonfig): RequestHandler {
  return (_req, res, next) => {
    if (fehlendeSicherheitKonfig(konfig).length > 0) {
      res.status(503).json({ error: 'nicht_konfiguriert', message: 'Die Sicherheitsplattform ist in dieser Middleware nicht eingerichtet.' });
      return;
    }
    next();
  };
}

/**
 * Fehler der Body-Parser und alles Unerwartete als JSON statt als HTML-Seite.
 * Geloggt wird nur die Meldung, nie das Fehlerobjekt (es könnte den Körper nennen).
 */
const behandleFehler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    console.warn(`⚠️ Sicherheit: Anfrage abgewiesen (${status}): ${anfrageText(req)}`);
  }
  if (status === 413) {
    res.status(413).json({ error: 'payload_too_large', message: 'Die Anfrage ist größer als erlaubt.' });
    return;
  }
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(400).json({ error: 'validation', message: 'Die Anfrage ließ sich nicht lesen (kein gültiges JSON?).' });
    return;
  }
  console.error(`❌ Sicherheit: ${err instanceof Error ? err.message : String(err)}`);
  res.status(500).json({ error: 'internal', message: GENERIC_ERROR_MESSAGE });
};

// ─── Dienst-Router ───────────────────────────────────────────────

/**
 * POST /api/sicherheit/stand · GET /api/sicherheit/auftraege?offen=1 ·
 * POST /api/sicherheit/auftraege/:id/quittung. Muss VOR dem globalen
 * JSON-Parser und der /api-Auth gemountet werden (siehe index.ts).
 */
export function createSicherheitDienstRouter(deps: SicherheitDeps): Router {
  const router = Router();
  const fehlversuche = deps.fehlversuche ?? new FixedWindowLimiter(FEHLVERSUCHE_MAX, FEHLVERSUCHE_FENSTER_MS);
  const jetzt = deps.jetzt ?? (() => new Date());

  router.use('/api/sicherheit', keinCache, nurWennKonfiguriert(deps));

  const dienstAuth: RequestHandler = (req, res, next) => {
    const ip = req.ip || 'unbekannt';
    if (fehlversuche.blocked(ip)) {
      res.set('Retry-After', String(fehlversuche.sekundenBisReset(ip)));
      res.status(429).json({ error: 'rate_limited', message: 'Zu viele fehlgeschlagene Versuche, bitte später erneut' });
      return;
    }
    const gegeben = req.headers['x-dienst-schluessel'];
    if (typeof gegeben !== 'string' || !deps.dienstSchluessel || !safeEqual(gegeben, deps.dienstSchluessel)) {
      fehlversuche.hit(ip);
      console.warn(`🛡️ Sicherheit: ungültiger Dienstschlüssel von ${ip}: ${anfrageText(req)}`);
      res.status(401).json({ error: 'invalid_key', message: 'Dienstschlüssel fehlt oder ist falsch' });
      return;
    }
    next();
  };

  // Mit ?offen=1 ist es der Dienst-Endpunkt; ohne ist es der Verlauf der Nutzer,
  // der hinter der /api-Auth im Nutzer-Router liegt.
  const nurOffene: RequestHandler = (req, _res, next) => (req.query.offen === '1' ? next() : next('route'));

  // Der Schlüssel wird geprüft, bevor der Körper gelesen wird: Wer ihn nicht hat, kann keine 10 MB abladen.
  router.post('/api/sicherheit/stand', dienstAuth, express.json({ limit: STAND_MAX }), (req, res) => {
    const stand: unknown = req.body;
    if (!istObjekt(stand)) {
      res.status(400).json({ error: 'validation', message: 'Der Stand muss ein JSON-Objekt sein.' });
      return;
    }
    if (stand.version !== STAND_VERSION) {
      console.warn(`⚠️ Sicherheit: Stand abgewiesen (Version ${typeof stand.version === 'number' ? stand.version : 'unlesbar'}, erwartet ${STAND_VERSION})`);
      res.status(400).json({ error: 'validation', message: `Die Version des Stands wird nicht unterstützt (erwartet: ${STAND_VERSION}).` });
      return;
    }
    deps.speicher.speichereStand(stand, jetzt());
    console.log('🛡️ Sicherheit: Stand empfangen');
    res.json({ ok: true });
  });

  router.get('/api/sicherheit/auftraege', nurOffene, dienstAuth, (_req, res) => {
    res.json({ auftraege: deps.speicher.offeneAuftraege() });
  });

  router.post('/api/sicherheit/auftraege/:id/quittung', dienstAuth, express.json({ limit: QUITTUNG_BODY_MAX }), (req, res) => {
    const koerper: unknown = req.body;
    if (!istObjekt(koerper) || typeof koerper.ok !== 'boolean' || typeof koerper.text !== 'string') {
      res.status(400).json({ error: 'validation', message: 'Erwartet { "ok": true oder false, "text": "…" }.' });
      return;
    }
    const id = req.params.id as string;
    const ergebnis = deps.speicher.quittiere(id, koerper.ok, koerper.text, jetzt());
    if (ergebnis === 'unbekannt') {
      res.status(404).json({ error: 'auftrag_unbekannt', message: 'Diesen Auftrag gibt es nicht.' });
      return;
    }
    if (ergebnis === 'neu') console.log(`🛡️ Sicherheit: Auftrag ${id} quittiert (${koerper.ok ? 'angewandt' : 'fehler'})`);
    res.json({ ok: true });
  });

  router.use(behandleFehler);
  return router;
}

// ─── Nutzer: Zugang ──────────────────────────────────────────────

function verweigert(req: Request, res: Response, grund: string, fehler: string, text: string): void {
  console.warn(`🔒 Sicherheit: Zugriff verweigert (${grund}) von ${req.ip || 'unbekannt'}: ${anfrageText(req)}`);
  res.status(403).json({ error: fehler, message: text });
}

/**
 * Nur eine Session eines Kontos aus SICHERHEIT_NUTZER mit bestätigtem zweiten
 * Faktor. Läuft nach der /api-Auth. Reihenfolge: erst Master-Key, dann Konto,
 * dann zweiter Faktor, damit ein Fremder nicht erfährt, wie weit er kam.
 */
function nurNutzer(deps: SicherheitDeps): RequestHandler {
  return (req, res, next) => {
    const auth = getAuth(res);
    if (!auth) {
      // Nur möglich, wenn der Router ohne die /api-Auth gemountet wurde: dann lieber zu.
      res.status(401).json({ error: 'unauthenticated', message: 'Anmeldung erforderlich' });
      return;
    }
    if (auth.via !== 'session' || !auth.user) {
      verweigert(req, res, 'master-key', 'forbidden', 'Die Sicherheitsplattform ist nur mit Anmeldung erreichbar, der Master-Key reicht nicht.');
      return;
    }
    if (!istSicherheitNutzer(deps.nutzer, auth.user.email)) {
      verweigert(req, res, 'konto', 'forbidden', 'Dieses Konto hat keinen Zugang zur Sicherheitsplattform.');
      return;
    }
    if (!deps.zweiterFaktorBestaetigt(req, res)) {
      verweigert(req, res, 'zweiter-faktor', 'zweiter_faktor_fehlt', `Der zweite Faktor ist noch nicht bestätigt. Bitte unter ${ZWEITER_FAKTOR_PFAD} bestätigen.`);
      return;
    }
    next();
  };
}

/**
 * Ist der Origin-Header der Anfrage die eigene Origin? Eigene Origin heißt
 * Schema und Host dieser Anfrage; hinter dem Proxy kommt der öffentliche Host
 * als Host oder als X-Forwarded-Host an, das Schema aus req.protocol (trust
 * proxy). Ein fehlender, fremder oder "null"-Origin zählt nicht. Ein
 * Browser-Aufruf von fremder Seite kann diese Header nicht fälschen.
 */
export function istEigeneOrigin(req: Request): boolean {
  const gegeben = req.get('origin');
  if (!gegeben) return false;
  const hosts = [req.get('host'), req.get('x-forwarded-host')?.split(',')[0].trim()];
  return hosts.some((host) => {
    if (!host) return false;
    try {
      return new URL(`${req.protocol}://${host}`).origin === gegeben;
    } catch {
      return false; // unlesbarer Host-Header
    }
  });
}

// ─── Nutzer: Aufträge prüfen ─────────────────────────────────────
//
// Die Formen sind die, die der Kern anwendet (wachdienst/befehle.ts,
// auftragAnwenden); was er ablehnen würde, lehnt schon die API ab, damit der
// Nutzer sofort einen Fehler sieht statt erst nach der Quittung.

const AUFTRAG_FELDER = ['art', 'site', 'typ', 'werte'];
const STUFEN = ['premium', 'standard', 'ohne', 'bewusst-ohne', 'intern', 'neu'];
const MERKER_SCHALTER = ['vip', 'fremdhosting', 'kein_ssh_moeglich'];
/** Befundtypen wie A1, B6b, I9: kurz, ohne Leerraum. */
const TYP_MUSTER = /^[A-Za-z0-9_.-]{1,32}$/;

interface GepruefterAuftrag {
  art: AuftragArt;
  site: string;
  typ?: string;
  werte: Record<string, unknown>;
}

/** Ein Kalendertag JJJJ-MM-TT, den es gibt (der 30.02. wird abgewiesen). Wie im Kern. */
function istKalendertag(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const tag = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(tag.getTime()) && tag.toISOString().startsWith(text);
}

/** Der Fehlertext zu einem Datum, das bis zum UTC-Tagesende in der Zukunft liegen muss (stumm, pause_bis), oder null. Wie im Kern. */
function zukunftsdatumFehler(wert: unknown, jetztIso: string): string | null {
  if (typeof wert !== 'string' || !istKalendertag(wert)) return 'erwartet ein Datum im Format JJJJ-MM-TT';
  if (`${wert}T23:59:59.999Z` <= jetztIso) return 'liegt nicht in der Zukunft';
  return null;
}

/** Prüft `werte` je Art und gibt sie in der Form zurück, die gespeichert wird; sonst den Fehlertext. */
function pruefeWerte(art: AuftragArt, werte: Record<string, unknown>, jetztIso: string): Record<string, unknown> | string {
  const schluessel = Object.keys(werte);
  const fremde = (erlaubt: string[]) => schluessel.filter((k) => !erlaubt.includes(k));
  switch (art) {
    case 'erledigt':
    case 'ueberwachen':
    case 'durchgesehen':
      return schluessel.length === 0 ? {} : `werte: bei „${art}" nicht vorgesehen`;
    case 'stumm': {
      if (fremde(['bis']).length > 0) return 'werte: erlaubt ist nur „bis"';
      const fehler = zukunftsdatumFehler(werte.bis, jetztIso);
      return fehler ? `werte.bis: ${fehler}` : { bis: werte.bis };
    }
    case 'stimmt':
    case 'kein-hack': {
      if (fremde(['befundId']).length > 0) return 'werte: erlaubt ist nur „befundId"';
      const id = werte.befundId;
      if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) return 'werte.befundId: erwartet eine ganze Zahl ab 1';
      return { befundId: id };
    }
    case 'stufe': {
      if (fremde(['stufe']).length > 0) return 'werte: erlaubt ist nur „stufe"';
      if (typeof werte.stufe !== 'string' || !STUFEN.includes(werte.stufe)) return `werte.stufe: erlaubt sind ${STUFEN.join(', ')}`;
      return { stufe: werte.stufe };
    }
    case 'merker': {
      if (schluessel.length === 0) return 'werte: mindestens ein Merker nötig (vip, fremdhosting, kein_ssh_moeglich, pause_bis)';
      if (fremde([...MERKER_SCHALTER, 'pause_bis']).length > 0) return 'werte: erlaubt sind nur vip, fremdhosting, kein_ssh_moeglich und pause_bis';
      const merker: Record<string, unknown> = {};
      for (const schalter of MERKER_SCHALTER) {
        if (!Object.hasOwn(werte, schalter)) continue;
        if (typeof werte[schalter] !== 'boolean') return `werte.${schalter}: erwartet true oder false`;
        merker[schalter] = werte[schalter];
      }
      if (Object.hasOwn(werte, 'pause_bis')) {
        if (werte.pause_bis !== null) {
          const fehler = zukunftsdatumFehler(werte.pause_bis, jetztIso);
          if (fehler) return `werte.pause_bis: ${fehler} (oder null zum Entfernen)`;
        }
        merker.pause_bis = werte.pause_bis;
      }
      return merker;
    }
    case 'nicht-ueberwacht': {
      if (fremde(['grund']).length > 0) return 'werte: erlaubt ist nur „grund"';
      const grund = typeof werte.grund === 'string' ? werte.grund.trim() : '';
      if (grund === '') return 'werte.grund: für „nicht überwacht" ist ein Grund Pflicht';
      if (grund.length > GRUND_MAX) return `werte.grund: höchstens ${GRUND_MAX} Zeichen`;
      return { grund };
    }
    default: {
      const nichtBehandelt: never = art; // eine neue Art zwingt den Compiler, sie hier zu prüfen
      return nichtBehandelt;
    }
  }
}

/** Prüft den Körper von POST /api/sicherheit/auftraege: der geprüfte Auftrag oder der Fehlertext. */
function pruefeAuftrag(body: unknown, jetztIso: string): GepruefterAuftrag | string {
  if (!istObjekt(body)) return 'Der Auftrag muss ein JSON-Objekt sein.';
  if (Object.keys(body).some((k) => !AUFTRAG_FELDER.includes(k))) {
    return 'Der Auftrag darf nur art, site, typ und werte enthalten; ID, Urheber und Zeit vergibt der Server.';
  }
  const { art, site, typ } = body;
  if (typeof art !== 'string' || !(AUFTRAG_ARTEN as readonly string[]).includes(art)) {
    return `art: erlaubt sind ${AUFTRAG_ARTEN.join(', ')}.`;
  }
  if (typeof site !== 'string' || site === '') return 'site: fehlt.';
  // Sammelbefunde (_alle) und Quellen (_quelle:<name>) lassen sich nur schließen oder stummschalten;
  // jedes andere Urteil gilt einer Mitglieds-Site.
  const brauchtTyp = art === 'erledigt' || art === 'stumm';
  if (site.startsWith('_') && !brauchtTyp) {
    return 'site: Sammel- und Quellenzeilen (sie beginnen mit „_") gibt es nur für „erledigt" und „stumm"; andere Urteile gehen je Mitglieds-Site.';
  }
  if (brauchtTyp) {
    if (typeof typ !== 'string' || !TYP_MUSTER.test(typ)) return 'typ: der Befundtyp fehlt oder ist ungültig (z. B. A1).';
  } else if (typ !== undefined) {
    return 'typ: gehört nur zu „erledigt" und „stumm".';
  }
  const roheWerte = body.werte === undefined ? {} : body.werte;
  if (!istObjekt(roheWerte)) return 'werte: muss ein Objekt sein.';
  const werte = pruefeWerte(art as AuftragArt, roheWerte, jetztIso);
  if (typeof werte === 'string') return `${werte}.`;
  return { art: art as AuftragArt, site, ...(brauchtTyp ? { typ: typ as string } : {}), werte };
}

/** Die `site` jeder Zeile einer Liste des Stands; Zeilen ohne Text als `site` zählen nicht. */
function sitesAusListe(liste: unknown): string[] {
  if (!Array.isArray(liste)) return [];
  return liste.flatMap((zeile) => (istObjekt(zeile) && typeof zeile.site === 'string' ? [zeile.site] : []));
}

/**
 * Alle Sites, die der Stand nennt: Flotte, Lage, nicht überwacht und die
 * Listen der Abdeckung. Mehr liest die Middleware vom Stand nicht (außer der
 * Version beim Annehmen); fehlt ein Abschnitt, trägt er nichts bei.
 */
function sitesImStand(stand: Record<string, unknown>): Set<string> {
  const abdeckung = istObjekt(stand.abdeckung) ? Object.values(stand.abdeckung) : [];
  return new Set([stand.flotte, stand.lage, stand.nichtUeberwacht, ...abdeckung].flatMap(sitesAusListe));
}

/** Gilt die Site im Stand? Sammel- und Quellenzeilen (`_...`) gelten nur, wenn eine Zeile der Lage sie trägt. */
function siteIstImStand(stand: Record<string, unknown>, site: string): boolean {
  return site.startsWith('_') ? sitesAusListe(stand.lage).includes(site) : sitesImStand(stand).has(site);
}

/**
 * Das `seit` des Verlaufs als normierter ISO-Zeitpunkt, oder null. Verlangt
 * ein Datum oder einen Zeitpunkt mit Zeitzone: V8 liest sonst auch "1" als Datum.
 */
function parseSeit(wert: unknown): string | null {
  if (typeof wert !== 'string' || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2}))?$/.test(wert)) return null;
  const ms = Date.parse(wert);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

// ─── Nutzer-Router ───────────────────────────────────────────────

/**
 * GET /api/sicherheit/stand · POST und GET /api/sicherheit/auftraege (ohne
 * ?offen=1, das ist der Dienst-Endpunkt). Muss HINTER der /api-Auth stehen.
 */
export function createSicherheitNutzerRouter(deps: SicherheitDeps): Router {
  const router = Router();
  const jetzt = deps.jetzt ?? (() => new Date());

  router.use('/api/sicherheit', keinCache, nurWennKonfiguriert(deps), nurNutzer(deps));

  router.get('/api/sicherheit/stand', (_req, res) => {
    const gespeichert = deps.speicher.aktuellerStand();
    if (!gespeichert) {
      res.json({ stand: null, empfangenIso: null, alterMinuten: null });
      return;
    }
    const alterMinuten = Math.max(0, Math.floor((jetzt().getTime() - Date.parse(gespeichert.empfangenIso)) / 60_000));
    res.json({ stand: gespeichert.stand, empfangenIso: gespeichert.empfangenIso, alterMinuten });
  });

  router.get('/api/sicherheit/auftraege', (req, res) => {
    let seitIso: string | undefined;
    if (req.query.seit !== undefined) {
      const seit = parseSeit(req.query.seit);
      if (seit === null) {
        res.status(400).json({ error: 'validation', message: 'seit: erwartet ein Datum (JJJJ-MM-TT) oder einen Zeitpunkt mit Zeitzone, z. B. 2026-10-24T10:00:00Z.' });
        return;
      }
      seitIso = seit;
    }
    res.json({ auftraege: deps.speicher.verlauf({ seitIso }) });
  });

  router.post('/api/sicherheit/auftraege', (req, res) => {
    if (!istEigeneOrigin(req)) {
      res.status(400).json({ error: 'fremde_origin', message: 'Die Anfrage kommt nicht von dieser Seite und wird nicht angenommen.' });
      return;
    }
    const zeit = jetzt();
    const geprueft = pruefeAuftrag(req.body, zeit.toISOString());
    if (typeof geprueft === 'string') {
      res.status(400).json({ error: 'validation', message: geprueft });
      return;
    }
    const gespeichert = deps.speicher.aktuellerStand();
    if (!gespeichert) {
      res.status(409).json({ error: 'kein_stand', message: 'Es liegt noch kein Stand vor. Aufträge sind möglich, sobald der Wachdienst einen geschickt hat.' });
      return;
    }
    if (!siteIstImStand(gespeichert.stand, geprueft.site)) {
      res.status(400).json({
        error: 'unbekannte_site',
        message: geprueft.site.startsWith('_')
          ? 'Diese Sammel- oder Quellenzeile steht in der aktuellen Lage nicht (mehr).'
          : 'Diese Site kommt im aktuellen Stand nicht vor.',
      });
      return;
    }
    const durch = getAuth(res)!.user!.email; // nurNutzer hat eine Session mit Konto sichergestellt
    const id = deps.speicher.legeAuftragAn({ ...geprueft, durch }, zeit);
    console.log(`🛡️ Sicherheit: Auftrag ${geprueft.art} angelegt (${id})`);
    res.json({ id });
  });

  router.use(behandleFehler);
  return router;
}
