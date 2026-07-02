import { Router, Request, Response, NextFunction } from 'express';
import { AworkClient } from '../services/awork.js';
import { FeedbackKeyStore, FeedbackKeyRecord } from '../services/feedback-keys.js';

interface Deps {
  store: FeedbackKeyStore;
  awork: Pick<AworkClient, 'getProject' | 'getProjectMembers' | 'createTask' | 'setTaskAssignees' | 'uploadTaskFile'>;
  workspaceUrl: string;
}

/**
 * Öffentliche Feedback-Endpoints für die Chrome-Extension.
 * Auth über projektspezifischen X-Feedback-Key (NICHT der Master-API-Key).
 * Wird auf /feedback gemountet – VOR den globalen Body-Parsern (20-MB-Limit).
 */
export function createFeedbackRouter({ store, awork, workspaceUrl }: Deps): Router {
  const router = Router();

  // ─── CORS (Auth läuft über expliziten Header, nicht Cookies) ──
  router.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Feedback-Key');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    next();
  });

  router.options(/.*/, (_req: Request, res: Response) => {
    res.status(204).end();
  });

  // ─── Key-Auth ──────────────────────────────────────────────────
  router.use((req: Request, res: Response, next: NextFunction) => {
    const key = req.headers['x-feedback-key'];
    const record = typeof key === 'string' ? store.findActive(key) : undefined;
    if (!record) {
      res.status(401).json({ error: 'invalid_key', message: 'Feedback-Key fehlt, ist ungültig oder wurde widerrufen' });
      return;
    }
    res.locals.feedbackKey = record;
    next();
  });

  // ─── Session: Key-Validierung + Kontext für die Extension ─────
  router.get('/session', async (_req: Request, res: Response) => {
    const record = res.locals.feedbackKey as FeedbackKeyRecord;
    try {
      const project = await awork.getProject(record.projectId);
      const body: Record<string, unknown> = {
        label: record.label,
        projectName: project.name,
        type: record.type,
      };
      if (record.type === 'internal') {
        const members = await awork.getProjectMembers(record.projectId);
        body.members = members
          .filter(m => !m.isDeactivated)
          .map(m => ({
            id: m.userId,
            name: [m.firstName, m.lastName].filter(Boolean).join(' ') || 'Unbenannt',
          }));
      }
      res.json(body);
    } catch (e: any) {
      console.error(`❌ /feedback/session fehlgeschlagen (${record.label}): ${e.message}`);
      res.status(502).json({ error: 'awork_unreachable', message: 'awork antwortet nicht' });
    }
  });

  return router;
}
