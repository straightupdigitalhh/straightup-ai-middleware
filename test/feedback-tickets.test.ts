import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FeedbackKeyStore } from '../src/services/feedback-keys.js';
import { createFeedbackRouter } from '../src/routes/feedback.js';
import { resetRateLimits } from '../src/services/feedback-ticket.js';

const PNG = 'data:image/png;base64,' + Buffer.from('fake-png').toString('base64');

function payload(overrides: Record<string, any> = {}) {
  return {
    description: 'Der Button ist zu klein\nBitte größer machen',
    reporterName: 'Kunde Klaus',
    page: { url: 'https://kunde.de/preise', title: 'Preise' },
    element: { selector: '#cta', rect: { x: 1, y: 2, width: 3, height: 4 } },
    environment: {
      viewport: { width: 1440, height: 900 }, screen: { width: 2560, height: 1440 },
      devicePixelRatio: 2, userAgent: 'UA', timestamp: '2026-07-02T14:00:00.000Z',
    },
    screenshot: PNG,
    ...overrides,
  };
}

function makeStub() {
  return {
    getProject: vi.fn().mockResolvedValue({ id: 'proj-1', name: 'P' }),
    getProjectMembers: vi.fn().mockResolvedValue([
      { id: 'm1', userId: 'u1', firstName: 'Anna', lastName: 'A', isDeactivated: false },
    ]),
    createTask: vi.fn().mockResolvedValue({ id: 'task-77', name: 'x', projectId: 'proj-1' }),
    setTaskAssignees: vi.fn().mockResolvedValue(undefined),
    uploadTaskFile: vi.fn().mockResolvedValue({ id: 'file-1' }),
  };
}

function makeApp(stub: any, keyInput: Record<string, any> = {}) {
  const store = new FeedbackKeyStore(join(mkdtempSync(join(tmpdir(), 'fbtick-')), 'keys.json'));
  const record = store.create({
    label: 'Kunde XY', domains: ['kunde.de'], projectId: 'proj-1',
    taskListId: 'list-1', type: 'customer', defaultAssigneeId: 'u-default',
    ...keyInput,
  } as any);
  const app = express();
  app.use('/feedback', createFeedbackRouter({ store, awork: stub, workspaceUrl: 'https://acme.awork.com' }));
  return { app, record, stub };
}

beforeEach(() => resetRateLimits());

