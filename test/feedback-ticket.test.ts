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

const pdfPayload = {
  description: 'Logo zu klein',
  reporterName: 'Kunde Klaus',
  assigneeId: null,
  page: { url: '', title: 'flyer-v3.pdf' },
  environment: validPayload.environment,
  screenshot: null,
  pdf: {
    fileName: 'flyer-v3.pdf',
    url: null,
    page: 3,
    pageCount: 12,
    pageSize: { width: 595.28, height: 841.89 },
    rect: { x: 119.06, y: 340.16, width: 240.94, height: 48.19 },
  },
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

  it('lehnt rect mit Nicht-Zahlen ab', () => {
    const r = validateTicketPayload({
      ...validPayload,
      element: { selector: '#a', rect: { x: 'nope', y: 0, width: 1, height: 1 } },
    });
    expect(r.ok).toBe(false);
  });

  it('lehnt assigneeId mit falschem Typ ab', () => {
    const r = validateTicketPayload({ ...validPayload, assigneeId: 12345 });
    expect(r.ok).toBe(false);
  });

  it('akzeptiert assigneeId als String und als null', () => {
    expect(validateTicketPayload({ ...validPayload, assigneeId: 'u1' }).ok).toBe(true);
    expect(validateTicketPayload({ ...validPayload, assigneeId: null }).ok).toBe(true);
  });

  it('lehnt nicht-numerische viewport-Werte ab (HTML-Injection-Schutz)', () => {
    const r = validateTicketPayload({
      ...validPayload,
      environment: { ...validPayload.environment, viewport: { width: '<img src=x onerror=alert(1)>', height: 900 } },
    });
    expect(r.ok).toBe(false);
  });

  it('lehnt nicht-numerischen devicePixelRatio ab', () => {
    const r = validateTicketPayload({
      ...validPayload,
      environment: { ...validPayload.environment, devicePixelRatio: '2; DROP' },
    });
    expect(r.ok).toBe(false);
  });

  describe('validateTicketPayload – PDF-Tickets', () => {
    it('akzeptiert lokale PDF ohne element und mit leerer page.url', () => {
      expect(validateTicketPayload(pdfPayload).ok).toBe(true);
    });

    it('akzeptiert gehostete PDF mit http(s)-URL', () => {
      const r = validateTicketPayload({
        ...pdfPayload,
        page: { url: 'https://preview.agentur.de/flyer-v3.pdf', title: 'flyer-v3.pdf' },
        pdf: { ...pdfPayload.pdf, url: 'https://preview.agentur.de/flyer-v3.pdf' },
      });
      expect(r.ok).toBe(true);
    });

    it('ohne pdf bleibt leere page.url verboten', () => {
      expect(validateTicketPayload({ ...validPayload, page: { url: '', title: 'x' } }).ok).toBe(false);
    });

    it('ohne pdf bleibt element Pflicht', () => {
      const { element, ...ohneElement } = validPayload;
      expect(validateTicketPayload(ohneElement).ok).toBe(false);
    });

    it.each([
      ['fileName leer', { fileName: '   ' }],
      ['fileName zu lang', { fileName: 'x'.repeat(256) }],
      ['url kein http(s)', { url: 'ftp://a.de/x.pdf' }],
      ['url falscher Typ', { url: 42 }],
      ['page 0', { page: 0 }],
      ['page > pageCount', { page: 13 }],
      ['page keine ganze Zahl', { page: 2.5 }],
      ['pageCount 0', { pageCount: 0 }],
      ['pageSize Breite 0', { pageSize: { width: 0, height: 841.89 } }],
      ['pageSize fehlt', { pageSize: undefined }],
      ['rect negative Breite', { rect: { x: 1, y: 1, width: -5, height: 1 } }],
      ['rect mit String', { rect: { x: '<b>', y: 1, width: 1, height: 1 } }],
    ])('lehnt ab: %s', (_name, patch) => {
      const r = validateTicketPayload({ ...pdfPayload, pdf: { ...pdfPayload.pdf, ...patch } });
      expect(r.ok).toBe(false);
    });

    it('page.url muss bei pdf leer oder http(s) sein', () => {
      const r = validateTicketPayload({ ...pdfPayload, page: { url: 'file:///x.pdf', title: 'x' } });
      expect(r.ok).toBe(false);
    });
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
