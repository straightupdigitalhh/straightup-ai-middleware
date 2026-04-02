import { AworkClient, AworkProject, AworkDocument, AworkTaskList } from './awork.js';

// ─── Types ───────────────────────────────────────────────────────

interface ResolvedProject {
  projectId: string;
  projectName: string;
  actionItemsListId?: string;
  entscheidungslogDocId?: string;
  emailLogDocId?: string;
  meetingUebersichtDocId?: string;
  angeboteDokumenteDocId?: string;
}

// ─── Resolver ────────────────────────────────────────────────────

export class AworkResolver {
  private projectCache = new Map<string, AworkProject[]>();
  private docCache = new Map<string, AworkDocument[]>();

  constructor(private awork: AworkClient) {}

  /**
   * Löst Kundenname + optionaler Projektname in awork-IDs auf.
   * Ohne Projektname → "🏢 [Kunde] – Allgemein"
   * Mit Projektname → Sucht nach passendem Projekt
   */
  async resolveProject(customerName: string, projectName?: string): Promise<ResolvedProject> {
    const projects = await this.getCachedProjects();

    // Projekt finden
    let project: AworkProject | undefined;

    if (projectName) {
      // Suche nach "[Kunde]... [Projekt]" oder nur "[Projekt]"
      const customerLower = customerName.toLowerCase();
      const projectLower = projectName.toLowerCase();

      project = projects.find(p => {
        const name = p.name.toLowerCase();
        return name.includes(customerLower) && name.includes(projectLower);
      });

      // Fallback: nur nach Projektname suchen
      if (!project) {
        project = projects.find(p => p.name.toLowerCase().includes(projectLower));
      }
    } else {
      // Kein Projektname → Allgemein-Projekt
      const searchTerms = [
        `🏢 ${customerName}`,
        `${customerName} – allgemein`,
        `${customerName} - allgemein`,
      ];

      for (const term of searchTerms) {
        project = projects.find(p =>
          p.name.toLowerCase().includes(term.toLowerCase())
        );
        if (project) break;
      }
    }

    if (!project) {
      const target = projectName
        ? `"${customerName} – ${projectName}"`
        : `"🏢 ${customerName} – Allgemein"`;
      throw new Error(`Projekt nicht gefunden: ${target}`);
    }

    // Strukturdaten auflösen
    const resolved: ResolvedProject = {
      projectId: project.id,
      projectName: project.name,
    };

    // Action Items Taskliste finden
    try {
      const taskLists = await this.awork.getTaskLists(project.id);
      const actionList = taskLists.find(t =>
        t.name.toLowerCase().includes('action item')
      );
      if (actionList) {
        resolved.actionItemsListId = actionList.id;
      }
    } catch (e) {
      console.warn(`Tasklisten für ${project.name} nicht abrufbar:`, e);
    }

    // Bekannte Docs finden
    try {
      const docs = await this.getCachedDocuments();
      const projectDocs = docs.filter(d => d.projectId === project!.id);

      for (const doc of projectDocs) {
        const name = doc.name.toLowerCase();
        if (name === 'entscheidungslog') resolved.entscheidungslogDocId = doc.id;
        if (name === 'e-mail-log') resolved.emailLogDocId = doc.id;
        if (name === 'meeting-übersicht') resolved.meetingUebersichtDocId = doc.id;
        if (name.includes('angebote')) resolved.angeboteDokumenteDocId = doc.id;
      }
    } catch (e) {
      console.warn(`Docs für ${project.name} nicht abrufbar:`, e);
    }

    return resolved;
  }

  /**
   * Löst das Allgemein-Projekt für einen Kunden auf.
   * Convenience-Methode für projektübergreifende Inhalte.
   */
  async resolveAllgemeinProject(customerName: string): Promise<ResolvedProject> {
    return this.resolveProject(customerName); // ohne Projektname → Allgemein
  }

  // ─── Cache ─────────────────────────────────────────────────────

  private async getCachedProjects(): Promise<AworkProject[]> {
    if (!this.projectCache.has('all')) {
      const projects = await this.awork.getProjects();
      this.projectCache.set('all', projects);
    }
    return this.projectCache.get('all')!;
  }

  private async getCachedDocuments(): Promise<AworkDocument[]> {
    if (!this.docCache.has('all')) {
      const docs = await this.awork.listDocuments(200);
      this.docCache.set('all', docs);
    }
    return this.docCache.get('all')!;
  }

  /** Cache leeren (z.B. nach dem Anlegen neuer Docs) */
  clearCache(): void {
    this.projectCache.clear();
    this.docCache.clear();
  }
}
