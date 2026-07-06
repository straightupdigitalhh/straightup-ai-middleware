import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createTimetrackingRouter } from '../src/routes/timetracking.js';

function makeApp(aworkStub: any, role: 'admin' | 'member' = 'admin') {
  const app = express();
  app.use((_req, res, next) => {
    res.locals.auth = { via: 'session', role, user: { email: 'jan@…' } };
    next();
  });
  app.use(createTimetrackingRouter({ awork: aworkStub }));
  return app;
}

const users = [
  { id: 'u-2', firstName: 'Bea', lastName: 'Zorn', userContactInfos: [{ type: 'email', subType: 'work', value: 'bea@x.de' }] },
  { id: 'u-1', firstName: 'Ada', lastName: 'Anker', userContactInfos: [] },
  { id: 'u-3', firstName: 'Cid', lastName: 'Weg', isDeactivated: true, userContactInfos: [] },
  { id: 'u-4', firstName: 'Dan', lastName: 'Alt', isArchived: true, userContactInfos: [] },
];

describe('GET /api/timetracking/users', () => {
  it('liefert aktive Nutzer sortiert mit aufgelöster E-Mail (null wenn keine)', async () => {
    const awork = { getUsers: vi.fn().mockResolvedValue(users) };
    const res = await request(makeApp(awork)).get('/api/timetracking/users');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 'u-1', name: 'Ada Anker', email: null },
      { id: 'u-2', name: 'Bea Zorn', email: 'bea@x.de' },
    ]);
  });

  it('403 für Nicht-Admins', async () => {
    const awork = { getUsers: vi.fn() };
    const res = await request(makeApp(awork, 'member')).get('/api/timetracking/users');
    expect(res.status).toBe(403);
    expect(awork.getUsers).not.toHaveBeenCalled();
  });

  it('502 wenn awork nicht erreichbar', async () => {
    const awork = { getUsers: vi.fn().mockRejectedValue(new Error('down')) };
    const res = await request(makeApp(awork)).get('/api/timetracking/users');
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'awork_unreachable', message: 'awork antwortet nicht' });
  });
});
