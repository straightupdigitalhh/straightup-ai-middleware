import { Router, Request, Response, RequestHandler } from 'express';
import { getAuth, requireAdmin } from '../services/auth.js';
import { clientErrorMessage } from '../services/errors.js';
import type { BoardLader, BoardStand } from '../services/teamboard/daten.js';
import type { ZeitenProNutzer } from '../services/teamboard/zeiten.js';
import type { ErledigenFehler, RueckgaengigFehler } from '../services/teamboard/erledigen.js';
import type { TeamboardEinstellungen, TeamboardEinstellungenStore } from '../core/teamboard-einstellungen.js';
import { UNDO_FENSTER_MS } from '../core/teamboard-erledigungen.js';

/** Nur die zwei Methoden, die die Route tatsächlich braucht (T4, `erstelleErledigenDienst`). */
interface ErledigenDienst {
  erledige(a: { taskId: string; userId: string; aworkUserId: string; istAdmin: boolean }): Promise<
    { ok: true; vorgangId: number } | { ok: false; fehler: ErledigenFehler }
  >;
  macheRueckgaengig(a: { vorgangId: number; userId: string }): Promise<
    { ok: true } | { ok: false; fehler: RueckgaengigFehler }
  >;
}

interface Deps {
  ladeBoard: BoardLader;
  ladeZeiten: () => Promise<ZeitenProNutzer>;
  ladeNutzerBild: (userId: string) => Promise<{ typ: string; bytes: Buffer } | null>;
  einstellungen: TeamboardEinstellungenStore;
  erledigenDienst: ErledigenDienst;
}

// ─── Fehler-Zuordnung & Texte für /erledigen und /rueckgaengig ────
//
// Der Dienst wirft in den fachlichen Fällen nicht, sondern gibt ein
// Ergebnisobjekt zurück — clientErrorMessage (nur für den 502-Zweig aus
// echten awork-Ausnahmen gedacht) würde hier für jeden Fall dieselbe
// generische Meldung liefern. Ein gemeinsamer Record deckt beide Fehler-
// Unions ab, weil sie sich in drei Werten überschneiden.

const TEXTE: Record<ErledigenFehler | RueckgaengigFehler, string> = {
  nicht_gefunden: 'Diese Aufgabe gibt es in awork nicht mehr.',
  keine_berechtigung: 'Du bist für diese Aufgabe nicht zuständig.',
  schon_erledigt: 'Die Aufgabe ist bereits erledigt.',
  laeuft_bereits: 'Für diese Aufgabe läuft gerade schon ein Erledigen-Vorgang.',
  nicht_erledigbar: 'Diese Aufgabe hat kein Projekt oder keinen Status — sie lässt sich hier nicht erledigen.',
  kein_done_status: 'Dieses Projekt hat keine Erledigt-Spalte.',
  nicht_gewechselt: 'awork hat den Status nicht übernommen. Bitte in awork nachsehen.',
  fenster_abgelaufen: 'Das Zeitfenster zum Rückgängigmachen ist abgelaufen.',
  schon_rueckgaengig: 'Dieser Vorgang wurde bereits rückgängig gemacht.',
};

function fehlerStatus(fehler: ErledigenFehler | RueckgaengigFehler): number {
  if (fehler === 'keine_berechtigung') return 403;
  if (fehler === 'nicht_gefunden') return 404;
  return 409;
}

// ─── Avatar-Cache — 1:1 aus agents/teamboard/server.ts (Stufe 1) portiert ─

const AVATAR_ID_MUSTER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const AVATAR_TTL_MS = 6 * 60 * 60 * 1000; // Treffer MIT Bild: Avatare ändern sich selten.
const AVATAR_NEGATIV_TTL_MS = 10 * 60 * 1000; // Treffer OHNE Bild: kurze TTL, ein neu hochgeladenes Bild taucht zügig auf.
const AVATAR_FEHLER_BACKOFF_MS = 60 * 1000; // awork-Fehler/Rate-Limit: kurzes globales Abkling-Fenster (wie erstelleBoardLader in daten.ts).
// Bei ~11 echten Nutzern (Spec §3) nie erreicht — Schutz gegen unbegrenztes
// Wachstum, falls ein authentifizierter Nutzer den Cache mit vielen
// verschiedenen syntaktisch gültigen, aber erfundenen UUIDs füttert (naives
// Negativ-Cachen ohne Obergrenze wäre sonst ein Memory-DoS-Vektor).
const AVATAR_CACHE_MAX_EINTRAEGE = 100;

