import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateTicketPayload, buildTicketDescriptionHtml, taskNameFrom,
  decodeScreenshot, checkRateLimit, resetRateLimits,
} from '../src/services/feedback-ticket.js';

const validPayload = {
  description: 'Der Button ist zu klein',
  reporterName: 'Max Mustermann',
  assigneeId: null,
  page: { url: 'https://kunde-xy.de/preise', title: 'Preise' },
  element: { selector: '#pricing .cta', rect: { x: 10, y: 20, width: 100, height: 40 } },
  environment: {
    viewport: { width: 1440, height: 900 },
    screen: { width: 2560, height: 1440 },
    devicePixelRatio: 2,
    userAgent: 'TestBrowser/1.0',
    timestamp: '2026-07-02T14:00:00.000Z',
  },
  screenshot: null,
};

describe('validateTicketPayload', () => {
  it('akzeptiert gültige Payload', () => {
    const r = validateTicketPayload(validPayload);
    expect(r.ok).toBe(true);
  });

  it('lehnt leere Beschreibung ab', () => {
    const r = validateTicketPayload({ ...validPayload, description: '   ' });
    expect(r.ok).toBe(false);
  });

  it('lehnt fehlenden reporterName ab', () => {
    const r = validateTicketPayload({ ...validPayload, reporterName: undefined });
    expect(r.ok).toBe(false);
  });

  it('lehnt ungültige URL ab', () => {
    const r = validateTicketPayload({ ...validPayload, page: { url: 'kaputt', title: 'x' } });
    expect(r.ok).toBe(false);
  });

  it('lehnt Nicht-http(s)-URL ab', () => {
    const r = validateTicketPayload({ ...validPayload, page: { url: 'ftp://a.de/x', title: 'x' } });
    expect(r.ok).toBe(false);
  });

  it('lehnt Screenshot ab, der kein PNG-Data-URL ist', () => {
    const r = validateTicketPayload({ ...validPayload, screenshot: 'data:image/jpeg;base64,AAAA' });
    expect(r.ok).toBe(false);
  });
});

describe('buildTicketDescriptionHtml', () => {
  it('enthält alle Metadaten und escapet HTML', () => {
    const html = buildTicketDescriptionHtml({
      ...validPayload,
      description: 'Böse <script>alert(1)</script>\nZeile 2',
    } as any);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<br>');                          // Zeilenumbruch
    expect(html).toContain('Max Mustermann');                 // Reporter
    expect(html).toContain('href="https://kunde-xy.de/preise"'); // klickbarer Link
    expect(html).toContain('#pricing .cta');                  // Selektor
    expect(html).toContain('1440×900');                       // Viewport
    expect(html).toContain('TestBrowser/1.0');                // UA
    expect(html).toContain('2026-07-02');                     // Zeitstempel
  });
});

describe('taskNameFrom', () => {
  it('nimmt die erste Zeile', () => {
    expect(taskNameFrom('Kurzer Titel\nMehr Details')).toBe('Kurzer Titel');
  });

  it('kürzt auf 60 Zeichen mit Ellipsis', () => {
    const name = taskNameFrom('x'.repeat(100));
    expect(name.length).toBe(61); // 60 + '…'
    expect(name.endsWith('…')).toBe(true);
  });
});

describe('decodeScreenshot', () => {
  it('dekodiert gültiges PNG-Data-URL', () => {
    const buf = decodeScreenshot('data:image/png;base64,' + Buffer.from('hallo').toString('base64'));
    expect(buf?.toString()).toBe('hallo');
  });

  it('lehnt zu große Screenshots ab (> 12 MB)', () => {
    const big = Buffer.alloc(13 * 1024 * 1024).toString('base64');
    expect(decodeScreenshot('data:image/png;base64,' + big)).toBeNull();
  });

  it('lehnt Nicht-PNG ab', () => {
    expect(decodeScreenshot('data:text/html;base64,AAAA')).toBeNull();
  });
});

describe('checkRateLimit', () => {
  beforeEach(() => resetRateLimits());

  it('erlaubt 60 Tickets, blockt das 61.', () => {
    for (let i = 0; i < 60; i++) {
      expect(checkRateLimit('fbk_test')).toBe(true);
    }
    expect(checkRateLimit('fbk_test')).toBe(false);
  });

  it('zählt pro Key getrennt', () => {
    for (let i = 0; i < 60; i++) checkRateLimit('fbk_a');
    expect(checkRateLimit('fbk_b')).toBe(true);
  });
});
