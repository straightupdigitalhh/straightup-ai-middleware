import { timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { FixedWindowLimiter } from './rate-limit.js';

/** Timing-sicherer String-Vergleich (Längen-Leak ist bei zufälligen Keys unkritisch). */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Auth-Middleware für den Master-Key (X-API-Key).
 * Fehlversuche werden pro IP gezählt und nach `maxFailures` im Fenster gesperrt
 * (Brute-Force-Bremse). Erfolgreiche Requests zählen nicht.
 */
export function createApiKeyAuth(
  expectedKey: string,
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
    if (typeof apiKey !== 'string' || !safeEqual(apiKey, expectedKey)) {
      failureLimiter.hit(ip);
      console.warn(`🔒 Unautorisierter Zugriff von ${ip}: ${req.method} ${req.path}`);
      res.status(401).json({ error: 'Unauthorized – X-API-Key fehlt oder ungültig' });
      return;
    }

    next();
  };
}
