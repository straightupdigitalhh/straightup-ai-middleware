import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FeedbackKeyStore } from '../src/services/feedback-keys.js';
import { createFeedbackAdminRouter } from '../src/routes/feedback-admin.js';

function makeApp(aworkStub: any) {
  const store = new FeedbackKeyStore(join(mkdtempSync(join(tmpdir(), 'fbadmin-')), 'keys.json'));
  const app = express();
  app.use(express.json());
  app.use(createFeedbackAdminRouter({ store, awork: aworkStub }));
  return { app, store };
}

const validBody = {
  projectId: 'proj-1',
  domains: ['kunde.de'],
  type: 'customer',
  defaultAssigneeId: 'user-1',
  label: 'Kunde XY',
};

describe('POST /api/feedback-keys', () => {
  it('nutzt existierende Website-Feedback-Liste', async () => {
    const awork = {
      getTaskLists: vi.fn().mockResolvedValue([{ id: 'list-9', name: 'Website-Feedback' }]),
      createTaskList: vi.fn(),
      getProjects: vi.fn(),
      getProjectMembers: vi.fn(),
    };
    const { app } = makeApp(awork);
    const res = await request(app).post('/api/feedback-keys').send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.key).toMatch(/^fbk_/);
    expect(res.body.taskListId).toBe('list-9');
    expect(awork.createTaskList).not.toHaveBeenCalled();
  });

  it('legt Website-Feedback-Liste an, wenn sie fehlt', async () => {
    const awork = {
      getTaskLists: vi.fn().mockResolvedValue([{ id: 'l1', name: 'Sprint 1' }]),
      createTaskList: vi.fn().mockResolvedValue({ id: 'list-neu', name: 'Website-Feedback' }),
      getProjects: vi.fn(),
      getProjectMembers: vi.fn(),
    };
    const { app } = makeApp(awork);
    const res = await request(app).post('/api/feedback-keys').send(validBody);
    expect(res.status).toBe(201);
    expect(awork.createTaskList).toHaveBeenCalledWith('proj-1', 'Website-Feedback');
    expect(res.body.taskListId).toBe('list-neu');
  });

  it('400 bei fehlender projectId', async () => {
    const { app } = makeApp({ getTaskLists: vi.fn(), createTaskList: vi.fn(), getProjects: vi.fn(), getProjectMembers: vi.fn() });
    const res = await request(app).post('/api/feedback-keys').send({ ...validBody, projectId: undefined });
    expect(res.status).toBe(400);
  });

  it('400 bei leeren domains', async () => {
    const { app } = makeApp({ getTaskLists: vi.fn(), createTaskList: vi.fn(), getProjects: vi.fn(), getProjectMembers: vi.fn() });
    const res = await request(app).post('/api/feedback-keys').send({ ...validBody, domains: [] });
    expect(res.status).toBe(400);
  });

  it('400 bei type customer ohne defaultAssigneeId', async () => {
    const { app } = makeApp({ getTaskLists: vi.fn(), createTaskList: vi.fn(), getProjects: vi.fn(), getProjectMembers: vi.fn() });
    const res = await request(app).post('/api/feedback-keys').send({ ...validBody, defaultAssigneeId: undefined });
    expect(res.status).toBe(400);
  });

  it('502 wenn awork nicht erreichbar', async () => {
    const awork = { getTaskLists: vi.fn().mockRejectedValue(new Error('down')), createTaskList: vi.fn(), getProjects: vi.fn(), getProjectMembers: vi.fn() };
    const { app } = makeApp(awork);
    const res = await request(app).post('/api/feedback-keys').send(validBody);
    expect(res.status).toBe(502);
  });
});

describe('GET + DELETE /api/feedback-keys', () => {
  it('listet Keys und widerruft per DELETE', async () => {
    const awork = { getTaskLists: vi.fn().mockResolvedValue([{ id: 'l', name: 'Website-Feedback' }]), createTaskList: vi.fn(), getProjects: vi.fn(), getProjectMembers: vi.fn() };
    const { app } = makeApp(awork);
    const created = await request(app).post('/api/feedback-keys').send(validBody);

    const list = await request(app).get('/api/feedback-keys');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const del = await request(app).delete(`/api/feedback-keys/${created.body.key}`);
    expect(del.status).toBe(204);

    const delAgain = await request(app).delete(`/api/feedback-keys/${created.body.key}`);
    expect(delAgain.status).toBe(404);
  });
});