describe('POST /feedback/tickets', () => {
  it('Happy Path customer: Task + Screenshot + Default-Assignee', async () => {
    const { app, record, stub } = makeApp(makeStub());
    const res = await request(app).post('/feedback/tickets')
      .set('X-Feedback-Key', record.key).send(payload());

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      taskId: 'task-77',
      taskUrl: 'https://acme.awork.com/tasks/task-77',
      screenshotAttached: true,
    });
    // Task: Name = erste Zeile, Projekt + Liste aus dem Key, HTML-Beschreibung
    expect(stub.createTask).toHaveBeenCalledWith(
      'Der Button ist zu klein', 'proj-1', 'list-1',
      expect.stringContaining('Kunde Klaus'),
    );
    // Screenshot als Task-Datei
    expect(stub.uploadTaskFile).toHaveBeenCalledWith(
      'task-77', expect.any(Buffer), expect.stringMatching(/^screenshot-.*\.png$/), 'image/png',
    );
    // customer → defaultAssigneeId
    expect(stub.setTaskAssignees).toHaveBeenCalledWith('task-77', ['u-default']);
  });

  it('internal: nimmt assigneeId aus dem Formular, wenn Projektmitglied', async () => {
    const { app, record, stub } = makeApp(makeStub(), { type: 'internal', defaultAssigneeId: null });
    const res = await request(app).post('/feedback/tickets')
      .set('X-Feedback-Key', record.key).send(payload({ assigneeId: 'u1' }));
    expect(res.status).toBe(201);
    expect(stub.setTaskAssignees).toHaveBeenCalledWith('task-77', ['u1']);
  });

  it('internal: 400 wenn assigneeId kein Projektmitglied', async () => {
    const { app, record } = makeApp(makeStub(), { type: 'internal', defaultAssigneeId: null });
    const res = await request(app).post('/feedback/tickets')
      .set('X-Feedback-Key', record.key).send(payload({ assigneeId: 'u-fremd' }));
    expect(res.status).toBe(400);
  });

  it('internal ohne assigneeId: keine Zuweisung', async () => {
    const { app, record, stub } = makeApp(makeStub(), { type: 'internal', defaultAssigneeId: null });
    const res = await request(app).post('/feedback/tickets')
      .set('X-Feedback-Key', record.key).send(payload());
    expect(res.status).toBe(201);
    expect(stub.setTaskAssignees).not.toHaveBeenCalled();
  });

  it('customer: assigneeId aus Payload wird ignoriert, Default gewinnt', async () => {
    const { app, record, stub } = makeApp(makeStub());
    await request(app).post('/feedback/tickets')
      .set('X-Feedback-Key', record.key).send(payload({ assigneeId: 'u1' }));
    expect(stub.setTaskAssignees).toHaveBeenCalledWith('task-77', ['u-default']);
  });

  it('403 bei fremder Domain', async () => {
    const { app, record } = makeApp(makeStub());
    const res = await request(app).post('/feedback/tickets')
      .set('X-Feedback-Key', record.key)
      .send(payload({ page: { url: 'https://fremde-seite.de/x', title: 'x' } }));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('domain_not_allowed');
  });

  it('400 bei leerer Beschreibung', async () => {
    const { app, record } = makeApp(makeStub());
    const res = await request(app).post('/feedback/tickets')
      .set('X-Feedback-Key', record.key).send(payload({ description: '' }));
    expect(res.status).toBe(400);
  });

  it('ohne Screenshot: 201 mit screenshotAttached false, kein Upload', async () => {
    const { app, record, stub } = makeApp(makeStub());
    const res = await request(app).post('/feedback/tickets')
      .set('X-Feedback-Key', record.key).send(payload({ screenshot: null }));
    expect(res.status).toBe(201);
    expect(res.body.screenshotAttached).toBe(false);
    expect(stub.uploadTaskFile).not.toHaveBeenCalled();
  });

  it('Screenshot-Upload schlägt fehl: Task bleibt, screenshotAttached false', async () => {
    const stub = makeStub();
    stub.uploadTaskFile.mockRejectedValue(new Error('upload kaputt'));
    const { app, record } = makeApp(stub);
    const res = await request(app).post('/feedback/tickets')
      .set('X-Feedback-Key', record.key).send(payload());
    expect(res.status).toBe(201);
    expect(res.body.screenshotAttached).toBe(false);
  });

  it('Assignee-Setzen schlägt fehl: trotzdem 201 (Task existiert)', async () => {
    const stub = makeStub();
    stub.setTaskAssignees.mockRejectedValue(new Error('assign kaputt'));
    const { app, record } = makeApp(stub);
    const res = await request(app).post('/feedback/tickets')
      .set('X-Feedback-Key', record.key).send(payload());
    expect(res.status).toBe(201);
  });

  it('502 wenn createTask fehlschlägt', async () => {
    const stub = makeStub();
    stub.createTask.mockRejectedValue(new Error('awork down'));
    const { app, record } = makeApp(stub);
    const res = await request(app).post('/feedback/tickets')
      .set('X-Feedback-Key', record.key).send(payload());
    expect(res.status).toBe(502);
  });

  it('429 nach 60 Tickets', async () => {
    const { app, record } = makeApp(makeStub());
    for (let i = 0; i < 60; i++) {
      await request(app).post('/feedback/tickets')
        .set('X-Feedback-Key', record.key).send(payload());
    }
    const res = await request(app).post('/feedback/tickets')
      .set('X-Feedback-Key', record.key).send(payload());
    expect(res.status).toBe(429);
  });
});
