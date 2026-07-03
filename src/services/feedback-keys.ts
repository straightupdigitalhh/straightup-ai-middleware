import { randomBytes } from 'crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// ─── Types ───────────────────────────────────────────────────────

export interface FeedbackKeyRecord {
  key: string;
  label: string;
  domains: string[];
  projectId: string;
  taskListId: string;
  type: 'internal' | 'customer';
  defaultAssigneeId: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface FeedbackKeyInput {
  label: string;
  domains: string[];
  projectId: string;
  taskListId: string;
  type: 'internal' | 'customer';
  defaultAssigneeId?: string | null;
}

// ─── Domain-Prüfung ──────────────────────────────────────────────

/**
 * Erlaubt exakten Hostname-Treffer oder Subdomains eines Eintrags.
 * "www.kunde.de" passt zu "kunde.de", "evilkunde.de" NICHT.
 */
export function domainAllowed(hostname: string, domains: string[]): boolean {
  const host = hostname.toLowerCase();
  return domains.some(d => {
    const dom = d.toLowerCase();
    return host === dom || host.endsWith('.' + dom);
  });
}

// ─── Store ───────────────────────────────────────────────────────

/**
 * JSON-Datei-Store für Feedback-Keys. Bewusst simpel:
 * synchrones Lesen/Schreiben, atomares Ersetzen via tmp+rename.
 */
export class FeedbackKeyStore {
  private filePath: string;
  private records: FeedbackKeyRecord[];

  constructor(filePath: string) {
    this.filePath = filePath;
    this.records = this.load();
  }

  private load(): FeedbackKeyRecord[] {
    try {
      return JSON.parse(readFileSync(this.filePath, 'utf-8'));
    } catch {
      return []; // Datei existiert noch nicht
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.records, null, 2), 'utf-8');
    renameSync(tmp, this.filePath);
  }

  create(input: FeedbackKeyInput): FeedbackKeyRecord {
    const record: FeedbackKeyRecord = {
      key: `fbk_${randomBytes(24).toString('base64url')}`,
      label: input.label,
      domains: input.domains,
      projectId: input.projectId,
      taskListId: input.taskListId,
      type: input.type,
      defaultAssigneeId: input.defaultAssigneeId ?? null,
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };
    this.records.push(record);
    this.persist();
    return record;
  }

  list(): FeedbackKeyRecord[] {
    return [...this.records];
  }

  findActive(key: string): FeedbackKeyRecord | undefined {
    return this.records.find(r => r.key === key && r.revokedAt === null);
  }

  revoke(key: string): boolean {
    const record = this.records.find(r => r.key === key && r.revokedAt === null);
    if (!record) return false;
    record.revokedAt = new Date().toISOString();
    this.persist();
    return true;
  }
}
