import { Router, Request, Response } from 'express';
import { UserStore } from '../core/users.js';
import { SessionStore, SESSION_COOKIE } from '../core/sessions.js';
import { FixedWindowLimiter } from '../services/rate-limit.js';
import { parseCookies } from '../services/auth.js';

interface Deps {
  users: UserStore;
  sessions: SessionStore;
  /** Brute-Force-Bremse fürs Login (injizierbar für Tests). */
  loginLimiter?: FixedWindowLimiter;
}

const MIN_PASSWORD_LENGTH = 10;

/**
 * Session-Login für das Hub-Frontend.
 * POST /auth/login · POST /auth/logout · GET /auth/me · POST /auth/password
 */
export function createAuthRouter({
  users, sessions,
  loginLimiter = new FixedWindowLimiter(10, 15 * 60 * 1000),
}: Deps): Router {
  const router = Router();

  function setSessionCookie(req: Request, res: Response, token: string, expiresAt: string): void {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure,
      path: '/',
      expires: new Date(expiresAt),
    });
  }

  router.post('/auth/login', (req: Request, res: Response) => {
    const ip = req.ip || 'unbekannt';
    if (loginLimiter.blocked(ip)) {
      res.status(429).json({ error: 'rate_limited', message: 'Zu viele Anmeldeversuche – bitte später erneut' });
      return;
    }

    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      res.status(400).json({ error: 'validation', message: 'email und password sind Pflichtfelder' });
      return;
    }

    const user = users.verifyCredentials(email, password);
    if (!user) {
      loginLimiter.hit(ip);
      console.warn(`🔒 Fehlgeschlagener Login für "${email}" von ${ip}`);
      res.status(401).json({ error: 'invalid_credentials', message: 'E-Mail oder Passwort falsch' });
      return;
    }

    const { token, expiresAt } = sessions.create(user.id);
    setSessionCookie(req, res, token, expiresAt);
    console.log(`🔓 Login: ${user.email} (${user.role})`);
    res.json({ user });
  });

  router.post('/auth/logout', (req: Request, res: Response) => {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (token) sessions.delete(token);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  });

  router.get('/auth/me', (req: Request, res: Response) => {
    const token = parseCookies(req)[SESSION_COOKIE];
    const user = token ? sessions.resolve(token) : undefined;
    if (!user) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    res.json({ user });
  });

  // Eigenes Passwort ändern; beendet alle anderen Sessions des Nutzers.
  router.post('/auth/password', (req: Request, res: Response) => {
    const token = parseCookies(req)[SESSION_COOKIE];
    const user = token ? sessions.resolve(token) : undefined;
    if (!user) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }

    const { currentPassword, newPassword } = req.body ?? {};
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      res.status(400).json({ error: 'validation', message: 'currentPassword und newPassword sind Pflichtfelder' });
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      res.status(400).json({ error: 'validation', message: `Passwort braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen` });
      return;
    }
    if (!users.verifyCredentials(user.email, currentPassword)) {
      res.status(401).json({ error: 'invalid_credentials', message: 'Aktuelles Passwort falsch' });
      return;
    }

    users.setPassword(user.id, newPassword);
    sessions.deleteForUser(user.id);
    const fresh = sessions.create(user.id);
    setSessionCookie(req, res, fresh.token, fresh.expiresAt);
    console.log(`🔑 Passwort geändert: ${user.email}`);
    res.status(204).end();
  });

  return router;
}
