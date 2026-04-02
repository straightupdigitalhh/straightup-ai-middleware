import { Router, Request, Response } from 'express';
import { routeContent } from '../services/claude.js';
import { AworkClient } from '../services/awork.js';
import { AworkResolver } from '../services/resolver.js';
import {
  renderMeetingDoc,
  renderDecisionLogEntry,
  renderMeetingIndexEntry,
} from '../templates/index.js';

const router = Router();

/**
 * POST /api/transcript
 *
 * Verarbeitet ein Meeting-Transkript und legt es strukturiert in awork ab.
 *
 * Body:
 * {
 *   "content": "Jan: Hallo zusammen... Dr. Zuch: Wir brauchen...",
 *   "customerName": "Dentaversum",
 *   "projectName": "Web-Support",    // optional
 *   "meetingDate": "2026-04-02",      // optional, default: heute
 *   "source": "krisp"                 // optional: krisp | plaud | manual
 * }
 */
router.post('/api/transcript', async (req: Request, res: Response) => {
  try {
    const { content, customerName, projectName, meetingDate, source } = req.body;

    // Validierung
    if (!content || !customerName) {
      res.status(400).json({
        error: 'Pflichtfelder fehlen: content, customerName',
      });
      return;
    }

    const date = meetingDate || new Date().toISOString().split('T')[0];
    console.log(`🎙️ Transkript verarbeiten: ${customerName} (${date}), Quelle: ${source || 'unbekannt'}`);

    // 1. Claude analysiert das Transkript
    const routing = await routeContent(
      content,
      'transcript',
      customerName,
      projectName,
      source ? `Aufnahme-Quelle: ${source}` : undefined
    );
    console.log(`   → Titel: "${routing.title}"`);
    console.log(`   → ${routing.decisions?.length || 0} Entscheidungen, ${routing.actionItems?.length || 0} Action Items`);

    // 2. awork-IDs auflösen
    const awork = new AworkClient(process.env.AWORK_API_TOKEN!);
    const resolver = new AworkResolver(awork);

    const project = await resolver.resolveProject(customerName, projectName);
    console.log(`   → Projekt: ${project.projectName} (${project.projectId})`);

    const results: string[] = [];

    // 3. Meeting-Doc anlegen
    const meetingHtml = renderMeetingDoc(routing, date);
    const docName = `Meeting: ${date} – ${routing.title}`;
    const meetingDoc = await awork.createDocument(docName, meetingHtml, project.projectId);
    results.push(`Meeting-Doc angelegt: "${docName}" → ${meetingDoc.id}`);
    console.log(`   ✅ Meeting-Doc: ${meetingDoc.id}`);

    // 4. Meeting-Übersicht aktualisieren
    if (project.meetingUebersichtDocId) {
      try {
        const currentIndex = await awork.getDocumentContent(project.meetingUebersichtDocId);
        const newRow = renderMeetingIndexEntry(
          date,
          routing.title,
          routing.participants || 'nicht angegeben'
        );
        // Füge die neue Zeile vor </table> ein
        const updatedIndex = currentIndex.replace(
          /<\/table>/,
          `${newRow}\n</table>`
        );
        // Entferne den "Noch keine Meetings"-Platzhalter falls vorhanden
        const cleanedIndex = updatedIndex.replace(
          /<tr><td colspan="4"><em>Noch keine Meetings.*?<\/em><\/td><\/tr>\s*/,
          ''
        );
        await awork.updateDocument(project.meetingUebersichtDocId, cleanedIndex);
        results.push(`Meeting-Übersicht aktualisiert`);
        console.log(`   ✅ Meeting-Übersicht aktualisiert`);
      } catch (e) {
        console.warn(`   ⚠️ Meeting-Übersicht konnte nicht aktualisiert werden:`, e);
      }
    }

    // 5. Entscheidungen ins Entscheidungslog
    if (routing.decisions?.length && project.entscheidungslogDocId) {
      const currentLog = await awork.getDocumentContent(project.entscheidungslogDocId);
      let logAddition = '';
      for (const decision of routing.decisions) {
        logAddition += renderDecisionLogEntry(decision, `Meeting: ${date} – ${routing.title}`);
      }
      await awork.updateDocument(project.entscheidungslogDocId, currentLog + logAddition);
      results.push(`Entscheidungslog: ${routing.decisions.length} Eintrag/Einträge`);
      console.log(`   ✅ Entscheidungslog: ${routing.decisions.length} Einträge`);
    }

    // 6. Action Items als Tasks
    if (routing.actionItems?.length && project.actionItemsListId) {
      for (const item of routing.actionItems) {
        const task = await awork.createTask(
          item.task,
          project.projectId,
          project.actionItemsListId,
          `Aus Meeting: ${date} – ${routing.title}`,
          item.dueDate || undefined
        );
        results.push(`Task: "${item.task}" → ${task.id}`);
        console.log(`   ✅ Task: "${item.task}"`);
      }
    }

    // 7. Neue Kontakte flaggen
    if (routing.newContacts?.length) {
      for (const contact of routing.newContacts) {
        results.push(`⚠️ Neuer Kontakt: ${contact.name} (${contact.role}) – bitte Ansprechpartner-Doc prüfen`);
        console.log(`   ⚠️ Neuer Kontakt: ${contact.name} (${contact.role})`);
      }
    }

    res.json({
      status: 'ok',
      routing: {
        type: routing.type,
        title: routing.title,
        summary: routing.summary,
        participants: routing.participants,
        decisionsCount: routing.decisions?.length || 0,
        actionItemsCount: routing.actionItems?.length || 0,
        newContactsCount: routing.newContacts?.length || 0,
      },
      documentId: meetingDoc.id,
      results,
    });
  } catch (error: any) {
    console.error('❌ Fehler bei Transkript-Verarbeitung:', error);
    res.status(500).json({
      error: 'Transkript-Verarbeitung fehlgeschlagen',
      message: error.message,
    });
  }
});

export default router;
