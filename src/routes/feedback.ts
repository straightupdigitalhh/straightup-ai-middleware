import express, { Router, Request, Response, NextFunction } from 'express';
import { AworkClient } from '../services/awork.js';
import { FeedbackKeyStore, FeedbackKeyRecord } from '../services/feedback-keys.js';
import { domainAllowed } from '../services/feedback-keys.js';
import {
  validateTicketPayload, buildTicketDescriptionHtml, taskNameFrom,
  decodeScreenshot, checkRateLimit,
} from '../services/feedback-ticket.js';
import { FixedWindowLimiter } from '../services/rate-limit.js';

interface Deps {
  store: FeedbackKeyStore;
  awork: Pick<AworkClient, 'getProject' | 'getProjectMembers' | 'createTask' | 'setTaskAssignees' | 'uploadTaskFile'>;
  workspaceUrl: string;
  /** Brute-Force-Bremse für ungültige Keys (injizierbar für Tests). */
  authFailureLimiter?: FixedWindowLimiter;
}

/**
 * Öffentliche Feedback-Endpoints für die Chrome-Extension.
 * Auth über projektspezifischen X-Feedback-Key (NICHT der Master-API-Key).
 * Wird auf /feedback gemountet – VOR den globalen Body-Parsern (20-MB-Limit).
 */
export function createFeedbackRouter({
  store, awork, workspaceUrl,
  authFailureLimiter = new FixedWindowLimiter(30, 15 * 60 * 1000),
}: Deps): Router {
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

  // ─── Key-Auth (mit Brute-Force-Bremse pro IP) ──────────────────
  router.use((req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || 'unbekannt';
    if (authFailureLimiter.blocked(ip)) {
      res.status(429).json({ error: 'rate_limited', message: 'Zu viele fehlgeschlagene Versuche, bitte später erneut' });
      return;
    }
    const key = req.headers['x-feedback-key'];
    const record = typeof key === 'string' ? store.findActive(key) : undefined;
    if (!record) {
      authFailureLimiter.hit(ip);
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

  // ─── Ticket anlegen ────────────────────────────────────────────
  // Eigener JSON-Parser mit 20 MB (Screenshots als Base64).
  router.post('/tickets', express.json({ limit: '20mb' }), async (req: Request, res: Response) => {
    const record = res.locals.feedbackKey as FeedbackKeyRecord;

    if (!checkRateLimit(record.key)) {
      res.status(429).json({ error: 'rate_limited', message: 'Zu viele Tickets, bitte später erneut versuchen' });
      return;
    }

    const validation = validateTicketPayload(req.body);
    if (!validation.ok) {
      res.status(400).json({ error: 'validation', message: validation.message });
      return;
    }
    const ticket = validation.value;

    const hostname = new URL(ticket.page.url).hostname;
    if (!domainAllowed(hostname, record.domains)) {
      res.status(403).json({ error: 'domain_not_allowed', message: `Key gilt nicht für ${hostname}` });
      return;
    }

    // Assignee bestimmen: intern = Formularwahl (muss Mitglied sein), Kunde = Default
    let assigneeId: string | null = null;
    if (record.type === 'internal') {
      if (ticket.assigneeId) {
        try {
          const members = await awork.getProjectMembers(record.projectId);
          if (!members.some(m => m.userId === ticket.assigneeId)) {
            res.status(400).json({ error: 'validation', message: 'assigneeId ist kein Projektmitglied' });
            return;
          }
          assigneeId = ticket.assigneeId;
        } catch (e: any) {
          console.error(`❌ Mitglieder-Prüfung fehlgeschlagen (${record.label}): ${e.message}`);
          res.status(502).json({ error: 'awork_unreachable', message: 'awork antwortet nicht' });
          return;
        }
      }
    } else {
      assigneeId = record.defaultAssigneeId;
    }

    // Task anlegen – Kern der Operation, Fehler hier = 502
    let taskId: string;
    try {
      const task = await awork.createTask(
        taskNameFrom(ticket.description),
        record.projectId,
        record.taskListId,
        buildTicketDescriptionHtml(ticket),
      );
      taskId = task.id;
    } catch (e: any) {
      console.error(`❌ Ticket-Anlage fehlgeschlagen (${record.label}): ${e.message}`);
      res.status(502).json({ error: 'awork_unreachable', message: 'awork antwortet nicht' });
      return;
    }

    // Best-effort: Zuweisung (Task existiert bereits, Fehler nur loggen)
    if (assigneeId) {
      try {
        await awork.setTaskAssignees(taskId, [assigneeId]);
      } catch (e: any) {
        console.warn(`⚠️  Zuweisung fehlgeschlagen (Task ${taskId}): ${e.message}`);
      }
    }

    // Best-effort: Screenshot (Text ist wichtiger als Bild)
    let screenshotAttached = false;
    if (ticket.screenshot) {
      const buf = decodeScreenshot(ticket.screenshot);
      if (buf) {
        try {
          await awork.uploadTaskFile(taskId, buf, `screenshot-${Date.now()}.png`, 'image/png');
          screenshotAttached = true;
        } catch (e: any) {
          console.warn(`⚠️  Screenshot-Upload fehlgeschlagen (Task ${taskId}): ${e.message}`);
        }
      }
    }

    const taskUrl = workspaceUrl ? `${workspaceUrl}/tasks/${taskId}` : '';
    console.log(`✅ Feedback-Ticket angelegt: "${taskNameFrom(ticket.description)}" → ${record.label} (Screenshot: ${screenshotAttached})`);
    res.status(201).json({ taskId, taskUrl, screenshotAttached });
  });

  return router;
}
