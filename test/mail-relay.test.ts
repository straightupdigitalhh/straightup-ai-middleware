import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createMailRelayRouter } from '../src/routes/mail-relay.js';
import { FixedWindowLimiter } from '../src/services/rate-limit.js';

function makeApp(senden = vi.fn().mockResolvedValue(undefined), limiter?: FixedWindowLimiter) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(createMailRelayRouter({ key: 'geheim', senden, limiter }));
  return { app, senden };
}

const gueltig = { to: ['peter@texter.de'], subject: 'Neue Aufgabe', text: 'Hallo Peter' };

describe('POST /api/mail/send', () => {
  it('verschickt mit richtigem Schlüssel und antwortet 202', async () => {
    const { app, senden } = makeApp();
    const res = await request(app).post('/api/mail/send').set('X-Service-Key', 'geheim').send(gueltig);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true });
    expect(senden).toHaveBeenCalledWith(['peter@texter.de'], 'Neue Aufgabe', 'Hallo Peter');
  });

  it('401 ohne oder mit falschem Schlüssel, ohne zu versenden', async () => {
    const { app, senden } = makeApp();
    expect((await request(app).post('/api/mail/send').send(gueltig)).status).toBe(401);
    expect((await request(app).post('/api/mail/send').set('X-Service-Key', 'falsch').send(gueltig)).status).toBe(401);
    expect(senden).not.toHaveBeenCalled();
  });

  it('400 bei ungültigem Body', async () => {
    const { app } = makeApp();
    const faelle = [
      {}, { ...gueltig, to: [] }, { ...gueltig, to: ['kein-mail'] }, { ...gueltig, to: Array(11).fill('a@b.de') },
      { ...gueltig, subject: 'x'.repeat(201) }, { ...gueltig, text: 'x'.repeat(20_001) }, { ...gueltig, text: 42 },
    ];
    for (const body of faelle) {
      const res = await request(app).post('/api/mail/send').set('X-Service-Key', 'geheim').send(body);
      expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
  });

  it('502 wenn Graph scheitert', async () => {
    const { app } = makeApp(vi.fn().mockRejectedValue(new Error('Graph sendMail 500')));
    const res = await request(app).post('/api/mail/send').set('X-Service-Key', 'geheim').send(gueltig);
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('versand_fehlgeschlagen');
  });

  it('429 ab dem Limit', async () => {
    const { app } = makeApp(undefined, new FixedWindowLimiter(2, 60_000));
    for (let i = 0; i < 2; i++) expect((await request(app).post('/api/mail/send').set('X-Service-Key', 'geheim').send(gueltig)).status).toBe(202);
    expect((await request(app).post('/api/mail/send').set('X-Service-Key', 'geheim').send(gueltig)).status).toBe(429);
  });
});
