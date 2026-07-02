import { Router, Request, Response } from 'express';
import { AworkClient } from '../services/awork.js';
import { FeedbackKeyStore } from '../services/feedback-keys.js';

export const FEEDBACK_LIST_NAME = 'Website-Feedback';

interface Deps {
  store: FeedbackKeyStore;
  awork: Pick<AworkClient, 'getTaskLists' | 'createTaskList'>;
}

/**
 * Admin-Endpoints zur Verwaltung der Feedback-Keys.
 * Läuft unter /api/* und ist damit durch die globale X-API-Key-Auth geschützt.
 */
export function createFeedbackAdminRouter({ store, awork }: Deps): Router {
  const router = Router();

  // Key anlegen – stellt die Task-Liste "Website-Feedback" im Projekt sicher
  router.post('/api/feedback-keys', async (req: Request, res: Response) => {
    const { projectId, domains, type, defaultAssigneeId, label } = req.body ?? {};

    if (typeof projectId !== 'string' || !projectId) {
      res.status(400).json({ error: 'validation', message: 'projectId fehlt' });
      return;
    }
    if (!Array.isArray(domains) || domains.length === 0 || !domains.every(d => typeof d === 'string' && d)) {
      res.status(400).json({ error: 'validation', message: 'domains muss ein nicht-leeres String-Array sein' });
      return;
    }
    if (type !== 'internal' && type !== 'customer') {
      res.status(400).json({ error: 'validation', message: "type muss 'internal' oder 'customer' sein" });
      return;
    }
    if (type === 'customer' && (typeof defaultAssigneeId !== 'string' || !defaultAssigneeId)) {
      res.status(400).json({ error: 'validation', message: 'customer-Keys brauchen defaultAssigneeId' });
      return;
    }
    if (typeof label !== 'string' || !label) {
      res.status(400).json({ error: 'validation', message: 'label fehlt' });
      return;
    }

    try {
      const lists = await awork.getTaskLists(projectId);
      let list = lists.find(l => l.name === FEEDBACK_LIST_NAME);
      if (!list) {
        list = await awork.createTaskList(projectId, FEEDBACK_LIST_NAME);
        console.log(`📋 Task-Liste "${FEEDBACK_LIST_NAME}" in Projekt ${projectId} angelegt`);
      }

      const record = store.create({
        label, domains, projectId,
        taskListId: list.id,
        type,
        defaultAssigneeId: defaultAssigneeId ?? null,
      });
      console.log(`🔑 Feedback-Key angelegt: ${record.label} (${record.type}, Projekt ${projectId})`);
      res.status(201).json(record);
    } catch (e: any) {
      console.error(`❌ Feedback-Key-Anlage fehlgeschlagen: ${e.message}`);
      res.status(502).json({ error: 'awork_unreachable', message: e.message });
    }
  });

  router.get('/api/feedback-keys', (_req: Request, res: Response) => {
    res.json(store.list());
  });

  router.delete('/api/feedback-keys/:key', (req: Request, res: Response) => {
    const key = req.params.key as string;
    if (store.revoke(key)) {
      console.log(`🔑 Feedback-Key widerrufen: ${key.slice(0, 12)}…`);
      res.status(204).end();
    } else {
      res.status(404).json({ error: 'not_found', message: 'Key unbekannt oder bereits widerrufen' });
    }
  });

  return router;
}
