import { Router, Request, Response } from 'express';
import { AworkClient } from '../services/awork.js';
import { AworkResolver } from '../services/resolver.js';
import { clientErrorMessage } from '../services/errors.js';

const router = Router();

/**
 * GET /api/customers
 * Gibt alle bekannten Kundennamen zurück (aus Companies + Projektnamen).
 */
router.get('/api/customers', async (_req: Request, res: Response) => {
  try {
    const awork = new AworkClient(process.env.AWORK_API_TOKEN!);
    const resolver = new AworkResolver(awork);
    const customers = await resolver.extractUniqueCustomerNames();
    res.json({ customers });
  } catch (error: any) {
    console.error('❌ /api/customers fehlgeschlagen:', error);
    res.status(500).json({ error: clientErrorMessage(error) });
  }
});

/**
 * GET /api/projects?customer=Dentaversum
 * Gibt alle Projekte eines Kunden zurück.
 */
router.get('/api/projects', async (req: Request, res: Response) => {
  try {
    const customer = req.query.customer as string;
    if (!customer) {
      res.status(400).json({ error: 'Query-Parameter "customer" fehlt' });
      return;
    }

    const awork = new AworkClient(process.env.AWORK_API_TOKEN!);
    const projects = await awork.getProjects();
    const customerLower = customer.toLowerCase();

    const matching = projects
      .filter(p => p.name.toLowerCase().includes(customerLower))
      .map(p => ({ id: p.id, name: p.name }));

    res.json({ projects: matching });
  } catch (error: any) {
    console.error('❌ /api/projects fehlgeschlagen:', error);
    res.status(500).json({ error: clientErrorMessage(error) });
  }
});

export default router;
