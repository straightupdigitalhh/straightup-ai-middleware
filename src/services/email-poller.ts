import { MicrosoftGraphClient, type GraphEmail, stripHtml } from './microsoft-graph.js';

// ─── Singleton für Health-Check Zugriff ─────────────────────────

let pollerInstance: EmailPoller | null = null;

export function setPollerInstance(poller: EmailPoller): void {
  pollerInstance = poller;
}

export function getPollerInstance(): EmailPoller | null {
  return pollerInstance;
}
import { routeContent, detectCustomer } from './claude.js';
import { AworkClient } from './awork.js';
import { AworkResolver } from './resolver.js';
import { renderEmailLogEntry, renderDecisionLogEntry } from '../templates/index.js';

// ─── Types ───────────────────────────────────────────────────────

export interface EmailPollerConfig {
  pollInterval: number;
  triggerCategory: string;
  processedCategory: string;
}

interface PollerStatus {
  active: boolean;
  lastPollAt?: string;
  lastPollResult?: string;
  totalProcessed: number;
  totalErrors: number;
}

// ─── Poller ─────────────────────────────────────────────────────

export class EmailPoller {
  private timer: NodeJS.Timeout | null = null;
  private isPolling = false;
  private status: PollerStatus = {
    active: false,
    totalProcessed: 0,
    totalErrors: 0,
  };

  constructor(
    private graphClient: MicrosoftGraphClient,
    private config: EmailPollerConfig
  ) {}

