import { Router, Request, Response } from 'express';
import { routeContent } from '../services/claude.js';
import { AworkClient } from '../services/awork.js';
import { AworkResolver } from '../services/resolver.js';
import { renderEmailLogEntry, renderDecisionLogEntry } from '../templates/index.js';

const router = Router();

/**
 * POST /api/email
 *
 * Verarbeitet eine E-Mail und legt sie strukturiert in awork ab.
 *
 * Body:
 * {
 *   "subject": "Re: Designentwurf Homepage",
 *   "body": "Hallo Jan, wir haben uns für Variante B entschieden...",
 *   "from": "burkhart.zuch@dentaversum.de",
 *   "receivedAt": "2026-04-02T14:30:00Z",
 *   "customerName": "Dentaversum",
 *   "projectName": "Web-Support"    // optional
 * }
 */
router.post('/api/email', async (req: Request, res: Response) => {
  try {
    const { subject, body, from, receivedAt, customerName, projectName } = req.body;

    // Validierung
    if (!body || !customerName) {
      res.status(400).json({
        error: 'Pflichtfelder fehlen: body, customerName',
      });
      return;
    }

    const emailContent = subject
      ? `Betreff: ${subject}\nVon: ${from || 'unbekannt'}\nDatum: ${receivedAt || 'unbekannt'}\n\n${body}`
      : body;

    console.log(`📧 E-Mail verarbeiten: "${subject}" von ${from} für ${customerName}`);

    // 1. Claude analysiert die E-Mail
    const routing = await routeContent(emailContent, 'email', customerName, projectName);
    console.log(`   → Kategorie: ${routing.emailCategory}, Titel: "${routing.title}"`);

    // 2. awork-IDs auflösen
    const awork = new AworkClient(process.env.AWORK_API_TOKEN!);
    const resolver = new AworkResolver(awork);

    const project = await resolver.resolveProject(customerName, projectName);
    console.log(`   → Projekt: ${project.projectName} (${project.projectId})`);

    const date = receivedAt
      ? new Date(receivedAt).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];

    const results: string[] = [];

    // 3. E-Mail-Log aktualisieren
    if (project.emailLogDocId) {
      const currentContent = await awork.getDocumentContent(project.emailLogDocId);
      const newEntry = renderEmailLogEntry(routing, from || 'unbekannt', date);
      await awork.updateDocument(project.emailLogDocId, currentContent + newEntry);
      results.push(`E-Mail-Log aktualisiert`);
      console.log(`   ✅ E-Mail-Log aktualisiert`);
    } else {
      // Kein E-Mail-Log → neues Doc anlegen
      const newEntry = renderEmailLogEntry(routing, from || 'unbekannt', date);
      const doc = await awork.createDocument(
        `E-Mail: ${date} – ${routing.title}`,
        newEntry,
        project.projectId
      );
      results.push(`Neues E-Mail-Doc angelegt: ${doc.id}`);
      console.log(`   ✅ Neues E-Mail-Doc: ${doc.id}`);
    }

    // 4. Bei Entscheidungen → Entscheidungslog aktualisieren
    if (routing.emailCategory === 'decision' && routing.decisions?.length) {
      if (project.entscheidungslogDocId) {
        const currentLog = await awork.getDocumentContent(project.entscheidungslogDocId);
        let logAddition = '';
        for (const decision of routing.decisions) {
          logAddition += renderDecisionLogEntry(decision, `E-Mail von ${from || 'unbekannt'}`);
        }
        await awork.updateDocument(project.entscheidungslogDocId, currentLog + logAddition);
        results.push(`Entscheidungslog: ${routing.decisions.length} Eintrag/Einträge`);
        console.log(`   ✅ Entscheidungslog aktualisiert`);
      }
    }

    // 5. Action Items als Tasks anlegen
    if (routing.actionItems?.length && project.actionItemsListId) {
      for (const item of routing.actionItems) {
        const task = await awork.createTask(
          item.task,
          project.projectId,
          project.actionItemsListId,
          `Aus E-Mail: "${subject || routing.title}" (${date})`,
          item.dueDate || undefined
        );
        results.push(`Task angelegt: "${item.task}" → ${task.id}`);
        console.log(`   ✅ Task: "${item.task}"`);
      }
    }

    // 6. Falls kein Projektbezug → auch ins Allgemein-Projekt
    if (!projectName) {
      results.push(`Abgelegt im Allgemein-Projekt (kein spezifisches Projekt angegeben)`);
    }

    res.json({
      status: 'ok',
      routing: {
        type: routing.type,
        emailCategory: routing.emailCategory,
        title: routing.title,
        summary: routing.summary,
        decisionsCount: routing.decisions?.length || 0,
        actionItemsCount: routing.actionItems?.length || 0,
      },
      results,
    });
  } catch (error: any) {
    console.error('❌ Fehler bei E-Mail-Verarbeitung:', error);
    res.status(500).json({
      error: 'E-Mail-Verarbeitung fehlgeschlagen',
      message: error.message,
    });
  }
});

export default router;