type AvatarCacheEintrag =
  | { gefunden: true; typ: string; bytes: Buffer; geladenUmMs: number }
  | { gefunden: false; geladenUmMs: number };

// ─── Einstellungen-Validierung ────────────────────────────────────

const EINSTELLUNGEN_MAX_EINTRAEGE = 100;

function istGueltigeIdListe(wert: unknown): wert is string[] {
  return (
    Array.isArray(wert) &&
    wert.length <= EINSTELLUNGEN_MAX_EINTRAEGE &&
    wert.every((v) => typeof v === 'string' && AVATAR_ID_MUSTER.test(v))
  );
}

function parseEinstellungen(body: unknown): TeamboardEinstellungen | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  if (b.reihenfolge !== null && !istGueltigeIdListe(b.reihenfolge)) return null;
  if (!istGueltigeIdListe(b.ausgeblendet)) return null;
  return { reihenfolge: b.reihenfolge as string[] | null, ausgeblendet: b.ausgeblendet as string[] };
}

/**
 * Router für /api/teamboard/* — läuft hinter der /api-Auth (Session ODER
 * Master-Key). /zeiten und /einstellungen sind personenbezogen und daher
 * NUR per Session erreichbar (Ruling 3): der Master-Key kennt keinen
 * Nutzer, für den es ein Mapping oder eigene Einstellungen geben könnte.
 */
