import fetch from 'node-fetch';
import FormData from 'form-data';

// ─── Types ───────────────────────────────────────────────────────

export interface AworkProject {
  id: string;
  name: string;
  companyId?: string;
}

export interface AworkCompany {
  id: string;
  name: string;
}

export interface AworkTaskList {
  id: string;
  name: string;
}

export interface AworkDocument {
  id: string;
  name: string;
  projectId?: string;
}

export interface AworkTask {
  id: string;
  name: string;
  projectId: string;
}

export interface AworkProjectMember {
  id: string;
  userId: string;
  firstName: string | null;
  lastName: string | null;
  projectRoleName?: string;
  isDeactivated?: boolean;
  isExternal?: boolean;
}

export interface AworkUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  isDeactivated?: boolean;
  isArchived?: boolean;
  isExternal?: boolean;
  userContactInfos?: { type: string; subType?: string; value: string }[];
}

export interface AworkTimeEntry {
  id: string;
  userId: string;
  /** Dauer in Sekunden */
  duration: number;
  note?: string | null;
  startDateLocal?: string;
  // Vom Teamboard-Timer-Mapping gebrauchte Felder (Teamboard: laufende Timer).
  startDateUtc?: string;
  startTimeUtc?: string;
  endTimeUtc?: string | null;
  breaks?: { startDate: string; duration?: number; endDate?: string | null }[];
  project?: { id: string; name: string } | null;
  task?: { id: string; name: string; taskIdentifier?: string } | null;
}

// ─── Teamboard (rein lesend) ─────────────────────────────────────

export interface TeamboardNutzer {
  id: string;
  vorname: string;
  nachname: string;
}

export interface TimerPause {
  startUtc: string; // ISO, z. B. "2026-08-25T08:31:32Z"
  dauerSekunden: number;
  endeUtc: string | null; // null = Pause läuft noch
}

export interface LaufenderTimer {
  userId: string;
  aufgabenName: string | null;
  aufgabenKennung: string | null; // z. B. "STRI-37"
  projektName: string | null;
  projektId: string | null;
  startUtc: string; // ISO mit ganzen Sekunden, z. B. "2026-08-26T09:03:31Z"
  pausen: TimerPause[];
}

export interface OffeneAufgabe {
  id: string;
  name: string;
  kennung: string | null; // taskIdentifier, z. B. "STRI-37"
  projektName: string | null;
  projektId: string | null;
  statusName: string; // z. B. "EntwicklerCheck"
  statusTyp: string; // todo | progress | review | stuck (done ist rausgefiltert)
  faelligAm: string | null; // dueOn, ISO
  istPrio: boolean;
  istWiederkehrend: boolean;
  assigneeIds: string[];
}

/** Rohform von GET /me/allavailabletasks (nur intern für getAvailableTasks). */
interface AworkAvailableTaskRaw {
  id: string;
  name: string;
  taskIdentifier?: string | null;
  project?: { id: string; name: string } | null;
  taskStatus?: { name: string; type: string } | null;
  dueOn?: string | null;
  isPrio?: boolean;
  isRecurring?: boolean;
  assignees?: { id: string }[];
}

/** Rohform von GET /tasks/{taskId} (nur intern für getTask). */
interface AworkTaskDetailRaw {
  id: string;
  name: string;
  taskStatusId?: string | null;
  taskStatus?: { id: string; name: string; type: string } | null;
  projectId?: string | null;
  isRecurring?: boolean;
}

/** E-Mail eines awork-Users aus den Kontaktinfos (bevorzugt "work"). */
export function aworkUserEmail(user: AworkUser): string | null {
  const emails = (user.userContactInfos || []).filter(c => c.type === 'email' && c.value);
  if (emails.length === 0) return null;
  return (emails.find(c => c.subType === 'work') || emails[0]).value;
}

// ─── Client ──────────────────────────────────────────────────────

export class AworkClient {
  private baseUrl: string;
  private token: string;

