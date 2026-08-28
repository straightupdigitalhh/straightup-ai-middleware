import { describe, it, expect, beforeEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../src/core/db.js';
import { UserStore } from '../src/core/users.js';
import { TeamboardEinstellungenStore, LEERER_FILTER } from '../src/core/teamboard-einstellungen.js';

describe('DB-Migration v4: Spalte filter auf teamboard_einstellungen', () => {
  it('legt die Spalte filter an', () => {
    const db = openDb(':memory:');
    const columns = db.prepare('PRAGMA table_info(teamboard_einstellungen)').all() as { name: string }[];
    expect(columns.some((c) => c.name === 'filter')).toBe(true);
  });
});

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

  const gesetzterFilter = {
    projektArten: ['Website-Support'],
    projekt: 'proj-1',
    faelligkeit: ['heute'],
    status: ['progress'],
    arbeitsarten: ['Projektarbeit'],
    nurPrio: true,
    nurLaufendeProjekte: true,
  };

  it('get ohne vorhandene Zeile liefert den Default', () => {
    const user = newUser();
    expect(store.get(user.id)).toEqual({ reihenfolge: null, ausgeblendet: [], filter: LEERER_FILTER });
  });

  it('set → get Roundtrip', () => {
    const user = newUser();
    store.set(user.id, { reihenfolge: ['b', 'a'], ausgeblendet: ['c'], filter: gesetzterFilter });
    expect(store.get(user.id)).toEqual({
      reihenfolge: ['b', 'a'],
      ausgeblendet: ['c'],
      filter: gesetzterFilter,
    });
  });

  it('set überschreibt bestehende Einstellungen (Upsert)', () => {
    const user = newUser();
    store.set(user.id, { reihenfolge: ['a'], ausgeblendet: [], filter: gesetzterFilter });
    store.set(user.id, { reihenfolge: null, ausgeblendet: ['z'], filter: LEERER_FILTER });
    expect(store.get(user.id)).toEqual({ reihenfolge: null, ausgeblendet: ['z'], filter: LEERER_FILTER });
  });

  it('LEERER_FILTER liefert bei jedem Zugriff frische Listen (kein geteiltes Array zwischen Nutzern)', () => {
    const a = newUser();
    const gelesen = store.get(a.id);
    gelesen.filter.projektArten.push('versehentlich mutiert');
    const b = users.create({ email: 'b@y.de', name: 'B', role: 'member', password: 'geheimgeheim' });
    expect(store.get(b.id).filter.projektArten).toEqual([]);
  });

  // ── Abwärtskompatibilität: Zeilen aus der Zeit vor dem filter-Feld ──

  it('liest eine vor der Filterleiste geschriebene Zeile (filter NULL) mit leerem Filter, Reihenfolge und Ausgeblendet unverändert', () => {
    const user = newUser();
    // Genau das, was der alte Store geschrieben hat: die drei alten Spalten,
    // filter gar nicht erst gesetzt.
    db.prepare(
      `INSERT INTO teamboard_einstellungen (user_id, reihenfolge, ausgeblendet, updated_at)
       VALUES (?, ?, ?, ?)`,
    ).run(user.id, JSON.stringify(['u-1', 'u-2']), JSON.stringify(['u-3']), '2026-08-01T00:00:00.000Z');

    expect(store.get(user.id)).toEqual({
      reihenfolge: ['u-1', 'u-2'],
      ausgeblendet: ['u-3'],
      filter: LEERER_FILTER,
    });
  });

  it('fällt bei kaputtem filter-JSON auf den leeren Filter zurück, ohne die übrigen Felder zu verlieren', () => {
    const user = newUser();
    db.prepare(
      `INSERT INTO teamboard_einstellungen (user_id, reihenfolge, ausgeblendet, filter, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(user.id, null, JSON.stringify(['u-3']), '{kein json', '2026-08-01T00:00:00.000Z');

    expect(store.get(user.id)).toEqual({ reihenfolge: null, ausgeblendet: ['u-3'], filter: LEERER_FILTER });
  });

  it('ergänzt einzelne fehlende Felder im gespeicherten Filter aus dem Default (Feld später dazugekommen)', () => {
    const user = newUser();
    db.prepare(
      `INSERT INTO teamboard_einstellungen (user_id, reihenfolge, ausgeblendet, filter, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(user.id, null, '[]', JSON.stringify({ nurPrio: true }), '2026-08-01T00:00:00.000Z');

    expect(store.get(user.id).filter).toEqual({ ...LEERER_FILTER, nurPrio: true });
  });
});