export function createTeamboardRouter(deps: Deps): Router {
  const router = Router();

  // Avatar-Cache je userId — positive UND negative Treffer, mit
  // unterschiedlicher TTL (s.o.) und gemeinsamer harter Größenobergrenze.
  const avatarCache = new Map<string, AvatarCacheEintrag>();
  // Fehler-Backoff fürs Laden: NICHT pro userId, sondern global — ein
  // awork-Ausfall/Rate-Limit betrifft alle Avatare gleichzeitig (dasselbe
  // Token/Limit wie die Board-Daten, vgl. erstelleBoardLader in daten.ts).
  // Ohne dieses Fenster würde jeder Client-Redraw (alle 30 s je offenem Tab)
  // während eines awork-Ausfalls erneut jeden Avatar ohne Bremse anfragen.
  let avatarFehlerBisMs: number | null = null;

  function speicherAvatar(userId: string, eintrag: AvatarCacheEintrag): void {
    if (avatarCache.size >= AVATAR_CACHE_MAX_EINTRAEGE && !avatarCache.has(userId)) {
      avatarCache.clear();
    }
    avatarCache.set(userId, eintrag);
  }

  function sendeAvatarAntwort(res: Response, eintrag: AvatarCacheEintrag): void {
    if (!eintrag.gefunden) {
      res
        .set('Cache-Control', 'private, max-age=600')
        // private wegen Session-Auth; kurze TTL (s. AVATAR_NEGATIV_TTL_MS) —
        // der Browser fragt nach einem neu hochgeladenen Bild zügig erneut,
        // hört aber auf, bei jedem 30-s-Redraw sofort wieder nachzufragen.
        .status(404)
        .type('text/plain; charset=utf-8')
        .send('Nicht gefunden');
      return;
    }
    res
      .set('Cache-Control', 'private, max-age=3600')
      // private wegen Session-Auth (kein gemeinsamer Cache darf mitlesen) —
      // der Browser selbst darf das Bild eine Stunde lang cachen.
      .status(200)
      .set('Content-Type', eintrag.typ)
      .send(eintrag.bytes);
  }

  async function beantworteAvatar(userId: string, res: Response): Promise<void> {
    const jetztMs = Date.now();
    const eintrag = avatarCache.get(userId);
    if (eintrag) {
      const ttl = eintrag.gefunden ? AVATAR_TTL_MS : AVATAR_NEGATIV_TTL_MS;
      if (jetztMs - eintrag.geladenUmMs < ttl) {
        sendeAvatarAntwort(res, eintrag);
        return;
      }
    }

    if (avatarFehlerBisMs !== null && jetztMs < avatarFehlerBisMs) {
      // awork gerade als gestört bekannt — kein weiterer Versuch innerhalb
      // des Backoff-Fensters, auch nicht für eine andere userId (dasselbe
      // Token/Limit). Nicht cachen (no-store): das ist keine Aussage über
      // das tatsächliche Bild, nur eine vorübergehende Störung.
      res.set('Cache-Control', 'no-store').status(404).type('text/plain; charset=utf-8').send('Nicht gefunden');
      return;
    }

    let geladen: { typ: string; bytes: Buffer } | null;
    try {
      geladen = await deps.ladeNutzerBild(userId);
      avatarFehlerBisMs = null;
    } catch (fehler) {
      avatarFehlerBisMs = jetztMs + AVATAR_FEHLER_BACKOFF_MS;
      // Nur die Meldung loggen, nie das Fehlerobjekt (könnte den Token
      // enthalten) — und wie oben nicht als "kein Bild" cachen.
      console.error(
        'teamboard: Avatar laden fehlgeschlagen —',
        fehler instanceof Error ? fehler.message : String(fehler),
      );
      res.set('Cache-Control', 'no-store').status(404).type('text/plain; charset=utf-8').send('Nicht gefunden');
      return;
    }

    const neu: AvatarCacheEintrag =
      geladen === null
        ? { gefunden: false, geladenUmMs: jetztMs }
        : { gefunden: true, typ: geladen.typ, bytes: geladen.bytes, geladenUmMs: jetztMs };
    speicherAvatar(userId, neu);
    sendeAvatarAntwort(res, neu);
  }

  router.get('/api/teamboard/board', async (_req: Request, res: Response) => {
    try {
      const stand = await deps.ladeBoard();
      res.json(stand);
    } catch (e: any) {
      console.error(`❌ teamboard: Board laden fehlgeschlagen: ${e?.message ?? e}`);
      res.status(502).json({ error: 'awork_unreachable', message: clientErrorMessage(e) });
    }
  });

  router.get('/api/teamboard/zeiten', async (_req: Request, res: Response) => {
    try {
      const auth = getAuth(res);
      if (!auth || auth.via !== 'session') {
        res.status(403).json({ error: 'forbidden', message: 'Nur per Session-Login' });
        return;
      }
      const alle = await deps.ladeZeiten();
      if (auth.role === 'admin') {
        res.json({ zeiten: alle, hinweis: null });
        return;
      }
      const aworkUserId = auth.user?.aworkUserId;
      if (!aworkUserId) {
        // Kein awork-Mapping fürs eigene Konto — Filterung ergäbe leere
        // Zeiten; der Hinweis erklärt dem Frontend, warum.
        res.json({ zeiten: {}, hinweis: 'kein_mapping' });
        return;
      }
      // Filterung strikt serverseitig NACH dem globalen Cache — fremde
      // Zahlen dürfen einen Member-Browser NIE erreichen (Ruling 3).
      const eigene = alle[aworkUserId] ?? { heuteSekunden: 0, vortagSekunden: 0, wocheSekunden: 0 };
      res.json({ zeiten: { [aworkUserId]: eigene }, hinweis: null });
    } catch (e: any) {
      console.error(`❌ teamboard: Zeiten laden fehlgeschlagen: ${e?.message ?? e}`);
      res.status(502).json({ error: 'awork_unreachable', message: clientErrorMessage(e) });
    }
  });

  router.get('/api/teamboard/nutzer', requireAdmin, async (_req: Request, res: Response) => {
    try {
      const stand = await deps.ladeBoard();
      const nutzer = stand.board.lanes.map((l) => ({ id: l.userId, name: l.name }));
      res.json(nutzer);
    } catch (e: any) {
      console.error(`❌ teamboard: Nutzerliste laden fehlgeschlagen: ${e?.message ?? e}`);
      res.status(502).json({ error: 'awork_unreachable', message: clientErrorMessage(e) });
    }
  });

  router.get('/api/teamboard/einstellungen', async (_req: Request, res: Response) => {
    try {
      const auth = getAuth(res);
      if (!auth || auth.via !== 'session') {
        res.status(403).json({ error: 'forbidden', message: 'Nur per Session-Login' });
        return;
      }
      res.json(deps.einstellungen.get(auth.user!.id));
    } catch (e: any) {
      console.error(`❌ teamboard: Einstellungen laden fehlgeschlagen: ${e?.message ?? e}`);
      res.status(500).json({ error: 'internal', message: clientErrorMessage(e) });
    }
  });

  router.put('/api/teamboard/einstellungen', async (req: Request, res: Response) => {
    try {
      const auth = getAuth(res);
      if (!auth || auth.via !== 'session') {
        res.status(403).json({ error: 'forbidden', message: 'Nur per Session-Login' });
        return;
      }
      const einstellungen = parseEinstellungen(req.body);
      if (!einstellungen) {
        res.status(400).json({
          error: 'validation',
          message: 'reihenfolge muss null oder eine Liste von awork-User-IDs sein, ausgeblendet eine Liste von awork-User-IDs (je max. 100 Einträge)',
        });
        return;
      }
      deps.einstellungen.set(auth.user!.id, einstellungen);
      res.json(einstellungen);
    } catch (e: any) {
      console.error(`❌ teamboard: Einstellungen speichern fehlgeschlagen: ${e?.message ?? e}`);
      res.status(500).json({ error: 'internal', message: clientErrorMessage(e) });
    }
  });

  router.get('/api/teamboard/avatar/:userId', async (req: Request, res: Response) => {
    try {
      const userId = req.params.userId as string;
      if (!AVATAR_ID_MUSTER.test(userId)) {
        // Erst nach der Auth-Prüfung erreichbar (Router-Mount hinter
        // /api-Auth) — strikt validieren, sonst 404 wie jeder andere
        // unbekannte Pfad, ohne den Loader zu rufen.
        res.set('Cache-Control', 'no-store').status(404).type('text/plain; charset=utf-8').send('Nicht gefunden');
        return;
      }
      await beantworteAvatar(userId, res);
    } catch (e: any) {
      console.error(`❌ teamboard: Avatar-Anfrage fehlgeschlagen: ${e?.message ?? e}`);
      res.status(500).json({ error: 'internal', message: clientErrorMessage(e) });
    }
  });

  // ─── Erledigen / Rückgängig ───────────────────────────────────
  //
  // Beide Routen sind nur per Session erreichbar: der Master-Key
  // (via: 'api-key') hat keine Nutzeridentität — genau die, die der Dienst
  // für Zuständigkeits- und Urheberprüfung braucht. Die Prüfung steht VOR
  // jeder Dereferenz von auth.user, sonst crasht die Route für api-key-
  // Aufrufer statt sauber 403 zu antworten. Kein eigenes CSRF-Token nötig:
  // das Session-Cookie ist sameSite: 'lax' (routes/auth.ts) — ein Cross-
  // Site-POST schickt es ohnehin nicht mit (Beleg: test/teamboard-route.test.ts).

  router.post('/api/teamboard/erledigen', async (req: Request, res: Response) => {
    try {
      const auth = getAuth(res);
      if (!auth || auth.via !== 'session') {
        res.status(403).json({ error: 'forbidden', message: 'Nur per Session-Login' });
        return;
      }
      const aworkUserId = auth.user!.aworkUserId;
      if (!aworkUserId) {
        res.status(403).json({
          error: 'forbidden',
          message: 'Für dein Konto ist keine awork-Nutzer-ID hinterlegt — bitte im Hub verknüpfen.',
        });
        return;
      }
      const { taskId } = req.body ?? {};
      if (typeof taskId !== 'string' || !taskId) {
        res.status(400).json({ error: 'validation', message: 'taskId ist Pflichtfeld (string)' });
        return;
      }

      const ergebnis = await deps.erledigenDienst.erledige({
        taskId,
        userId: auth.user!.id,
        aworkUserId,
        istAdmin: auth.role === 'admin',
      });
      if (ergebnis.ok) {
        res.status(200).json({ vorgangId: ergebnis.vorgangId, undoSekunden: UNDO_FENSTER_MS / 1000 });
        return;
      }
      res.status(fehlerStatus(ergebnis.fehler)).json({ error: ergebnis.fehler, message: TEXTE[ergebnis.fehler] });
    } catch (e: any) {
      console.error(`❌ teamboard: Aufgabe erledigen fehlgeschlagen: ${e?.message ?? e}`);
      res.status(502).json({ error: 'awork_unreachable', message: clientErrorMessage(e) });
    }
  });

  router.post('/api/teamboard/rueckgaengig', async (req: Request, res: Response) => {
    try {
      const auth = getAuth(res);
      if (!auth || auth.via !== 'session') {
        res.status(403).json({ error: 'forbidden', message: 'Nur per Session-Login' });
        return;
      }
      const { vorgangId } = req.body ?? {};
      if (typeof vorgangId !== 'number' || !Number.isInteger(vorgangId)) {
        res.status(400).json({ error: 'validation', message: 'vorgangId ist Pflichtfeld (ganze Zahl)' });
        return;
      }

      const ergebnis = await deps.erledigenDienst.macheRueckgaengig({ vorgangId, userId: auth.user!.id });
      if (ergebnis.ok) {
        res.status(200).json({ ok: true });
        return;
      }
      res.status(fehlerStatus(ergebnis.fehler)).json({ error: ergebnis.fehler, message: TEXTE[ergebnis.fehler] });
    } catch (e: any) {
      console.error(`❌ teamboard: Erledigung rückgängig machen fehlgeschlagen: ${e?.message ?? e}`);
      res.status(502).json({ error: 'awork_unreachable', message: clientErrorMessage(e) });
    }
  });

  return router;
}