describe('GET /api/feedback-keys/projects', () => {
  it('gibt Projekte sortiert nach Name als {id,name}[] zurück', async () => {
    const awork = {
      getTaskLists: vi.fn(),
      createTaskList: vi.fn(),
      getProjects: vi.fn().mockResolvedValue([
        { id: 'p-2', name: 'Zeta-Projekt', companyId: 'c-1' },
        { id: 'p-1', name: 'Alpha-Projekt', companyId: 'c-2' },
        { id: 'p-3', name: 'Mitte-Projekt' },
      ]),
      getProjectMembers: vi.fn(),
    };
    const { app } = makeApp(awork);
    const res = await request(app).get('/api/feedback-keys/projects');

    expect(res.status).toBe(200);
    expect(awork.getProjects).toHaveBeenCalled();
    expect(res.body).toEqual([
      { id: 'p-1', name: 'Alpha-Projekt' },
      { id: 'p-3', name: 'Mitte-Projekt' },
      { id: 'p-2', name: 'Zeta-Projekt' },
    ]);
  });

  it('502 wenn awork nicht erreichbar', async () => {
    const awork = {
      getTaskLists: vi.fn(),
      createTaskList: vi.fn(),
      getProjects: vi.fn().mockRejectedValue(new Error('awork down')),
      getProjectMembers: vi.fn(),
    };
    const { app } = makeApp(awork);
    const res = await request(app).get('/api/feedback-keys/projects');

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'awork_unreachable', message: 'awork down' });
  });
});

describe('GET /api/feedback-keys/project-members/:projectId', () => {
  it('filtert deaktivierte Mitglieder heraus, behält aktive, mappt userId auf id', async () => {
    const awork = {
      getTaskLists: vi.fn(),
      createTaskList: vi.fn(),
      getProjects: vi.fn(),
      getProjectMembers: vi.fn().mockResolvedValue([
        { id: 'm-1', userId: 'user-1', firstName: 'Anna', lastName: 'Muster', isDeactivated: false },
        { id: 'm-2', userId: 'user-2', firstName: 'Bruno', lastName: 'Weg', isDeactivated: true },
      ]),
    };
    const { app } = makeApp(awork);
    const res = await request(app).get('/api/feedback-keys/project-members/proj-1');

    expect(res.status).toBe(200);
    expect(awork.getProjectMembers).toHaveBeenCalledWith('proj-1');
    expect(res.body).toEqual([{ id: 'user-1', name: 'Anna Muster' }]);
  });

  it('verbindet firstName + lastName mit Leerzeichen', async () => {
    const awork = {
      getTaskLists: vi.fn(),
      createTaskList: vi.fn(),
      getProjects: vi.fn(),
      getProjectMembers: vi.fn().mockResolvedValue([
        { id: 'm-1', userId: 'user-1', firstName: 'Anna', lastName: 'Muster' },
      ]),
    };
    const { app } = makeApp(awork);
    const res = await request(app).get('/api/feedback-keys/project-members/proj-1');

    expect(res.body).toEqual([{ id: 'user-1', name: 'Anna Muster' }]);
  });

  it('fällt auf "Unbenannt" zurück, wenn firstName und lastName leer/null sind', async () => {
    const awork = {
      getTaskLists: vi.fn(),
      createTaskList: vi.fn(),
      getProjects: vi.fn(),
      getProjectMembers: vi.fn().mockResolvedValue([
        { id: 'm-1', userId: 'user-1', firstName: null, lastName: null },
      ]),
    };
    const { app } = makeApp(awork);
    const res = await request(app).get('/api/feedback-keys/project-members/proj-1');

    expect(res.body).toEqual([{ id: 'user-1', name: 'Unbenannt' }]);
  });

  it('502 wenn awork nicht erreichbar', async () => {
    const awork = {
      getTaskLists: vi.fn(),
      createTaskList: vi.fn(),
      getProjects: vi.fn(),
      getProjectMembers: vi.fn().mockRejectedValue(new Error('awork down')),
    };
    const { app } = makeApp(awork);
    const res = await request(app).get('/api/feedback-keys/project-members/proj-1');

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'awork_unreachable', message: 'awork down' });
  });
});

// ─── Admin-Seite: ausgeliefertes Inline-Script muss gültiges JS sein ──
// Regression: ein \n statt \\n im Template-Literal zerbrach das Regex-Literal
// im Browser (SyntaxError → komplette Seite funktionslos), während alle
// Server-Tests grün blieben. Dieser Test parst das Script wie ein Browser.
describe('GET /feedback-admin (UI)', () => {
  it('liefert HTML, dessen Inline-Script syntaktisch gültig ist', async () => {
    const { default: uiRouter } = await import('../src/routes/feedback-admin-ui.js');
    const app = express();
    app.use(uiRouter);

    const res = await request(app).get('/feedback-admin');
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/html/);

    const match = res.text.match(/<script>([\s\S]*?)<\/script>/);
    expect(match).not.toBeNull();
    // wirft bei Syntaxfehler → Test schlägt fehl
    expect(() => new Function(match![1])).not.toThrow();
    // das Domain-Split-Regex muss als \n-Escape ankommen, nicht als echte Newline
    expect(match![1]).toContain('split(/[,\\n]/)');
    // Branding: Favicon + Header-Logo als eingebettete Data-URI
    expect(res.text).toContain('data:image/svg+xml;base64,');
    expect(res.text).toContain('alt="BugBee"');
  });
});
