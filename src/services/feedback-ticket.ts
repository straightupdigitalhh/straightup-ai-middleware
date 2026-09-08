// ─── Types ───────────────────────────────────────────────────────

export interface PdfLocation {
  /** z. B. "flyer-v3.pdf" */
  fileName: string;
  /** http(s)-URL der PDF, null bei lokaler Datei */
  url: string | null;
  /** 1-basiert */
  page: number;
  pageCount: number;
  /** Punkte (1/72 Zoll), dargestellte Ausrichtung */
  pageSize: { width: number; height: number };
  /** Punkte, Ursprung oben links der Seite */
  rect: { x: number; y: number; width: number; height: number };
}

export interface TicketPayload {
  description: string;
  reporterName: string;
  assigneeId?: string | null;
  page: { url: string; title: string };
  /** Pflicht bei Website-Tickets, entfällt bei PDF-Tickets */
  element?: {
    selector: string;
    rect: { x: number; y: number; width: number; height: number };
  };
  environment: {
    viewport: { width: number; height: number };
    screen: { width: number; height: number };
    devicePixelRatio: number;
    userAgent: string;
    timestamp: string;
  };
  screenshot?: string | null;
  /** Vorhanden bei PDF-Tickets (Spec 2026-09-08) */
  pdf?: PdfLocation;
}

// ─── Validierung ─────────────────────────────────────────────────

const SCREENSHOT_PREFIX = 'data:image/png;base64,';
const MAX_SCREENSHOT_BYTES = 12 * 1024 * 1024;

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isRect(r: any): boolean {
  return !!r && typeof r === 'object'
    && isFiniteNumber(r.x) && isFiniteNumber(r.y)
    && isFiniteNumber(r.width) && isFiniteNumber(r.height);
}

