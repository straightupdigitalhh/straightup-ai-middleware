import { Router, Request, Response } from 'express';
import { AworkClient } from '../services/awork.js';

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
  };

  try {
    const awork = new AworkClient(process.env.AWORK_API_TOKEN!);
    const projects = await awork.getProjects();
    checks.awork = `ok (${projects.length} Projekte)`;
  } catch (e: any) {
    checks.awork = `error: ${e.message}`;
  }

  const allOk = checks.awork.startsWith('ok') && checks.anthropic === 'configured';

  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'healthy' : 'degraded',
    checks,
    timestamp: new Date().toISOString(),
  });
});

export default router;