  start(): void {
    if (this.timer) return;
    this.status.active = true;
    console.log(`📬 E-Mail-Polling gestartet (alle ${Math.round(this.config.pollInterval / 1000)}s, Kategorie: "${this.config.triggerCategory}")`);

    // Erster Poll sofort
    this.poll();

    this.timer = setInterval(() => this.poll(), this.config.pollInterval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.status.active = false;
    console.log('📭 E-Mail-Polling gestoppt');
  }

  getStatus(): PollerStatus {
    return { ...this.status };
  }

  async poll(): Promise<{ processed: number; errors: number }> {
    if (this.isPolling) {
      console.log('📬 Poll übersprungen (vorheriger läuft noch)');
      return { processed: 0, errors: 0 };
    }

    this.isPolling = true;
    let processed = 0;
    let errors = 0;

    try {
      const emails = await this.graphClient.getEmailsByCategory(this.config.triggerCategory);

      if (emails.length === 0) {
        this.status.lastPollAt = new Date().toISOString();
        this.status.lastPollResult = 'Keine neuen E-Mails';
        this.isPolling = false;
        return { processed: 0, errors: 0 };
      }

      console.log(`📬 ${emails.length} E-Mail(s) mit Kategorie "${this.config.triggerCategory}" gefunden`);

      for (const email of emails) {
        try {
          await this.processEmail(email);
          processed++;
          this.status.totalProcessed++;
        } catch (error: any) {
          errors++;
          this.status.totalErrors++;
          console.error(`   ❌ Fehler bei E-Mail "${email.subject}": ${error.message}`);
          // NICHT als verarbeitet markieren → wird beim nächsten Poll erneut versucht
        }
      }

      this.status.lastPollAt = new Date().toISOString();
      this.status.lastPollResult = `${processed} verarbeitet, ${errors} Fehler`;
      console.log(`📬 Poll abgeschlossen: ${processed} verarbeitet, ${errors} Fehler`);
    } catch (error: any) {
      console.error(`📬 Poll-Fehler: ${error.message}`);
      this.status.lastPollAt = new Date().toISOString();
      this.status.lastPollResult = `Fehler: ${error.message}`;
    } finally {
      this.isPolling = false;
    }

    return { processed, errors };
  }

  private async processEmail(email: GraphEmail): Promise<void> {
    const subject = email.subject || '(kein Betreff)';
    const fromAddress = email.from?.emailAddress?.address || '';
    const fromName = email.from?.emailAddress?.name || '';
    const fromStr = fromName ? `${fromName} <${fromAddress}>` : fromAddress;
    const receivedDate = email.receivedDateTime
      ? new Date(email.receivedDateTime).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];

    // Body extrahieren
    let bodyText: string;
    if (email.body.contentType === 'text') {
      bodyText = email.body.content;
    } else {
      bodyText = stripHtml(email.body.content);
    }
    if (!bodyText || bodyText.length < 10) {
      bodyText = email.bodyPreview || '';
    }
    if (!bodyText) {
      console.warn(`   ⚠ E-Mail "${subject}" hat keinen Inhalt, übersprungen`);
      return;
    }

    console.log(`   📧 Verarbeite: "${subject}" von ${fromStr}`);

    const emailContent = `Betreff: ${subject}\nVon: ${fromStr}\nDatum: ${receivedDate}\n\n${bodyText}`;

    // Kunden-Autoerkennung
    const awork = new AworkClient(process.env.AWORK_API_TOKEN!);
    const resolver = new AworkResolver(awork);
    const knownCustomers = await resolver.extractUniqueCustomerNames();
    const detection = await detectCustomer(emailContent, fromAddress, subject, knownCustomers);
    console.log(`   → Kunde: "${detection.customerName}" (${detection.confidence})`);

    if (detection.customerName === 'Unbekannt') {
      console.warn(`   ⚠ Kunde nicht erkannt — E-Mail wird trotzdem verarbeitet`);
    }

    // Claude-Analyse
    const routing = await routeContent(
      emailContent,
      'email',
      detection.customerName,
      detection.projectName || undefined
    );
    console.log(`   → Kategorie: ${routing.emailCategory}, Titel: "${routing.title}"`);

    // awork-Projekt auflösen
    const project = await resolver.resolveProject(
      detection.customerName,
      detection.projectName || undefined
    );
    console.log(`   → Projekt: ${project.projectName}`);

    // E-Mail-Log aktualisieren
    if (project.emailLogDocId) {
      const currentContent = await awork.getDocumentContent(project.emailLogDocId);
      const newEntry = renderEmailLogEntry(routing, fromStr, receivedDate);
      await awork.updateDocument(project.emailLogDocId, currentContent + newEntry);
      console.log(`   ✅ E-Mail-Log aktualisiert`);
    } else {
      const newEntry = renderEmailLogEntry(routing, fromStr, receivedDate);
      await awork.createDocument(
        `E-Mail: ${receivedDate} – ${routing.title}`,
        newEntry,
        project.projectId
      );
      console.log(`   ✅ Neues E-Mail-Doc angelegt`);
    }

    // Entscheidungen loggen
    if (routing.emailCategory === 'decision' && routing.decisions?.length && project.entscheidungslogDocId) {
      const currentLog = await awork.getDocumentContent(project.entscheidungslogDocId);
      let logAddition = '';
      for (const decision of routing.decisions) {
        logAddition += renderDecisionLogEntry(decision, `E-Mail von ${fromStr}`);
      }
      await awork.updateDocument(project.entscheidungslogDocId, currentLog + logAddition);
      console.log(`   ✅ ${routing.decisions.length} Entscheidung(en) geloggt`);
    }

    // Action Items als Tasks
    if (routing.actionItems?.length && project.actionItemsListId) {
      for (const item of routing.actionItems) {
        await awork.createTask(
          item.task,
          project.projectId,
          project.actionItemsListId,
          `Aus E-Mail: "${subject}" (${receivedDate})`,
          item.dueDate || undefined
        );
        console.log(`   ✅ Task: "${item.task}"`);
      }
    }

    // Kategorie auf "verarbeitet" ändern
    const newCategories = email.categories
      .filter(c => c !== this.config.triggerCategory)
      .concat(this.config.processedCategory);

    await this.graphClient.updateEmailCategories(email.id, newCategories);
    console.log(`   ✅ Kategorie → "${this.config.processedCategory}"`);
  }
}
