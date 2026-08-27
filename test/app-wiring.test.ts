import { describe, it, expect } from 'vitest';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import request from 'supertest';
import { createFeedbackRouter } from '../src/routes/feedback.js';
import { FeedbackKeyStore } from '../src/services/feedback-keys.js';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Regression: helmet lief global VOR dem /feedback-Mount und setzte
// Cross-Origin-Resource-Policy: same-origin + strikte CSP auch auf die
// öffentliche Extension-API. Browser verwarfen daraufhin die Cross-Origin-
// Antwort ("Feedback-Server nicht erreichbar"). /feedback muss VOR helmet
// gemountet sein – dieser Test bildet die App-Reihenfolge aus index.ts nach.

function makeApp() {
  const store = new FeedbackKeyStore(join(mkdtempSync(join(tmpdir(), 'fbwiring-')), 'keys.json'));
  const awork = {
    getProject: async () => ({ id: 'p', name: 'Test' }),
    getProjectMembers: async () => [],
    createTask: async () => ({ id: 't', name: 'x', projectId: 'p' }),
    setTaskAssignees: async () => {},
    uploadTaskFile: async () => ({}),
  };
  const app = express();
  app.set('trust proxy', 1);
  // Reihenfolge wie in src/index.ts: /feedback zuerst, dann helmet, dann
  // compression (Stufe 3, Task 9).
  app.use('/feedback', createFeedbackRouter({ store, awork: awork as any, workspaceUrl: '' }));
  app.use(helmet());
  app.use(compression());
  app.get('/health', (_req, res) => { res.json({ status: 'ok' }); });
  // Hinreichend große JSON-Antwort für den Kompressions-Test — compression()
  // komprimiert absichtlich erst ab einem Schwellenwert (Default 1 KB); eine
  // kleine Antwort wie /health würde den Test nichts belegen lassen.
  app.get('/gross', (_req, res) => {
    res.json({
      eintraege: Array.from({ length: 500 }, (_, i) => ({
        id: i,
        text: 'straightup Teamboard Testdaten für den Kompressions-Test',
      })),
    });
  });
  return app;
}

describe('App-Verdrahtung: helmet vs. /feedback', () => {
  it('/feedback trägt KEINE Cross-Origin-Resource-Policy (Extension-tauglich)', async () => {
    const res = await request(makeApp()).options('/feedback/session')
      .set('Origin', 'https://kunde.de')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.headers['cross-origin-resource-policy']).toBeUndefined();
    expect(res.headers['content-security-policy']).toBeUndefined();
    // CORS des Feedback-Routers bleibt erhalten
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('/feedback/session (401) trägt CORS-Header, aber keine helmet-Header', async () => {
    const res = await request(makeApp()).get('/feedback/session').set('Origin', 'https://kunde.de');
    expect(res.status).toBe(401);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['cross-origin-resource-policy']).toBeUndefined();
  });

  it('andere Routen (z. B. /health) bekommen weiterhin die helmet-Header', async () => {
    const res = await request(makeApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('App-Verdrahtung: gzip-Kompression (Stufe 3, Task 9)', () => {
  it('liefert eine hinreichend große JSON-Antwort gzip-komprimiert, wenn der Client es akzeptiert', async () => {
    const res = await request(makeApp()).get('/gross').set('Accept-Encoding', 'gzip');
    expect(res.headers['content-encoding']).toBe('gzip');
  });
});