function isHttpUrl(s: unknown): boolean {
  if (typeof s !== 'string') return false;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Gibt eine Fehlermeldung zurück oder null, wenn der pdf-Block gültig ist. */
function validatePdfBlock(pdf: any): string | null {
  if (!pdf || typeof pdf !== 'object') return 'pdf muss ein Objekt sein';
  if (typeof pdf.fileName !== 'string' || !pdf.fileName.trim() || pdf.fileName.length > 255) {
    return 'pdf.fileName fehlt, ist leer oder länger als 255 Zeichen';
  }
  if (pdf.url !== null && !isHttpUrl(pdf.url)) return 'pdf.url muss null oder eine http(s)-URL sein';
  if (!Number.isInteger(pdf.page) || !Number.isInteger(pdf.pageCount) || pdf.page < 1 || pdf.pageCount < 1 || pdf.page > pdf.pageCount) {
    return 'pdf.page / pdf.pageCount müssen ganze Zahlen ≥ 1 mit page ≤ pageCount sein';
  }
  if (!pdf.pageSize || !isFiniteNumber(pdf.pageSize.width) || !isFiniteNumber(pdf.pageSize.height)
      || pdf.pageSize.width <= 0 || pdf.pageSize.height <= 0) {
    return 'pdf.pageSize muss Breite/Höhe > 0 enthalten';
  }
  if (!isRect(pdf.rect) || pdf.rect.width < 0 || pdf.rect.height < 0) {
    return 'pdf.rect muss x/y/width/height als Zahlen enthalten (Breite/Höhe ≥ 0)';
  }
  return null;
}

export function validateTicketPayload(
  body: unknown,
): { ok: true; value: TicketPayload } | { ok: false; message: string } {
  const b = body as Record<string, any>;
  if (!b || typeof b !== 'object') return { ok: false, message: 'Body fehlt' };

  if (typeof b.description !== 'string' || !b.description.trim()) {
    return { ok: false, message: 'description fehlt oder ist leer' };
  }
  if (typeof b.reporterName !== 'string' || !b.reporterName.trim()) {
    return { ok: false, message: 'reporterName fehlt oder ist leer' };
  }
  if (!b.page || typeof b.page.url !== 'string' || typeof b.page.title !== 'string') {
    return { ok: false, message: 'page.url / page.title fehlen' };
  }

  const isPdf = b.pdf !== undefined && b.pdf !== null;
  if (isPdf) {
    const pdfError = validatePdfBlock(b.pdf);
    if (pdfError) return { ok: false, message: pdfError };
    // PDF-Tickets: URL darf leer sein (lokale Datei), sonst http(s)
    if (b.page.url !== '' && !isHttpUrl(b.page.url)) {
      return { ok: false, message: 'page.url muss bei PDF-Tickets leer oder http(s) sein' };
    }
  } else if (!isHttpUrl(b.page.url)) {
    return { ok: false, message: 'page.url muss eine gültige http(s)-URL sein' };
  }

  if (!isPdf || b.element !== undefined) {
    if (!b.element || typeof b.element.selector !== 'string' || !b.element.rect) {
      return { ok: false, message: 'element.selector / element.rect fehlen' };
    }
    if (!isRect(b.element.rect)) {
      return { ok: false, message: 'element.rect muss x/y/width/height als Zahlen enthalten' };
    }
  }

  if (b.assigneeId !== undefined && b.assigneeId !== null && typeof b.assigneeId !== 'string') {
    return { ok: false, message: 'assigneeId muss ein String oder null sein' };
  }
  const env = b.environment;
  if (!env || !env.viewport || !env.screen || typeof env.userAgent !== 'string' || typeof env.timestamp !== 'string') {
    return { ok: false, message: 'environment unvollständig' };
  }
  if (
    !isFiniteNumber(env.viewport.width) || !isFiniteNumber(env.viewport.height) ||
    !isFiniteNumber(env.screen.width) || !isFiniteNumber(env.screen.height) ||
    !isFiniteNumber(env.devicePixelRatio)
  ) {
    return { ok: false, message: 'environment enthält ungültige Zahlenwerte' };
  }
  if (b.screenshot != null) {
    if (typeof b.screenshot !== 'string' || !b.screenshot.startsWith(SCREENSHOT_PREFIX)) {
      return { ok: false, message: 'screenshot muss ein PNG-Data-URL sein' };
    }
  }
  return { ok: true, value: b as TicketPayload };
}

// ─── HTML-Beschreibung ───────────────────────────────────────────

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const ptToMm = (pt: number): number => Math.round(pt * 25.4 / 72);

/** Fundstelle für Gestalter: Abstand vom linken/oberen Seitenrand, Bereich, Seitenformat – in mm. */
export function formatPdfPosition(pdf: PdfLocation): string {
  return `${ptToMm(pdf.rect.x)} mm von links, ${ptToMm(pdf.rect.y)} mm von oben`
    + ` · Bereich ${ptToMm(pdf.rect.width)} × ${ptToMm(pdf.rect.height)} mm`
    + ` · Seite ${ptToMm(pdf.pageSize.width)} × ${ptToMm(pdf.pageSize.height)} mm`;
}

export function buildTicketDescriptionHtml(p: TicketPayload): string {
  const desc = escapeHtml(p.description).replace(/\n/g, '<br>');
  const { viewport, screen, devicePixelRatio, userAgent, timestamp } = p.environment;

  if (p.pdf) {
    const file = p.pdf.url
      ? `<a href="${escapeHtml(p.pdf.url)}" target="_blank">${escapeHtml(p.pdf.fileName)}</a>`
      : escapeHtml(p.pdf.fileName);
    return [
      `<p>${desc}</p>`,
      '<hr>',
      '<p><strong>📄 PDF-Feedback</strong></p>',
      '<ul>',
      `<li><strong>Gemeldet von:</strong> ${escapeHtml(p.reporterName)}</li>`,
      `<li><strong>Datei:</strong> ${file}</li>`,
      `<li><strong>Seite:</strong> ${p.pdf.page} von ${p.pdf.pageCount}</li>`,
      `<li><strong>Position:</strong> ${escapeHtml(formatPdfPosition(p.pdf))}</li>`,
      `<li><strong>Zeitpunkt:</strong> ${escapeHtml(timestamp)}</li>`,
      `<li><strong>Browser:</strong> ${escapeHtml(userAgent)}</li>`,
      '</ul>',
    ].join('\n');
  }

  const pageLabel = escapeHtml(p.page.title || p.page.url);
  const selector = p.element?.selector ?? '';

  return [
    `<p>${desc}</p>`,
    '<hr>',
    '<p><strong>🌐 Website-Feedback</strong></p>',
    '<ul>',
    `<li><strong>Gemeldet von:</strong> ${escapeHtml(p.reporterName)}</li>`,
    `<li><strong>Seite:</strong> <a href="${escapeHtml(p.page.url)}" target="_blank">${pageLabel}</a></li>`,
    `<li><strong>Element:</strong> <code>${escapeHtml(selector)}</code></li>`,
    `<li><strong>Viewport:</strong> ${viewport.width}×${viewport.height} (DPR ${devicePixelRatio}) · Bildschirm: ${screen.width}×${screen.height}</li>`,
    `<li><strong>Browser:</strong> ${escapeHtml(userAgent)}</li>`,
    `<li><strong>Zeitpunkt:</strong> ${escapeHtml(timestamp)}</li>`,
    '</ul>',
  ].join('\n');
}

export function taskNameFrom(description: string, pdf?: PdfLocation | null): string {
  const firstLine = description.trim().split('\n')[0].trim();
  const short = firstLine.length > 60 ? firstLine.slice(0, 60) + '…' : firstLine;
  return pdf ? `S. ${pdf.page} · ${pdf.fileName}: ${short}` : short;
}

// ─── Screenshot ──────────────────────────────────────────────────

export function decodeScreenshot(dataUrl: string): Buffer | null {
  if (!dataUrl.startsWith(SCREENSHOT_PREFIX)) return null;
  const base64 = dataUrl.slice(SCREENSHOT_PREFIX.length);
  const buf = Buffer.from(base64, 'base64');
  if (buf.length === 0 || buf.length > MAX_SCREENSHOT_BYTES) return null;
  return buf;
}

// ─── Rate-Limit (festes Fenster, In-Memory) ──────────────────────

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const rateBuckets = new Map<string, { windowStart: number; count: number }>();

export function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateBuckets.set(key, { windowStart: now, count: 1 });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_MAX) return false;
  bucket.count++;
  return true;
}

export function resetRateLimits(): void {
  rateBuckets.clear();
}