// ─── Seite: GET /teamboard ─────────────────────────────────────────
//
// Der Session-Guard (createPageAuth, services/auth.ts) wird als
// Route-Middleware übergeben (deps.pageAuth) und NUR auf GET /teamboard
// registriert — nicht global vorgeschaltet. Ein globales
// `app.use(createPageAuth(...), router)` in index.ts würde JEDE
// unauthentifizierte Anfrage auf jeden bis dahin unverarbeiteten Pfad
// (auch echte 404-Fälle) mit 302 statt mit dem JSON-404 beantworten, weil
// der Guard vor dem Routing des Routers läuft und keinen Pfad kennt
// (Stufe-2-Fix-Runde 1, Task 8). Als Route-Middleware sieht createPageAuth
// weiterhin unverändertes req.path ("/teamboard"), weil der Router selbst
// ohne Pfad-Präfix gemountet wird (siehe index.ts) — die next=-Redirect-
// Adresse bleibt damit korrekt.
// Die 503-/500-HTML-Bodies sind 1:1 aus agents/teamboard/server.ts
// (Stufe 1) übernommen, damit sich am Kaltstart-/Fehlerverhalten nichts
// ändert.

interface PageDeps {
  ladeBoard: BoardLader;
  renderSeite: (stand: BoardStand) => string;
  pageAuth: RequestHandler;
}

