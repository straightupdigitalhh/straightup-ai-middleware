import { Router, Request, Response } from 'express';
import { getAuth, requireAdmin } from '../services/auth.js';
import { clientErrorMessage } from '../services/errors.js';
import type { BoardLader, BoardStand } from '../services/teamboard/daten.js';
import type { ZeitenProNutzer } from '../services/teamboard/zeiten.js';
import type { TeamboardEinstellungen, TeamboardEinstellungenStore } from '../core/teamboard-einstellungen.js';

interface Deps {
  ladeBoard: BoardLader;
  ladeZeiten: () => Promise<ZeitenProNutzer>;
  ladeNutzerBild: (userId: string) => Promise<{ typ: string; bytes: Buffer } | null>;
  einstellungen: TeamboardEinstellungenStore;
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

  return router;
}

// ─── Seite: GET /teamboard ─────────────────────────────────────────
//
// Muss HINTER createPageAuth (services/auth.ts) gemountet werden — dieser
// Router selbst prüft keine Auth, er setzt nur res.locals.auth voraus.
// Die 503-/500-HTML-Bodies sind 1:1 aus agents/teamboard/server.ts
// (Stufe 1) übernommen, damit sich am Kaltstart-/Fehlerverhalten nichts
// ändert.

interface PageDeps {
  ladeBoard: BoardLader;
  renderSeite: (stand: BoardStand) => string;
}

const KALTSTART_HTML =
  '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="30"><title>Teamboard</title><p>awork ist gerade nicht erreichbar — nächster Versuch in 30 Sekunden.</p>';
const FEHLER_HTML = '<!doctype html><meta charset="utf-8"><title>Fehler</title><p>Interner Fehler</p>';

export function createTeamboardPageRouter(deps: PageDeps): Router {
  const router = Router();

  router.get('/teamboard', async (_req: Request, res: Response) => {
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
