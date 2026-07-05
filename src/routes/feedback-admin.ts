import { Router, Request, Response } from 'express';
import { AworkClient } from '../services/awork.js';
import { FeedbackKeyStore } from '../services/feedback-keys.js';

export const FEEDBACK_LIST_NAME = 'Website-Feedback';

interface Deps {
  store: FeedbackKeyStore;
  awork: Pick<AworkClient, 'getTaskLists' | 'createTaskList' | 'getProjects' | 'getProjectMembers'>;
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
      res.status(502).json({ error: 'awork_unreachable', message: 'awork antwortet nicht' });
    }
  });

  // Liste OHNE Klartext-Keys: der volle Key wird nur einmal bei der Anlage
  // ausgegeben. Verwaltung (Widerruf) läuft über die id.
  router.get('/api/feedback-keys', (_req: Request, res: Response) => {
    res.json(store.list().map(({ key, ...rest }) => ({
      ...rest,
      keyPrefix: `${key.slice(0, 8)}…`,
    })));
  });

  // Widerruf per id; der Klartext-Key wird aus Kompatibilität weiter akzeptiert.
  router.delete('/api/feedback-keys/:id', (req: Request, res: Response) => {
    const id = req.params.id as string;
    if (store.revokeById(id) || store.revoke(id)) {
      console.log(`🔑 Feedback-Key widerrufen: ${id.slice(0, 12)}…`);
      res.status(204).end();
    } else {
      res.status(404).json({ error: 'not_found', message: 'Key unbekannt oder bereits widerrufen' });
    }
  });

  // ─── Hilfs-Endpoints für die Admin-Oberfläche ───────────────────

  // Projektliste für die Projekt-Auswahl (Select/Datalist)
  router.get('/api/feedback-keys/projects', async (_req: Request, res: Response) => {
    try {
      const projects = await awork.getProjects();
      const mapped = projects
        .map(p => ({ id: p.id, name: p.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      res.json(mapped);
    } catch (e: any) {
      console.error(`❌ Projektliste konnte nicht geladen werden: ${e.message}`);
      res.status(502).json({ error: 'awork_unreachable', message: 'awork antwortet nicht' });
    }
  });

  // Projektmitglieder für die Standard-Assignee-Auswahl (nur aktive Mitglieder)
  router.get('/api/feedback-keys/project-members/:projectId', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.projectId as string;
      const members = await awork.getProjectMembers(projectId);
      const mapped = members
        .filter(m => !m.isDeactivated)
        .map(m => ({
          id: m.userId,
          name: [m.firstName, m.lastName].filter(Boolean).join(' ') || 'Unbenannt',
        }));
      res.json(mapped);
    } catch (e: any) {
      console.error(`❌ Projektmitglieder konnten nicht geladen werden: ${e.message}`);
      res.status(502).json({ error: 'awork_unreachable', message: 'awork antwortet nicht' });
    }
  });

  return router;
}
