import { Router, Request, Response } from 'express';
import { AworkClient } from '../services/awork.js';
import { getPollerInstance } from '../services/email-poller.js';

const router = Router();

/**
 * GET /health
 * Prüft ob die Middleware läuft und die awork-API erreichbar ist.
 */
router.get('/health', async (_req: Request, res: Response) => {
  const checks: Record<string, string> = {
    middleware: 'ok',
    awork: 'unknown',
    anthropic: process.env.ANTHROPIC_API_KEY ? 'configured' : 'missing',
    emailPolling: 'disabled',
  };

  try {
    const awork = new AworkClient(process.env.AWORK_API_TOKEN!);
    const projects = await awork.getProjects();
    checks.awork = `ok (${projects.length} Projekte)`;
  } catch (e: any) {
    checks.awork = `error: ${e.message}`;
  }

  // Poller-Status
  const pollerInstance = getPollerInstance();
  if (pollerInstance) {
    const status = pollerInstance.getStatus();
    checks.emailPolling = status.active
      ? `aktiv (${status.totalProcessed} verarbeitet, ${status.totalErrors} Fehler)`
      : 'gestoppt';
    if (status.lastPollAt) {
      checks.emailPollingLastPoll = `${status.lastPollAt} — ${status.lastPollResult}`;
    }
  }

  const allOk = checks.awork.startsWith('ok') && checks.anthropic === 'configured';

  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'healthy' : 'degraded',
    checks,
    timestamp: new Date().toISOString(),
  });
});

export default router;
