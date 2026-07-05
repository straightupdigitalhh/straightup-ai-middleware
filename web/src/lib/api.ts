// Schmaler Client für die Middleware-API (Session-Cookie-Auth).

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
  disabledAt: string | null;
  createdAt: string;
}

export interface AutomationStatus {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  cron: string | null;
  running: boolean;
  nextRunAt: string | null;
  lastRun: AutomationRun | null;
  settings?: Record<string, unknown>;
}

export interface AutomationRun {
  id: number;
  automationId: string;
  trigger: 'schedule' | 'manual';
  status: 'running' | 'ok' | 'error';
  startedAt: string;
  finishedAt: string | null;
  summary: string | null;
  error: string | null;
  log?: string;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    credentials: 'same-origin',
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, body.message || body.error || `Fehler ${res.status}`);
  }
  return body as T;
}

export const api = {
  // Auth
  login: (email: string, password: string) =>
    request<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  me: () => request<{ user: User }>('/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>('/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),

  // Automationen
  automations: () => request<AutomationStatus[]>('/api/automations'),
  automation: (id: string) => request<AutomationStatus>(`/api/automations/${id}`),
  automationRuns: (id: string, limit = 20) =>
    request<AutomationRun[]>(`/api/automations/${id}/runs?limit=${limit}`),
  runAutomation: (id: string) =>
    request<{ runId: number }>(`/api/automations/${id}/run`, { method: 'POST' }),
  patchAutomation: (id: string, patch: { enabled?: boolean; cron?: string | null; settings?: Record<string, unknown> }) =>
    request<AutomationStatus>(`/api/automations/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  // Nutzer
  users: () => request<User[]>('/api/users'),
  createUser: (input: { email: string; name: string; role: 'admin' | 'member'; password: string }) =>
    request<User>('/api/users', { method: 'POST', body: JSON.stringify(input) }),
  patchUser: (id: string, patch: { role?: 'admin' | 'member'; disabled?: boolean; password?: string }) =>
    request<User>(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  // Status
  health: () => request<{ status: string; checks: Record<string, string> }>('/health'),
};

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '–';
  return new Date(iso).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
