import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

// ─── Passwort-Hashing (scrypt, Node-Bordmittel) ──────────────────
//
// Format: scrypt$<N>$<r>$<p>$<salt-b64url>$<hash-b64url>
// Parameter werden mitgespeichert, damit sie später erhöht werden können,
// ohne Bestands-Hashes zu invalidieren.

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, 'base64url');
  const expected = Buffer.from(hashB64, 'base64url');
  const actual = scryptSync(password, salt, expected.length, {
    N: parseInt(n, 10), r: parseInt(r, 10), p: parseInt(p, 10),
  });
  return timingSafeEqual(actual, expected);
}
