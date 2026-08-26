import { describe, it, expect, beforeEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../src/core/db.js';
import { UserStore } from '../src/core/users.js';
import { TeamboardEinstellungenStore } from '../src/core/teamboard-einstellungen.js';

describe('DB-Migration v2: awork_user_id + teamboard_einstellungen', () => {
  it('legt Spalte awork_user_id auf users und Tabelle teamboard_einstellungen an', () => {
    const db = openDb(':memory:');

    const columns = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
    expect(columns.some((c) => c.name === 'awork_user_id')).toBe(true);

    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'teamboard_einstellungen'`,
    ).all();
    expect(tables.length).toBe(1);
  });
});

describe('UserStore.setAworkUserId', () => {
  let db: DatabaseSync;
  let users: UserStore;

  beforeEach(() => {
    db = openDb(':memory:');
    users = new UserStore(db);
  });

  const jan = { email: 'jan@straightup-digital.de', name: 'Jan', role: 'admin' as const, password: 'super-sicher-123' };
  const lea = { email: 'lea@straightup-digital.de', name: 'Lea', role: 'member' as const, password: 'auch-sicher-123' };

  it('setzt und liest die awork-ID, null löscht sie wieder', () => {
    const user = users.create(jan);
    expect(user.aworkUserId).toBeNull();

    const updated = users.setAworkUserId(user.id, 'awork-42');
    expect(updated.aworkUserId).toBe('awork-42');
    expect(users.findById(user.id)?.aworkUserId).toBe('awork-42');

    const cleared = users.setAworkUserId(user.id, null);
    expect(cleared.aworkUserId).toBeNull();
    expect(users.findById(user.id)?.aworkUserId).toBeNull();
  });

  it('zwei Nutzer mit derselben awork-ID: der zweite setAworkUserId wirft', () => {
    const a = users.create(jan);
    const b = users.create(lea);
    users.setAworkUserId(a.id, 'awork-doppelt');
    expect(() => users.setAworkUserId(b.id, 'awork-doppelt')).toThrow();
  });
});

describe('TeamboardEinstellungenStore', () => {
  let db: DatabaseSync;
  let users: UserStore;
  let store: TeamboardEinstellungenStore;

  beforeEach(() => {
    db = openDb(':memory:');
    users = new UserStore(db);
    store = new TeamboardEinstellungenStore(db);
  });

  const newUser = () =>
    users.create({ email: 'x@y.de', name: 'X', role: 'member' as const, password: 'geheimgeheim' });

  it('get ohne vorhandene Zeile liefert den Default', () => {
    const user = newUser();
    expect(store.get(user.id)).toEqual({ reihenfolge: null, ausgeblendet: [] });
  });

  it('set → get Roundtrip', () => {
    const user = newUser();
    store.set(user.id, { reihenfolge: ['b', 'a'], ausgeblendet: ['c'] });
    expect(store.get(user.id)).toEqual({ reihenfolge: ['b', 'a'], ausgeblendet: ['c'] });
  });

  it('set überschreibt bestehende Einstellungen (Upsert)', () => {
    const user = newUser();
    store.set(user.id, { reihenfolge: ['a'], ausgeblendet: [] });
    store.set(user.id, { reihenfolge: null, ausgeblendet: ['z'] });
    expect(store.get(user.id)).toEqual({ reihenfolge: null, ausgeblendet: ['z'] });
  });
});
