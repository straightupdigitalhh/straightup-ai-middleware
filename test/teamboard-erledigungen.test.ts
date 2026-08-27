import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../src/core/db.js';
import { UserStore } from '../src/core/users.js';
import {
  TeamboardErledigungenStore,
  UNDO_FENSTER_MS,
  MAX_KOMMENTAR_FEHLVERSUCHE,
} from '../src/core/teamboard-erledigungen.js';

describe('DB-Migration v3: teamboard_erledigungen', () => {
  it('legt die Tabelle mit allen Spalten an', () => {
    const db = openDb(':memory:');
    const columns = db.prepare('PRAGMA table_info(teamboard_erledigungen)').all() as { name: string }[];
    const namen = columns.map((c) => c.name);
    expect(namen).toEqual([
      'id',
      'task_id',
      'task_name',
      'project_id',
      'alter_status_id',
      'user_id',
      'awork_user_id',
      'erledigt_am',
      'rueckgaengig_am',
      'kommentar_am',
      'fehlversuche',
    ]);
  });
});

describe('TeamboardErledigungenStore', () => {
  let db: DatabaseSync;
  let users: UserStore;
  let store: TeamboardErledigungenStore;

  beforeEach(() => {
    db = openDb(':memory:');
    users = new UserStore(db);
    store = new TeamboardErledigungenStore(db);
  });

  const newUser = (email = 'x@y.de') =>
    users.create({ email, name: 'X', role: 'member' as const, password: 'geheimgeheim' });

  const anlegen = (userId: string, aworkUserId: string, opts?: { taskId?: string; jetzt?: Date }) =>
    store.anlegen({
      taskId: opts?.taskId ?? 'task-1',
      taskName: 'Testaufgabe',
      projectId: 'project-1',
      alterStatusId: 'status-in-arbeit',
      userId,
      aworkUserId,
      jetzt: opts?.jetzt,
    });

  it('anlegen liefert den Vorgang mit id, erledigtAm gesetzt, rueckgaengigAm/kommentarAm null, fehlversuche 0', () => {
    const user = newUser();
    const e = anlegen(user.id, 'awork-1');
    expect(e.id).toBeTypeOf('number');
    expect(e.taskId).toBe('task-1');
    expect(e.taskName).toBe('Testaufgabe');
    expect(e.projectId).toBe('project-1');
    expect(e.alterStatusId).toBe('status-in-arbeit');
    expect(e.userId).toBe(user.id);
    expect(e.aworkUserId).toBe('awork-1');
    expect(e.erledigtAm).toBeTypeOf('string');
    expect(e.rueckgaengigAm).toBeNull();
    expect(e.kommentarAm).toBeNull();
    expect(e.fehlversuche).toBe(0);
  });

  it('finde liefert den Vorgang zurück, unbekannte id liefert undefined', () => {
    const user = newUser();
    const e = anlegen(user.id, 'awork-1');
    expect(store.finde(e.id)).toEqual(e);
    expect(store.finde(999999)).toBeUndefined();
  });

  it('markiereRueckgaengig setzt den Zeitstempel', () => {
    const user = newUser();
    const e = anlegen(user.id, 'awork-1');
    expect(store.finde(e.id)?.rueckgaengigAm).toBeNull();
    const jetzt = new Date('2026-08-27T10:00:00.000Z');
    store.markiereRueckgaengig(e.id, jetzt);
    expect(store.finde(e.id)?.rueckgaengigAm).toBe(jetzt.toISOString());
  });

  describe('offeneKommentare', () => {
    it('Vorgang von vor 5s ist nicht dabei, von vor 30s ist dabei', () => {
      const user = newUser();
      const jetzt = new Date('2026-08-27T10:00:30.000Z');
      const vor5s = new Date('2026-08-27T10:00:25.000Z');
      const vor30s = new Date('2026-08-27T10:00:00.000Z');
      const frisch = anlegen(user.id, 'awork-1', { taskId: 'task-frisch', jetzt: vor5s });
      const alt = anlegen(user.id, 'awork-1', { taskId: 'task-alt', jetzt: vor30s });

      const offen = store.offeneKommentare(UNDO_FENSTER_MS, MAX_KOMMENTAR_FEHLVERSUCHE, jetzt);
      const ids = offen.map((o) => o.id);
      expect(ids).not.toContain(frisch.id);
      expect(ids).toContain(alt.id);
    });

    it('widerrufener Vorgang ist nie dabei', () => {
      const user = newUser();
      const vor30s = new Date(Date.now() - 30_000);
      const e = anlegen(user.id, 'awork-1', { jetzt: vor30s });
      store.markiereRueckgaengig(e.id);
      const offen = store.offeneKommentare(UNDO_FENSTER_MS, MAX_KOMMENTAR_FEHLVERSUCHE);
      expect(offen.map((o) => o.id)).not.toContain(e.id);
    });

    it('bereits kommentierter Vorgang ist nie dabei', () => {
      const user = newUser();
      const vor30s = new Date(Date.now() - 30_000);
      const e = anlegen(user.id, 'awork-1', { jetzt: vor30s });
      store.markiereKommentiert(e.id);
      const offen = store.offeneKommentare(UNDO_FENSTER_MS, MAX_KOMMENTAR_FEHLVERSUCHE);
      expect(offen.map((o) => o.id)).not.toContain(e.id);
    });

    it('Vorgang mit 5 Fehlversuchen ist nie dabei', () => {
      const user = newUser();
      const vor30s = new Date(Date.now() - 30_000);
      const e = anlegen(user.id, 'awork-1', { jetzt: vor30s });
      for (let i = 0; i < MAX_KOMMENTAR_FEHLVERSUCHE; i++) store.zaehleFehlversuch(e.id);
      const offen = store.offeneKommentare(UNDO_FENSTER_MS, MAX_KOMMENTAR_FEHLVERSUCHE);
      expect(offen.map((o) => o.id)).not.toContain(e.id);
    });
  });

  it('markiereKommentiert und zaehleFehlversuch wirken', () => {
    const user = newUser();
    const vor30s = new Date(Date.now() - 30_000);

    const kommentiert = anlegen(user.id, 'awork-1', { taskId: 'task-kommentiert', jetzt: vor30s });
    store.markiereKommentiert(kommentiert.id);
    expect(store.finde(kommentiert.id)?.kommentarAm).toBeTypeOf('string');
    expect(store.offeneKommentare(UNDO_FENSTER_MS, MAX_KOMMENTAR_FEHLVERSUCHE).map((o) => o.id)).not.toContain(
      kommentiert.id,
    );

    const fehlgeschlagen = anlegen(user.id, 'awork-1', { taskId: 'task-fehlgeschlagen', jetzt: vor30s });
    for (let i = 0; i < MAX_KOMMENTAR_FEHLVERSUCHE - 1; i++) store.zaehleFehlversuch(fehlgeschlagen.id);
    expect(store.finde(fehlgeschlagen.id)?.fehlversuche).toBe(MAX_KOMMENTAR_FEHLVERSUCHE - 1);
    expect(
      store.offeneKommentare(UNDO_FENSTER_MS, MAX_KOMMENTAR_FEHLVERSUCHE).map((o) => o.id),
    ).toContain(fehlgeschlagen.id);
    store.zaehleFehlversuch(fehlgeschlagen.id);
    expect(store.finde(fehlgeschlagen.id)?.fehlversuche).toBe(MAX_KOMMENTAR_FEHLVERSUCHE);
    expect(
      store.offeneKommentare(UNDO_FENSTER_MS, MAX_KOMMENTAR_FEHLVERSUCHE).map((o) => o.id),
    ).not.toContain(fehlgeschlagen.id);
  });

  it('markiereKommentiert lässt einen widerrufenen Vorgang unberührt — das Rennen aus I1 darf nicht als "kommentiert" enden', () => {
    const user = newUser();
    const vor30s = new Date(Date.now() - 30_000);
    const e = anlegen(user.id, 'awork-1', { jetzt: vor30s });
    // Genau die Reihenfolge des Rennens: der Undo-Pfad markiert, während der
    // Kommentarlauf denselben Vorgang schon in der Hand hat.
    store.markiereRueckgaengig(e.id);

    store.markiereKommentiert(e.id);

    expect(store.finde(e.id)?.kommentarAm).toBeNull();
    expect(store.finde(e.id)?.rueckgaengigAm).toBeTypeOf('string');
  });

  describe('findeOffenenVorgang', () => {
    it('frisch angelegter Vorgang wird gefunden', () => {
      const user = newUser();
      const e = anlegen(user.id, 'awork-1', { taskId: 'task-x' });
      expect(store.findeOffenenVorgang('task-x', MAX_KOMMENTAR_FEHLVERSUCHE)?.id).toBe(e.id);
    });

    it('widerrufener Vorgang wird nicht gefunden', () => {
      const user = newUser();
      const e = anlegen(user.id, 'awork-1', { taskId: 'task-x' });
      store.markiereRueckgaengig(e.id);
      expect(store.findeOffenenVorgang('task-x', MAX_KOMMENTAR_FEHLVERSUCHE)).toBeUndefined();
    });

    it('kommentierter Vorgang wird nicht gefunden', () => {
      const user = newUser();
      const e = anlegen(user.id, 'awork-1', { taskId: 'task-x' });
      store.markiereKommentiert(e.id);
      expect(store.findeOffenenVorgang('task-x', MAX_KOMMENTAR_FEHLVERSUCHE)).toBeUndefined();
    });

    it('Vorgang mit MAX_KOMMENTAR_FEHLVERSUCHE Fehlversuchen wird nicht gefunden', () => {
      const user = newUser();
      const e = anlegen(user.id, 'awork-1', { taskId: 'task-x' });
      for (let i = 0; i < MAX_KOMMENTAR_FEHLVERSUCHE; i++) store.zaehleFehlversuch(e.id);
      expect(store.findeOffenenVorgang('task-x', MAX_KOMMENTAR_FEHLVERSUCHE)).toBeUndefined();
    });

    it('eine andere taskId wird nicht gefunden', () => {
      const user = newUser();
      anlegen(user.id, 'awork-1', { taskId: 'task-x' });
      expect(store.findeOffenenVorgang('task-y', MAX_KOMMENTAR_FEHLVERSUCHE)).toBeUndefined();
    });
  });

  it('zaehleFehlversuch loggt beim Erreichen von MAX_KOMMENTAR_FEHLVERSUCHE per console.error mit id und taskId', () => {
    const user = newUser();
    const e = anlegen(user.id, 'awork-1', { taskId: 'task-final' });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    for (let i = 0; i < MAX_KOMMENTAR_FEHLVERSUCHE - 1; i++) store.zaehleFehlversuch(e.id);
    expect(spy).not.toHaveBeenCalled();

    store.zaehleFehlversuch(e.id);
    expect(spy).toHaveBeenCalledTimes(1);
    const [meldung] = spy.mock.calls[0];
    expect(String(meldung)).toContain(String(e.id));
    expect(String(meldung)).toContain('task-final');

    spy.mockRestore();
  });
});
