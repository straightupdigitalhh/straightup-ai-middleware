import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FeedbackKeyStore, domainAllowed } from '../src/services/feedback-keys.js';

describe('FeedbackKeyStore', () => {
  let storePath: string;
  let store: FeedbackKeyStore;

  beforeEach(() => {
    storePath = join(mkdtempSync(join(tmpdir(), 'fbkeys-')), 'keys.json');
    store = new FeedbackKeyStore(storePath);
  });

  it('erzeugt einen Key mit fbk_-Präfix und allen Feldern', () => {
    const rec = store.create({
      label: 'Kunde XY',
      domains: ['kunde-xy.de'],
      projectId: 'proj-1',
      taskListId: 'list-1',
      type: 'customer',
      defaultAssigneeId: 'user-1',
    });
    expect(rec.key).toMatch(/^fbk_[A-Za-z0-9_-]{32}$/);
    expect(rec.label).toBe('Kunde XY');
    expect(rec.revokedAt).toBeNull();
    expect(rec.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('persistiert auf Platte – neuer Store liest denselben Key', () => {
    const rec = store.create({
      label: 'A', domains: ['a.de'], projectId: 'p', taskListId: 'l', type: 'internal',
    });
    const reloaded = new FeedbackKeyStore(storePath);
    expect(reloaded.findActive(rec.key)?.label).toBe('A');
  });

  it('findActive liefert widerrufene Keys nicht mehr', () => {
    const rec = store.create({
      label: 'A', domains: ['a.de'], projectId: 'p', taskListId: 'l', type: 'internal',
    });
    expect(store.revoke(rec.key)).toBe(true);
    expect(store.findActive(rec.key)).toBeUndefined();
    // list() zeigt ihn weiterhin, mit revokedAt gesetzt (Soft-Delete)
    expect(store.list()[0].revokedAt).not.toBeNull();
  });

  it('revoke auf unbekannten Key liefert false', () => {
    expect(store.revoke('fbk_gibtsnicht')).toBe(false);
  });

  it('defaultAssigneeId ist null wenn nicht angegeben', () => {
    const rec = store.create({
      label: 'A', domains: ['a.de'], projectId: 'p', taskListId: 'l', type: 'internal',
    });
    expect(rec.defaultAssigneeId).toBeNull();
  });
});

describe('domainAllowed', () => {
  const domains = ['kunde-xy.de', 'staging.kunde-xy.de'];

  it('exakter Treffer', () => {
    expect(domainAllowed('kunde-xy.de', domains)).toBe(true);
  });

  it('Subdomain-Treffer', () => {
    expect(domainAllowed('www.kunde-xy.de', domains)).toBe(true);
  });

  it('case-insensitiv', () => {
    expect(domainAllowed('WWW.Kunde-XY.de', domains)).toBe(true);
  });

  it('fremde Domain abgelehnt', () => {
    expect(domainAllowed('anderekunde.de', domains)).toBe(false);
  });

  it('Suffix-Trick abgelehnt (evilkunde-xy.de ist NICHT kunde-xy.de)', () => {
    expect(domainAllowed('evilkunde-xy.de', domains)).toBe(false);
  });

  it('localhost exakt', () => {
    expect(domainAllowed('localhost', ['localhost'])).toBe(true);
  });
});
