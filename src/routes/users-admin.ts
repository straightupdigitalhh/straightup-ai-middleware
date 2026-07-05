import { Router, Request, Response } from 'express';
import { UserStore } from '../core/users.js';
import { SessionStore } from '../core/sessions.js';
import { getAuth, requireAdmin } from '../services/auth.js';

interface Deps {
  users: UserStore;
  sessions: SessionStore;
}

const MIN_PASSWORD_LENGTH = 10;

/**
 * Nutzerverwaltung (nur Admins). Läuft unter /api/* hinter der API-Auth.
 */
export function createUsersAdminRouter({ users, sessions }: Deps): Router {
  const router = Router();
  router.use('/api/users', requireAdmin);

  router.get('/api/users', (_req: Request, res: Response) => {
    res.json(users.list());
  });

  router.post('/api/users', (req: Request, res: Response) => {
    const { email, name, role, password } = req.body ?? {};
    if (typeof email !== 'string' || !email.includes('@')) {
      res.status(400).json({ error: 'validation', message: 'email fehlt oder ist ungültig' });
      return;
    }
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'validation', message: 'name fehlt' });
      return;
    }
    if (role !== 'admin' && role !== 'member') {
      res.status(400).json({ error: 'validation', message: "role muss 'admin' oder 'member' sein" });
      return;
    }
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      res.status(400).json({ error: 'validation', message: `password braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen` });
      return;
    }
    if (users.findByEmail(email)) {
      res.status(409).json({ error: 'conflict', message: 'E-Mail ist bereits vergeben' });
      return;
    }

    const user = users.create({ email, name, role, password });
    console.log(`👤 Nutzer angelegt: ${user.email} (${user.role})`);
    res.status(201).json(user);
  });

  router.patch('/api/users/:id', (req: Request, res: Response) => {
    const id = req.params.id as string;
    const target = users.findById(id);
    if (!target) {
      res.status(404).json({ error: 'not_found', message: 'Nutzer unbekannt' });
      return;
    }

    // Selbst-Aussperrung verhindern: eigene Rolle/Aktivierung nicht änderbar
    const auth = getAuth(res);
    const { role, disabled, password } = req.body ?? {};
    if (auth?.user?.id === id && (role !== undefined || disabled !== undefined)) {
      res.status(400).json({ error: 'validation', message: 'Eigene Rolle/Aktivierung kann nicht geändert werden' });
      return;
    }

    if (role !== undefined) {
      if (role !== 'admin' && role !== 'member') {
        res.status(400).json({ error: 'validation', message: "role muss 'admin' oder 'member' sein" });
        return;
      }
      users.setRole(id, role);
    }
    if (password !== undefined) {
      if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
        res.status(400).json({ error: 'validation', message: `password braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen` });
        return;
      }
      users.setPassword(id, password);
      sessions.deleteForUser(id);
    }
    if (disabled !== undefined) {
      if (typeof disabled !== 'boolean') {
        res.status(400).json({ error: 'validation', message: 'disabled muss boolean sein' });
        return;
      }
      if (disabled) {
        users.disable(id);
        sessions.deleteForUser(id);
      } else {
        users.enable(id);
      }
    }

    res.json(users.findById(id));
  });

  return router;
}