const KALTSTART_HTML =
  '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="30"><title>Teamboard</title><p>awork ist gerade nicht erreichbar — nächster Versuch in 30 Sekunden.</p>';
const FEHLER_HTML = '<!doctype html><meta charset="utf-8"><title>Fehler</title><p>Interner Fehler</p>';

export function createTeamboardPageRouter(deps: PageDeps): Router {
  const router = Router();

  router.get('/teamboard', deps.pageAuth, async (_req: Request, res: Response) => {
    try {
      let stand: BoardStand;
      try {
        stand = await deps.ladeBoard();
      } catch (fehler) {
        // Kaltstart: es gab noch nie einen Stand, awork gerade nicht
        // erreichbar. Nur .message loggen, nie das Fehlerobjekt (könnte
        // einen Token enthalten).
        console.error('teamboard: Board laden fehlgeschlagen —', fehler instanceof Error ? fehler.message : String(fehler));
        res.set('Cache-Control', 'no-store').status(503).type('text/html; charset=utf-8').send(KALTSTART_HTML);
        return;
      }
      // renderSeite aufrufen, bevor Headers geschrieben werden, damit ein
      // Fehler dort noch abgefangen werden kann, ohne dass eine teilweise
      // geschriebene Response vorliegt.
      const html = deps.renderSeite(stand);
      res.set('Cache-Control', 'no-store').status(200).type('text/html; charset=utf-8').send(html);
    } catch (fehler) {
      // Fehler bei renderSeite oder sonst etwas im Handler — nie das
      // Fehlerobjekt oder den Stacktrace an den Client ausliefern.
      console.error('teamboard: Seite rendern fehlgeschlagen —', fehler instanceof Error ? fehler.message : String(fehler));
      if (!res.headersSent) {
        res.set('Cache-Control', 'no-store').status(500).type('text/html; charset=utf-8').send(FEHLER_HTML);
      }
    }
  });

  return router;
}
