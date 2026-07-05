import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { safeEqual, createApiKeyAuth } from '../src/services/auth.js';
import { FixedWindowLimiter } from '../src/services/rate-limit.js';

describe('safeEqual', () => {
  it('gleiche Strings → true', () => {
    expect(safeEqual('geheim-123', 'geheim-123')).toBe(true);
  });

  it('unterschiedliche Strings gleicher Länge → false', () => {
    expect(safeEqual('geheim-123', 'geheim-124')).toBe(false);
  });

  it('unterschiedliche Längen → false (ohne Exception)', () => {
    expect(safeEqual('kurz', 'viel-laenger')).toBe(false);
    expect(safeEqual('', 'x')).toBe(false);
  });
});

describe('FixedWindowLimiter', () => {
  it('erlaubt bis zum Limit, blockt danach', () => {
    const limiter = new FixedWindowLimiter(3, 60_000);
    expect(limiter.hit('ip')).toBe(true);
    expect(limiter.hit('ip')).toBe(true);
    expect(limiter.hit('ip')).toBe(true);
    expect(limiter.hit('ip')).toBe(false);
    expect(limiter.blocked('ip')).toBe(true);
    expect(limiter.blocked('andere-ip')).toBe(false);
  });

  it('reset hebt Sperren auf', () => {
    const limiter = new FixedWindowLimiter(1, 60_000);
    limiter.hit('ip');
    limiter.hit('ip');
    expect(limiter.blocked('ip')).toBe(true);
    limiter.reset();
    expect(limiter.blocked('ip')).toBe(false);
  });
});

describe('createApiKeyAuth', () => {
  function makeApp(limiter?: FixedWindowLimiter) {
    const app = express();
    app.use('/api', createApiKeyAuth('master-key', limiter));
    app.get('/api/ping', (_req, res) => { res.json({ ok: true }); });
    return app;
  }

  it('korrekter Key → durchgelassen', async () => {
    const res = await request(makeApp()).get('/api/ping').set('X-API-Key', 'master-key');
    expect(res.status).toBe(200);
  });

  it('fehlender oder falscher Key → 401', async () => {
    const app = makeApp();
    expect((await request(app).get('/api/ping')).status).toBe(401);
    expect((await request(app).get('/api/ping').set('X-API-Key', 'falsch')).status).toBe(401);
  });

  it('nach zu vielen Fehlversuchen → 429, auch mit korrektem Key', async () => {
    const app = makeApp(new FixedWindowLimiter(3, 60_000));
    for (let i = 0; i < 3; i++) {
      await request(app).get('/api/ping').set('X-API-Key', 'falsch');
    }
    const blocked = await request(app).get('/api/ping').set('X-API-Key', 'falsch');
    expect(blocked.status).toBe(429);
    // Sperre gilt für die IP, nicht nur für falsche Keys (Brute-Force-Bremse)
    const evenCorrect = await request(app).get('/api/ping').set('X-API-Key', 'master-key');
    expect(evenCorrect.status).toBe(429);
  });

  it('erfolgreiche Requests zählen nicht als Fehlversuch', async () => {
    const app = makeApp(new FixedWindowLimiter(2, 60_000));
    for (let i = 0; i < 5; i++) {
      const res = await request(app).get('/api/ping').set('X-API-Key', 'master-key');
      expect(res.status).toBe(200);
    }
  });
});

// ─── Wissenssystem-Formular: Inline-Script gültig, kein Key in der URL ──
describe('GET /wissenssystem (UI)', () => {
  it('liefert HTML mit syntaktisch gültigem Inline-Script und Login statt ?key=', async () => {
    const { default: uiRouter } = await import('../src/routes/ui.js');
    const app = express();
    app.use(uiRouter);

    const res = await request(app).get('/wissenssystem');
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/html/);

    const match = res.text.match(/<script>([\s\S]*?)<\/script>/);
    expect(match).not.toBeNull();
    // wirft bei Syntaxfehler → Test schlägt fehl
    expect(() => new Function(match![1])).not.toThrow();

    // Regression H1: der Master-Key darf nicht mehr aus der URL gelesen werden
    expect(match![1]).not.toContain('window.location.search');
    expect(match![1]).toContain('sessionStorage');

    // Regression M1: Selects werden nicht mehr per innerHTML-Konkatenation befüllt
    expect(match![1]).not.toMatch(/innerHTML\s*=\s*'<option/);
  });
});
