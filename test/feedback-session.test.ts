import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FeedbackKeyStore } from '../src/services/feedback-keys.js';
import { createFeedbackRouter } from '../src/routes/feedback.js';

function makeApp(aworkStub: any, keyInput?: Partial<Parameters<FeedbackKeyStore['create']>[0]>) {
  const store = new FeedbackKeyStore(join(mkdtempSync(join(tmpdir(), 'fbsess-')), 'keys.json'));
  const record = store.create({
    label: 'Kunde XY', domains: ['kunde.de'], projectId: 'proj-1',
    taskListId: 'list-1', type: 'internal',
    ...keyInput,
  } as any);
  const app = express();
  app.use('/feedback', createFeedbackRouter({ store, awork: aworkStub, workspaceUrl: 'https://acme.awork.com' }));
  return { app, record };
}

const aworkStub = () => ({
  getProject: vi.fn().mockResolvedValue({ id: 'proj-1', name: 'Website Relaunch' }),
  getProjectMembers: vi.fn().mockResolvedValue([
    { id: 'm1', userId: 'u1', firstName: 'Anna', lastName: 'Agentur', isDeactivated: false },
    { id: 'm2', userId: 'u2', firstName: 'Ex', lastName: 'Kollege', isDeactivated: true },
    { id: 'm3', userId: 'u3', firstName: null, lastName: null, isDeactivated: false },
  ]),
});

describe('GET /feedback/session', () => {
  it('401 ohne Key', async () => {
    const { app } = makeApp(aworkStub());
    const res = await request(app).get('/feedback/session');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_key');
  });

  it('401 mit unbekanntem Key', async () => {
    const { app } = makeApp(aworkStub());
    const res = await request(app).get('/feedback/session').set('X-Feedback-Key', 'fbk_falsch');
    expect(res.status).toBe(401);
  });

  it('internal: liefert Projektname und aktive Members (deaktivierte gefiltert)', async () => {
    const stub = aworkStub();
    const { app, record } = makeApp(stub);
    const res = await request(app).get('/feedback/session').set('X-Feedback-Key', record.key);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      label: 'Kunde XY',
      projectName: 'Website Relaunch',
      type: 'internal',
      members: [
        { id: 'u1', name: 'Anna Agentur' },
        { id: 'u3', name: 'Unbenannt' },
      ],
    });
  });

  it('customer: keine members im Response', async () => {
    const stub = aworkStub();
    const { app, record } = makeApp(stub, { type: 'customer', defaultAssigneeId: 'u1' });
    const res = await request(app).get('/feedback/session').set('X-Feedback-Key', record.key);
    expect(res.status).toBe(200);
    expect(res.body.members).toBeUndefined();
    expect(stub.getProjectMembers).not.toHaveBeenCalled();
  });

  it('setzt CORS-Header, OPTIONS antwortet 204', async () => {
    const { app, record } = makeApp(aworkStub());
    const res = await request(app).get('/feedback/session').set('X-Feedback-Key', record.key);
    expect(res.headers['access-control-allow-origin']).toBe('*');

    const preflight = await request(app).options('/feedback/session');
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-headers']).toContain('X-Feedback-Key');
  });

  it('502 wenn awork nicht antwortet', async () => {
    const stub = { getProject: vi.fn().mockRejectedValue(new Error('down')), getProjectMembers: vi.fn() };
    const { app, record } = makeApp(stub);
    const res = await request(app).get('/feedback/session').set('X-Feedback-Key', record.key);
    expect(res.status).toBe(502);
  });
});
