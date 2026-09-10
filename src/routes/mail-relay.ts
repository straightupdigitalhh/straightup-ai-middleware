import { Router, type Request, type Response } from 'express';
import { safeEqual } from '../services/auth.js';
import { FixedWindowLimiter } from '../services/rate-limit.js';

interface Deps {
  key: string;
  senden: (to: string[], subject: string, text: string) => Promise<void>;
  /** Standard: 200 Mails je Stunde (Spec 6.7 des Review-Portals). */
  limiter?: FixedWindowLimiter;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validiere(body: unknown): { to: string[]; subject: string; text: string } | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const to = b.to;
  if (!Array.isArray(to) || to.length < 1 || to.length > 10) return 'to: 1 bis 10 Empfänger';
  if (!to.every(a => typeof a === 'string' && a.length <= 254 && EMAIL.test(a))) return 'to: ungültige Adresse';
  if (typeof b.subject !== 'string' || b.subject.trim().length === 0 || b.subject.length > 200) return 'subject: 1 bis 200 Zeichen';
  if (typeof b.text !== 'string' || b.text.trim().length === 0 || b.text.length > 20_000) return 'text: 1 bis 20000 Zeichen';
  return { to: to as string[], subject: b.subject, text: b.text };
}

/**
 * POST /api/mail/send – Relay für Dienste im selben Stack (straightup Review).
 * Eigener Dienstschlüssel, wird VOR der /api-Auth gemountet.
 */
export function createMailRelayRouter({ key, senden, limiter = new FixedWindowLimiter(200, 3_600_000) }: Deps): Router {
  const router = Router();

  router.post('/api/mail/send', async (req: Request, res: Response) => {
    const gegeben = req.headers['x-service-key'];
    if (typeof gegeben !== 'string' || !safeEqual(gegeben, key)) {
      res.status(401).json({ error: 'invalid_key', message: 'Dienstschlüssel fehlt oder ist falsch' });
      return;
    }
    const geprueft = validiere(req.body);
    if (typeof geprueft === 'string') {
      res.status(400).json({ error: 'validation', message: geprueft });
      return;
    }
    if (!limiter.hit('relay')) {
      res.status(429).json({ error: 'rate_limited', message: 'Zu viele Mails in dieser Stunde' });
      return;
    }
    try {
      await senden(geprueft.to, geprueft.subject, geprueft.text);
      console.log(`📮 Relay-Mail: ${geprueft.to.length} Empfänger, Betreff ${geprueft.subject.length} Zeichen`);
      res.status(202).json({ ok: true });
    } catch (e) {
      console.warn(`📮 Relay-Mail fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
      res.status(502).json({ error: 'versand_fehlgeschlagen', message: 'Mail konnte nicht verschickt werden' });
    }
  });

  return router;
}
