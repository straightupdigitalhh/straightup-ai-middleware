// ─── Types ───────────────────────────────────────────────────────

export interface TicketPayload {
  description: string;
  reporterName: string;
  assigneeId?: string | null;
  page: { url: string; title: string };
  element: {
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
}

// ─── Validierung ─────────────────────────────────────────────────

const SCREENSHOT_PREFIX = 'data:image/png;base64,';
const MAX_SCREENSHOT_BYTES = 12 * 1024 * 1024;

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
  try {
    const u = new URL(b.page.url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return { ok: false, message: 'page.url muss http(s) sein' };
    }
  } catch {
    return { ok: false, message: 'page.url ist keine gültige URL' };
  }
  if (!b.element || typeof b.element.selector !== 'string' || !b.element.rect) {
    return { ok: false, message: 'element.selector / element.rect fehlen' };
  }
  if (
    typeof b.element.rect !== 'object' ||
    typeof b.element.rect.x !== 'number' ||
    typeof b.element.rect.y !== 'number' ||
    typeof b.element.rect.width !== 'number' ||
    typeof b.element.rect.height !== 'number' ||
    !Number.isFinite(b.element.rect.x) ||
    !Number.isFinite(b.element.rect.y) ||
    !Number.isFinite(b.element.rect.width) ||
    !Number.isFinite(b.element.rect.height)
  ) {
    return { ok: false, message: 'element.rect muss x/y/width/height als Zahlen enthalten' };
  }
  if (b.assigneeId !== undefined && b.assigneeId !== null && typeof b.assigneeId !== 'string') {
    return { ok: false, message: 'assigneeId muss ein String oder null sein' };
  }
  const env = b.environment;
  if (!env || !env.viewport || !env.screen || typeof env.userAgent !== 'string' || typeof env.timestamp !== 'string') {
    return { ok: false, message: 'environment unvollständig' };
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

export function buildTicketDescriptionHtml(p: TicketPayload): string {
  const desc = escapeHtml(p.description).replace(/\n/g, '<br>');
  const { viewport, screen, devicePixelRatio, userAgent, timestamp } = p.environment;
  const pageLabel = escapeHtml(p.page.title || p.page.url);

  return [
    `<p>${desc}</p>`,
    '<hr>',
    '<p><strong>🌐 Website-Feedback</strong></p>',
    '<ul>',
    `<li><strong>Gemeldet von:</strong> ${escapeHtml(p.reporterName)}</li>`,
    `<li><strong>Seite:</strong> <a href="${escapeHtml(p.page.url)}" target="_blank">${pageLabel}</a></li>`,
    `<li><strong>Element:</strong> <code>${escapeHtml(p.element.selector)}</code></li>`,
    `<li><strong>Viewport:</strong> ${viewport.width}×${viewport.height} (DPR ${devicePixelRatio}) · Bildschirm: ${screen.width}×${screen.height}</li>`,
    `<li><strong>Browser:</strong> ${escapeHtml(userAgent)}</li>`,
    `<li><strong>Zeitpunkt:</strong> ${escapeHtml(timestamp)}</li>`,
    '</ul>',
  ].join('\n');
}

export function taskNameFrom(description: string): string {
  const firstLine = description.trim().split('\n')[0].trim();
  return firstLine.length > 60 ? firstLine.slice(0, 60) + '…' : firstLine;
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
