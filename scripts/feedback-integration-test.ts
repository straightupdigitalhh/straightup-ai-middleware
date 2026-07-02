/**
 * Integrationstest gegen echtes awork.
 * Aufruf: AWORK_TEST_PROJECT_ID=<projekt-id> npm run test:integration
 * Legt Task-Liste + Task + Screenshot an, prüft alles, löscht den Task wieder.
 */
import 'dotenv/config';
import { AworkClient } from '../src/services/awork.js';
import { buildTicketDescriptionHtml, taskNameFrom } from '../src/services/feedback-ticket.js';
import { FEEDBACK_LIST_NAME } from '../src/routes/feedback-admin.js';

// 1×1 rotes Pixel-PNG
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function main() {
  const projectId = process.env.AWORK_TEST_PROJECT_ID;
  if (!projectId) {
    console.error('❌ AWORK_TEST_PROJECT_ID fehlt – Abbruch (kein Test gegen Produktivprojekte!)');
    process.exit(1);
  }
  const awork = new AworkClient(process.env.AWORK_API_TOKEN!);
  let taskId: string | undefined;

  try {
    // Task-Liste sicherstellen
    const lists = await awork.getTaskLists(projectId);
    let list = lists.find(l => l.name === FEEDBACK_LIST_NAME);
    if (!list) list = await awork.createTaskList(projectId, FEEDBACK_LIST_NAME);
    console.log(`✅ Task-Liste: ${list.name} (${list.id})`);

    // Ticket wie aus der Extension
    const ticket = {
      description: 'INTEGRATIONSTEST – bitte ignorieren\nWird automatisch gelöscht.',
      reporterName: 'Integrationstest',
      page: { url: 'https://example.com/test', title: 'Testseite' },
      element: { selector: '#test', rect: { x: 0, y: 0, width: 10, height: 10 } },
      environment: {
        viewport: { width: 1280, height: 800 }, screen: { width: 1280, height: 800 },
        devicePixelRatio: 1, userAgent: 'IntegrationTest/1.0', timestamp: new Date().toISOString(),
      },
    };
    const task = await awork.createTask(
      taskNameFrom(ticket.description), projectId, list.id, buildTicketDescriptionHtml(ticket),
    );
    taskId = task.id;
    console.log(`✅ Task angelegt: ${taskId}`);

    // Screenshot hochladen + verifizieren
    await awork.uploadTaskFile(taskId, TINY_PNG, 'screenshot-test.png', 'image/png');
    const files = await (awork as any).request(`/tasks/${taskId}/files`);
    if (!Array.isArray(files) || files.length !== 1) throw new Error(`Erwartete 1 Datei, bekam: ${JSON.stringify(files)}`);
    console.log(`✅ Screenshot angehängt: ${files[0].name ?? files[0].id}`);

    // Assignee: erstes aktives Projektmitglied
    const members = await awork.getProjectMembers(projectId);
    const member = members.find(m => !m.isDeactivated);
    if (member) {
      await awork.setTaskAssignees(taskId, [member.userId]);
      console.log(`✅ Zugewiesen an: ${member.firstName} ${member.lastName}`);
    } else {
      console.log('⚠️  Kein aktives Mitglied gefunden – Zuweisung übersprungen');
    }

    console.log('\n🎉 Integrationstest erfolgreich');
  } finally {
    if (taskId) {
      await (awork as any).request('/tasks/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskIds: [taskId] }),
      });
      console.log(`🧹 Task ${taskId} wieder gelöscht`);
    }
  }
}

main().catch(e => { console.error(`❌ ${e.message}`); process.exit(1); });