  constructor(token: string, baseUrl = 'https://api.awork.com/api/v1') {
    this.token = token;
    this.baseUrl = baseUrl;
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}` };
  }

  private async request<T>(path: string, options?: any): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: { ...this.headers(), ...options?.headers },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`awork API ${res.status} ${res.statusText}: ${body} [${options?.method || 'GET'} ${path}]`);
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return res.json() as Promise<T>;
    }
    return res.text() as unknown as T;
  }

  /**
   * Holt alle Seiten eines Listen-Endpunkts (pageSize=1000) und konkateniert
   * die Ergebnisse, solange die zuletzt gelesene Seite voll war
   * (Seitenlänge === pageSize).
   */
  private async fetchAllPages<T>(path: string, extraParams: Record<string, string> = {}): Promise<T[]> {
    const pageSize = 1000;
    const results: T[] = [];
    let page = 1;
    for (;;) {
      const qs = new URLSearchParams({ ...extraParams, pageSize: String(pageSize), page: String(page) });
      const data = await this.request<T[]>(`${path}?${qs.toString()}`);
      results.push(...data);
      if (data.length !== pageSize) {
        break;
      }
      page += 1;
    }
    return results;
  }

  // ─── Lookup ──────────────────────────────────────────────────

  async getProjects(): Promise<AworkProject[]> {
    return this.request('/projects?pageSize=200');
  }

  async getCompanies(): Promise<AworkCompany[]> {
    return this.request('/companies?pageSize=200');
  }

  async findProject(searchTerm: string): Promise<AworkProject | undefined> {
    const projects = await this.getProjects();
    const term = searchTerm.toLowerCase();
    return projects.find(p => p.name.toLowerCase().includes(term));
  }

  async getTaskLists(projectId: string): Promise<AworkTaskList[]> {
    return this.request(`/projects/${projectId}/tasklists`);
  }

  async getProject(projectId: string): Promise<AworkProject> {
    return this.request(`/projects/${projectId}`);
  }

  async getProjectMembers(projectId: string): Promise<AworkProjectMember[]> {
    return this.request(`/projects/${projectId}/members`);
  }

  async createTaskList(projectId: string, name: string): Promise<AworkTaskList> {
    return this.request(`/projects/${projectId}/tasklists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  }

  // ─── Users & Zeiterfassung ───────────────────────────────────

  async getUsers(): Promise<AworkUser[]> {
    return this.request('/users?pageSize=200');
  }

  /**
   * Alle Zeiteinträge eines Kalendertags (lokale awork-Zeit).
   * `day` als "YYYY-MM-DD".
   */
  async getTimeEntriesForDay(day: string): Promise<AworkTimeEntry[]> {
    return this.getTimeEntriesForRange(day, day);
  }

  // ─── Documents ───────────────────────────────────────────────

  async createDocument(name: string, htmlContent: string, projectId: string): Promise<AworkDocument> {
    const form = new FormData();
    form.append('Name', name);
    form.append('ProjectId', projectId);
    form.append('Content', Buffer.from(htmlContent, 'utf-8'), {
      filename: 'content.html',
      contentType: 'text/html; charset=utf-8',
    });

    return this.request('/documents', {
      method: 'POST',
      headers: form.getHeaders(),
      body: form,
    });
  }

  async getDocumentContent(documentId: string): Promise<string> {
    return this.request(`/documents/${documentId}/content?streamAsFile=true`);
  }

  async updateDocument(documentId: string, htmlContent: string): Promise<AworkDocument> {
    const form = new FormData();
    form.append('content', Buffer.from(htmlContent, 'utf-8'), {
      filename: 'content.html',
      contentType: 'text/html; charset=utf-8',
    });

    return this.request(`/documents/${documentId}/content`, {
      method: 'PUT',
      headers: form.getHeaders(),
      body: form,
    });
  }

  async listDocuments(pageSize = 50): Promise<AworkDocument[]> {
    return this.request(`/documents?pageSize=${pageSize}`);
  }

  // ─── Tasks ───────────────────────────────────────────────────

  async createTask(
    name: string,
    projectId: string,
    taskListId: string,
    description?: string,
    dueOn?: string
  ): Promise<AworkTask> {
    return this.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        baseType: 'projecttask',
        entityId: projectId,
        lists: [{ id: taskListId }],
        ...(description && { description }),
        ...(dueOn && { dueOn }),
      }),
    });
  }

  /** Body ist lt. awork-OpenAPI ein reines Array von User-UUIDs. Antwort: 204. */
  async setTaskAssignees(taskId: string, userIds: string[]): Promise<void> {
    await this.request(`/tasks/${taskId}/setassignees`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userIds),
    });
  }

  // ─── Files ───────────────────────────────────────────────────

  async uploadProjectFile(projectId: string, fileBuffer: Buffer, filename: string): Promise<any> {
    const form = new FormData();
    form.append('file', fileBuffer, { filename });

    return this.request(`/projects/${projectId}/files`, {
      method: 'POST',
      headers: form.getHeaders(),
      body: form,
    });
  }

  /** Multipart-Feld heißt lt. awork-OpenAPI "File" (großes F). */
  async uploadTaskFile(taskId: string, fileBuffer: Buffer, filename: string, contentType: string): Promise<any> {
    const form = new FormData();
    form.append('File', fileBuffer, { filename, contentType });

    return this.request(`/tasks/${taskId}/files`, {
      method: 'POST',
      headers: form.getHeaders(),
      body: form,
    });
  }

  // ─── Teamboard (rein lesend) ───────────────────────────────────

  /** Aktive, interne Nutzer fürs Teamboard (deaktivierte/externe fallen raus). */
  async getBoardUsers(): Promise<TeamboardNutzer[]> {
    const data = await this.fetchAllPages<AworkUser>('/users');
    return data
      .filter((u) => !u.isDeactivated && !u.isExternal)
      .map((u) => ({
        id: u.id,
        // Namen trimmen — echte Daten enthalten teils Leerzeichen am Ende
        // ("Goldammer "), und nachname kann ganz fehlen (Nutzerin "Gabi").
        vorname: String(u.firstName ?? '').trim(),
        nachname: String(u.lastName ?? '').trim(),
      }));
  }

  /** Aktuell laufende Zeit-Timer (für alle Nutzer, nicht nur "me"). */
  async getRunningTimers(): Promise<LaufenderTimer[]> {
    // Stufe-1-Spec §3: "endTimeUtc eq null" allein reicht NICHT (manuelle
    // Dauer-Buchungen ohne Startzeit haben ebenfalls kein Ende) — erst
    // zusammen mit "startTimeUtc ne null" bleiben genau die laufenden Timer
    // übrig.
    const filter = 'endTimeUtc eq null and startTimeUtc ne null';
    const data = await this.fetchAllPages<AworkTimeEntry>('/timeentries', { filterby: filter });
    return data.map((e) => ({
      userId: e.userId,
      aufgabenName: e.task?.name ?? null,
      aufgabenKennung: e.task?.taskIdentifier ?? null,
      projektName: e.project?.name ?? null,
      projektId: e.project?.id ?? null,
      // startDateUtc trägt das Datum, startTimeUtc die Uhrzeit mit bis zu
      // 7 Nachkommastellen — Date.parse kommt damit nicht zuverlässig klar,
      // deshalb auf ganze Sekunden gekürzt zusammensetzen.
      startUtc: `${String(e.startDateUtc).slice(0, 10)}T${String(e.startTimeUtc).split('.')[0]}Z`,
      pausen: (e.breaks ?? []).map((b) => ({
        startUtc: b.startDate,
        dauerSekunden: b.duration ?? 0,
        // Fehlendes endDate ⇒ Pause läuft noch.
        endeUtc: b.endDate ?? null,
      })),
    }));
  }

  /** Offene Aufgaben (alle Projekte, für den API-Nutzer sichtbar). */
  async getAvailableTasks(): Promise<OffeneAufgabe[]> {
    // Stufe-1-Spec §3: /tasks ist für den API-Token gesperrt — der einzig
    // erreichbare Pfad ist /me/allavailabletasks (me = API-Nutzer, sieht
    // alle Projekte). Nicht "aufräumen" auf /tasks.
    const filter = "taskStatus/type ne 'done'";
    const data = await this.fetchAllPages<AworkAvailableTaskRaw>('/me/allavailabletasks', { filterby: filter });
    return data.map((t) => ({
      id: t.id,
      name: t.name,
      kennung: t.taskIdentifier ?? null,
      projektName: t.project?.name ?? null,
      projektId: t.project?.id ?? null,
      statusName: t.taskStatus?.name ?? '',
      statusTyp: t.taskStatus?.type ?? 'todo',
      faelligAm: t.dueOn ?? null,
      istPrio: t.isPrio === true,
      istWiederkehrend: t.isRecurring === true,
      assigneeIds: (t.assignees ?? []).map((a) => a.id),
    }));
  }

  /**
   * Alle Zeiteinträge in einem (inklusiven) Datumsbereich (lokale awork-Zeit).
   * `fromLocal`/`toLocal` als "YYYY-MM-DD". Verallgemeinert getTimeEntriesForDay.
   */
  async getTimeEntriesForRange(fromLocal: string, toLocal: string): Promise<AworkTimeEntry[]> {
    const filter = `StartDateLocal ge datetime'${fromLocal}T00:00:00' and StartDateLocal le datetime'${toLocal}T23:59:59'`;
    return this.fetchAllPages<AworkTimeEntry>('/timeentries', { filterby: filter });
  }

  /**
   * Profilbild eines Nutzers (Teamboard-Avatare). null bei 404 (kein Bild
   * hochgeladen oder Nutzer unbekannt — awork unterscheidet beides nicht).
   * Nutzt bewusst NICHT request<T>(): der Helfer geht über res.text()/
   * res.json() und korrumpiert damit Binärdaten. Deshalb hier ein eigener
   * fetch-Aufruf mit arrayBuffer().
   */
  async getUserImage(userId: string): Promise<{ typ: string; bytes: Buffer } | null> {
    const path = `/files/images/users/${userId}`;
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: this.headers(),
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`awork API ${res.status} ${res.statusText}: ${body} [GET ${path}]`);
    }
    return {
      typ: res.headers.get('content-type') ?? 'application/octet-stream',
      bytes: Buffer.from(await res.arrayBuffer()),
    };
  }

  // ─── Teamboard: Schreibzugriffe ─────────────────────────────
  // Ab hier schreibt der Client aktiv (Statuswechsel, Kommentar) — bis
  // Stufe 2 war awork ausschließlich lesend angebunden. getTaskStatuses
  // und getTask lesen zwar nur, gehören aber zum selben Schreibpfad
  // (Status-ID ermitteln bzw. nach dem Wechsel nachlesen, ob er griff).

  /** Status-Liste eines Projekts, z. B. um die "done"-Status-ID zu finden. */
  async getTaskStatuses(projectId: string): Promise<{ id: string; name: string; type: string }[]> {
    const data = await this.request<{ id: string; name: string; type: string }[]>(
      `/projects/${projectId}/taskstatuses`
    );
    return data.map((s) => ({ id: s.id, name: s.name, type: s.type }));
  }

  /**
   * Setzt den Status einer Aufgabe. Body ist lt. awork-API ein Array
   * ([{taskId, statusId}]); Antwort ist 204 mit leerem Body — ob der
   * Wechsel geklappt hat, ist NUR durch Nachlesen der Aufgabe (getTask)
   * feststellbar. Wirft bei HTTP-Fehler.
   */
  async changeTaskStatus(taskId: string, statusId: string): Promise<void> {
    await this.request(`/tasks/changestatuses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ taskId, statusId }]),
    });
  }

  /**
   * Einzelne Aufgabe. Anders als die Sammlung (GET /tasks, für unseren
   * Token gesperrt) funktioniert dieser Pfad. null bei 404.
   */
  async getTask(taskId: string): Promise<{
    id: string;
    name: string;
    taskStatusId: string | null;
    taskStatus: { id: string; name: string; type: string } | null;
    projectId: string | null;
    isRecurring: boolean;
  } | null> {
    try {
      const raw = await this.request<AworkTaskDetailRaw>(`/tasks/${taskId}`);
      return {
        id: raw.id,
        name: raw.name,
        taskStatusId: raw.taskStatusId ?? null,
        taskStatus: raw.taskStatus ?? null,
        projectId: raw.projectId ?? null,
        isRecurring: raw.isRecurring === true,
      };
    } catch (fehler) {
      if (fehler instanceof Error && fehler.message.startsWith('awork API 404 ')) return null;
      throw fehler;
    }
  }

  /** Kommentar an einer Aufgabe (z. B. Zurechnung "erledigt via Teamboard"). */
  async createTaskComment(taskId: string, message: string, userId: string): Promise<void> {
    await this.request(`/tasks/${taskId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, userId }),
    });
  }
}
