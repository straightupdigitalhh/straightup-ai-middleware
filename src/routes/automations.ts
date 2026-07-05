import { Router, Request, Response } from 'express';
import { Scheduler } from '../core/scheduler.js';
import { requireAdmin } from '../services/auth.js';

interface Deps {
  scheduler: Scheduler;
}

/**
 * Automationen einsehen (alle Angemeldeten) und steuern (Admins).
 * Läuft unter /api/* hinter der API-Auth.
 */
export function createAutomationsRouter({ scheduler }: Deps): Router {
  const router = Router();

  router.get('/api/automations', (_req: Request, res: Response) => {
    res.json(scheduler.status());
  });

  router.get('/api/automations/:id/runs', (req: Request, res: Response) => {
    const id = req.params.id as string;
    if (!scheduler.has(id)) {
      res.status(404).json({ error: 'not_found', message: 'Automation unbekannt' });
      return;
    }
    const limit = Math.min(parseInt(String(req.query.limit || '20'), 10) || 20, 100);
    res.json(scheduler.listRuns(id, limit));
  });

  router.post('/api/automations/:id/run', requireAdmin, (req: Request, res: Response) => {
    const id = req.params.id as string;
    if (!scheduler.has(id)) {
      res.status(404).json({ error: 'not_found', message: 'Automation unbekannt' });
      return;
    }
    try {
      const { runId } = scheduler.trigger(id, 'manual');
      res.status(202).json({ runId, message: 'Lauf gestartet – Status über die Run-Historie' });
    } catch (e: any) {
      res.status(409).json({ error: 'conflict', message: e.message });
    }
  });

  router.patch('/api/automations/:id', requireAdmin, (req: Request, res: Response) => {
    const id = req.params.id as string;
    if (!scheduler.has(id)) {
      res.status(404).json({ error: 'not_found', message: 'Automation unbekannt' });
      return;
    }
    const { enabled, cron } = req.body ?? {};
    if (enabled !== undefined && typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'validation', message: 'enabled muss boolean sein' });
      return;
    }
    if (cron !== undefined && cron !== null && typeof cron !== 'string') {
      res.status(400).json({ error: 'validation', message: 'cron muss String oder null sein' });
      return;
    }
    try {
      res.json(scheduler.setConfig(id, { enabled, cron }));
    } catch (e: any) {
      res.status(400).json({ error: 'validation', message: e.message });
    }
  });

  return router;
}
