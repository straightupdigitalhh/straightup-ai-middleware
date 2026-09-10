import { describe, it, expect, vi, afterEach } from 'vitest';
import { FixedWindowLimiter } from '../src/services/rate-limit.js';

// Ergänzt security.test.ts (hit/blocked) um die beiden nicht-brechenden
// Methoden für die Mail-Relay-Drossel: istErschoepft prüft ohne zu zählen,
// sekundenBisReset liefert die Retry-After-Sekunden (Abschlussprüfung, Befund 3).

describe('FixedWindowLimiter – istErschoepft/sekundenBisReset', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('istErschoepft prüft ohne zu zählen und wird erst beim Erreichen von max true', () => {
    const limiter = new FixedWindowLimiter(2, 60_000);
    expect(limiter.istErschoepft('k')).toBe(false);
    expect(limiter.istErschoepft('k')).toBe(false); // wiederholtes Prüfen zählt nicht mit
    limiter.hit('k');
    expect(limiter.istErschoepft('k')).toBe(false);
    limiter.hit('k');
    expect(limiter.istErschoepft('k')).toBe(true);
  });

  it('sekundenBisReset liefert die Restzeit bis zum Fensterende, mindestens 1', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new FixedWindowLimiter(1, 60_000);
    limiter.hit('k');
    vi.setSystemTime(10_000);
    expect(limiter.sekundenBisReset('k')).toBe(50);
    vi.setSystemTime(59_900);
    expect(limiter.sekundenBisReset('k')).toBe(1);
  });

  it('nach Fensterende: istErschoepft wieder false, sekundenBisReset zählt für das neue Fenster', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new FixedWindowLimiter(1, 60_000);
    limiter.hit('k');
    expect(limiter.istErschoepft('k')).toBe(true);
    vi.setSystemTime(60_000);
    expect(limiter.istErschoepft('k')).toBe(false);
    limiter.hit('k');
    expect(limiter.sekundenBisReset('k')).toBe(60);
  });
});
