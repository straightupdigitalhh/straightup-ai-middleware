import { timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { FixedWindowLimiter } from './rate-limit.js';
import { SessionStore, SESSION_COOKIE } from '../core/sessions.js';
import { User } from '../core/users.js';

/** Timing-sicherer String-Vergleich (Längen-Leak ist bei zufälligen Keys unkritisch). */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

// ─── Auth-Kontext ────────────────────────────────────────────────

export interface AuthContext {
  via: 'api-key' | 'session';
  /** Master-Key hat keine Nutzeridentität, zählt aber als admin (Alt-Clients/Skripte). */
  role: 'admin' | 'member';
  user?: User;
}

export function getAuth(res: Response): AuthContext | undefined {
  return res.locals.auth as AuthContext | undefined;
}

/**
 * Auth-Middleware für /api/*: akzeptiert eine gültige Session (Cookie)
 * ODER den Master-Key (X-API-Key, timing-sicher). Fehlversuche werden
 * pro IP gezählt und gesperrt (Brute-Force-Bremse).
 */
export function createApiAuth(
  expectedKey: string,
  sessions?: SessionStore,
  failureLimiter = new FixedWindowLimiter(20, 15 * 60 * 1000),
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || 'unbekannt';

    if (failureLimiter.blocked(ip)) {
      res.status(429).json({
        error: 'rate_limited',
        message: 'Zu viele fehlgeschlagene Anmeldeversuche – bitte später erneut versuchen',
      });
      return;
    }

    const apiKey = req.headers['x-api-key'];
    if (typeof apiKey === 'string' && safeEqual(apiKey, expectedKey)) {
      res.locals.auth = { via: 'api-key', role: 'admin' } satisfies AuthContext;
      next();
      return;
    }

    if (sessions) {
      const token = parseCookies(req)[SESSION_COOKIE];
      if (token) {
        const user = sessions.resolve(token);
        if (user) {
          res.locals.auth = { via: 'session', role: user.role, user } satisfies AuthContext;
          next();
          return;
        }
      }
    }

    failureLimiter.hit(ip);
    console.warn(`🔒 Unautorisierter Zugriff von ${ip}: ${req.method} ${req.path}`);
    res.status(401).json({ error: 'Unauthorized – Anmeldung oder X-API-Key erforderlich' });
  };
}

/** Rückwärtskompatibler Alias: nur Master-Key (ohne Sessions). */
export function createApiKeyAuth(expectedKey: string, failureLimiter?: FixedWindowLimiter) {
  return createApiAuth(expectedKey, undefined, failureLimiter);
}

/** Nach createApiAuth einsetzbar: nur Admins (oder Master-Key) dürfen weiter. */
export function requireAdmin(_req: Request, res: Response, next: NextFunction): void {
  const auth = getAuth(res);
  if (!auth || auth.role !== 'admin') {
    res.status(403).json({ error: 'forbidden', message: 'Nur für Admins' });
    return;
  }
  next();
}
