import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/core/db.js';
import { hashPassword, verifyPassword } from '../src/core/password.js';
import { UserStore } from '../src/core/users.js';
import { SessionStore } from '../src/core/sessions.js';

describe('password (scrypt)', () => {
  it('Hash + Verify Roundtrip', () => {
    const hash = hashPassword('mein-geheimes-passwort');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword('mein-geheimes-passwort', hash)).toBe(true);
    expect(verifyPassword('falsches-passwort', hash)).toBe(false);
  });

  it('gleiches Passwort → unterschiedliche Hashes (Salt)', () => {
    expect(hashPassword('abc')).not.toBe(hashPassword('abc'));
  });

  it('kaputtes Hash-Format → false statt Exception', () => {
    expect(verifyPassword('x', 'nicht-scrypt')).toBe(false);
    expect(verifyPassword('x', '')).toBe(false);
  });
});

describe('UserStore + SessionStore', () => {
  let users: UserStore;
  let sessions: SessionStore;

  beforeEach(() => {
    const db = openDb(':memory:');
    users = new UserStore(db);
    sessions = new SessionStore(db, users);
  });

  const jan = { email: 'jan@straightup-digital.de', name: 'Jan', role: 'admin' as const, password: 'super-sicher-123' };

  it('create + verifyCredentials', () => {
    const user = users.create(jan);
    expect(user.id).toBeTruthy();
    expect(users.count()).toBe(1);
    expect(users.verifyCredentials(jan.email, jan.password)?.id).toBe(user.id);
    expect(users.verifyCredentials(jan.email, 'falsch')).toBeUndefined();
    expect(users.verifyCredentials('gibtsnicht@x.de', jan.password)).toBeUndefined();
  });

  it('E-Mail ist case-insensitiv eindeutig', () => {
    users.create(jan);
    expect(() => users.create({ ...jan, email: 'JAN@straightup-digital.de' })).toThrow();
    expect(users.findByEmail('JAN@STRAIGHTUP-DIGITAL.DE')?.email).toBe(jan.email);
  });

  it('deaktivierter Nutzer kann sich nicht anmelden, Session wird ungültig', () => {
    const user = users.create(jan);
    const { token } = sessions.create(user.id);
    expect(sessions.resolve(token)?.id).toBe(user.id);

    users.disable(user.id);
    expect(users.verifyCredentials(jan.email, jan.password)).toBeUndefined();
    expect(sessions.resolve(token)).toBeUndefined();

    users.enable(user.id);
    expect(users.verifyCredentials(jan.email, jan.password)?.id).toBe(user.id);
  });

  it('Session: resolve, delete, deleteForUser', () => {
    const user = users.create(jan);
    const a = sessions.create(user.id);
    const b = sessions.create(user.id);
    expect(sessions.resolve(a.token)?.id).toBe(user.id);

    sessions.delete(a.token);
    expect(sessions.resolve(a.token)).toBeUndefined();
    expect(sessions.resolve(b.token)?.id).toBe(user.id);

    sessions.deleteForUser(user.id);
    expect(sessions.resolve(b.token)).toBeUndefined();
  });

  it('abgelaufene Session wird abgelehnt und aufgeräumt', () => {
    const db = openDb(':memory:');
    const u = new UserStore(db);
    const s = new SessionStore(db, u);
    const user = u.create(jan);
    const { token } = s.create(user.id);
    // Ablaufdatum in die Vergangenheit setzen
    db.prepare('UPDATE sessions SET expires_at = ?').run(new Date(Date.now() - 1000).toISOString());
    expect(s.resolve(token)).toBeUndefined();
    const remaining = db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number };
    expect(remaining.n).toBe(0);
  });

  it('setPassword ändert das Passwort', () => {
    const user = users.create(jan);
    users.setPassword(user.id, 'neues-passwort-456');
    expect(users.verifyCredentials(jan.email, jan.password)).toBeUndefined();
    expect(users.verifyCredentials(jan.email, 'neues-passwort-456')?.id).toBe(user.id);
  });

  it('User-Objekte enthalten keinen Passwort-Hash', () => {
    const user = users.create(jan);
    expect(JSON.stringify(user)).not.toContain('scrypt');
    expect(JSON.stringify(users.list())).not.toContain('password');
  });
});
