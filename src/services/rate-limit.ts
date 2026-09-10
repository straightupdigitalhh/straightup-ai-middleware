// ─── Fixed-Window-Rate-Limiter (In-Memory) ──────────────────────
//
// Generische Variante des Musters aus feedback-ticket.ts, hier vor allem
// als Brute-Force-Bremse für fehlgeschlagene Auth-Versuche pro IP.

const MAX_BUCKETS = 10_000;

export class FixedWindowLimiter {
  private buckets = new Map<string, { windowStart: number; count: number }>();

  constructor(private max: number, private windowMs: number) {}

  /** Registriert einen Treffer. Liefert false, wenn das Limit überschritten ist. */
  hit(key: string): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStart >= this.windowMs) {
      if (this.buckets.size >= MAX_BUCKETS) this.pruneExpired(now);
      this.buckets.set(key, { windowStart: now, count: 1 });
      return this.max >= 1;
    }
    bucket.count++;
    return bucket.count <= this.max;
  }

  /** Prüft ohne zu zählen, ob der Key aktuell gesperrt ist. */
  blocked(key: string): boolean {
    const bucket = this.buckets.get(key);
    if (!bucket || Date.now() - bucket.windowStart >= this.windowMs) return false;
    return bucket.count >= this.max;
  }

  /**
   * Prüft ohne zu zählen, ob im aktuellen Fenster bereits `max` Treffer
   * erreicht sind (für Nutzer wie das Mail-Relay, die vor dem eigentlichen
   * Versand wissen müssen, ob noch Kontingent da ist, ohne es zu verbrauchen).
   */
  istErschoepft(key: string): boolean {
    return this.blocked(key);
  }

  /** Sekunden bis zum Ende des aktuellen Fensters für diesen Key, mindestens 1. */
  sekundenBisReset(key: string): number {
    const bucket = this.buckets.get(key);
    if (!bucket) return 1;
    const restMs = bucket.windowStart + this.windowMs - Date.now();
    return Math.max(1, Math.ceil(restMs / 1000));
  }

  reset(): void {
    this.buckets.clear();
  }

  private pruneExpired(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.windowStart >= this.windowMs) this.buckets.delete(key);
    }
  }
}
