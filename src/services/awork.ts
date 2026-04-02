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
}
