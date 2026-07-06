import { Router, Request, Response } from 'express';
import { AworkClient, aworkUserEmail } from '../services/awork.js';
import { requireAdmin } from '../services/auth.js';

interface Deps {
  awork: Pick<AworkClient, 'getUsers'>;
}

/**
 * Hilfs-Endpoint für die Empfänger-Auswahl der Zeiterfassungs-Automationen:
 * liefert die aktiven awork-Mitarbeiter samt aufgelöster E-Mail, damit das
 * Hub-Frontend Empfänger per Checkbox statt per JSON pflegen kann.
 * Läuft unter /api/* (Auth) und ist nur für Admins gedacht.
 */
export function createTimetrackingRouter({ awork }: Deps): Router {
  const router = Router();

  router.get('/api/timetracking/users', requireAdmin, async (_req: Request, res: Response) => {
    try {
      const users = await awork.getUsers();
      const mapped = users
        .filter(u => !u.isDeactivated && !u.isArchived)
        .map(u => ({
          id: u.id,
          name: [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Unbenannt',
          email: aworkUserEmail(u),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      res.json(mapped);
    } catch (e: any) {
      console.error(`❌ awork-Nutzerliste konnte nicht geladen werden: ${e.message}`);
      res.status(502).json({ error: 'awork_unreachable', message: 'awork antwortet nicht' });
    }
  });

  return router;
}
