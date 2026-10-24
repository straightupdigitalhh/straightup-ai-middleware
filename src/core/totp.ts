import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

// ─── TOTP nach RFC 6238 ──────────────────────────────────────────
//
// Zeitbasierte Einmalcodes, wie jede Authenticator-App sie zeigt: HMAC-SHA1
// über den Zeitschritt (RFC 4226, dynamische Kürzung), sechs Stellen, 30
// Sekunden je Schritt. Ohne Bibliothek, nur `crypto`. Reine Funktionen: Uhr
// und Speicher gehören dem Aufrufer. Geheimnisse sind Base32 (RFC 4648), so
// lesen die Apps sie.

const SCHRITT_MS = 30_000;
const GEHEIMNIS_BYTES = 20;
const STELLEN = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// ─── Base32 ──────────────────────────────────────────────────────

/** Base32 nach RFC 4648, ohne Auffüllzeichen am Ende. */
export function base32Kodiere(bytes: Uint8Array): string {
  let text = '';
  let puffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    puffer = (puffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      text += ALPHABET[(puffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
    puffer &= (1 << bits) - 1;
  }
  if (bits > 0) text += ALPHABET[(puffer << (5 - bits)) & 31];
  return text;
}

/**
 * Liest Base32. Leerzeichen und Kleinbuchstaben sind erlaubt (so steht ein
 * Geheimnis in Vierergruppen auf der Seite), jedes andere Zeichen wirft. Die
 * Meldung nennt den Text nie: es könnte ein Geheimnis sein.
 */
export function base32Dekodiere(text: string): Buffer {
  const ohneLeerraum = text.replace(/\s+/g, '');
  if (!/^[A-Za-z2-7]*$/.test(ohneLeerraum)) throw new Error('Das Geheimnis ist kein gültiges Base32.');
  const bytes: number[] = [];
  let puffer = 0;
  let bits = 0;
  for (const zeichen of ohneLeerraum.toUpperCase()) {
    puffer = (puffer << 5) | ALPHABET.indexOf(zeichen);
    bits += 5;
    if (bits >= 8) {
      bytes.push((puffer >>> (bits - 8)) & 255);
      bits -= 8;
      puffer &= (1 << bits) - 1;
    }
  }
  return Buffer.from(bytes);
}

/** Ein neues Geheimnis: 20 Zufallsbytes als 32 Zeichen Base32. */
export function neuesTotpGeheimnis(): string {
  return base32Kodiere(randomBytes(GEHEIMNIS_BYTES));
}

// ─── Codes ───────────────────────────────────────────────────────

/** Der Zeitschritt zu einem Zeitpunkt: Sekunden seit 1970, geteilt durch 30, abgerundet. */
const zeitschritt = (zeitMs: number): number => Math.floor(zeitMs / SCHRITT_MS);

/** HOTP nach RFC 4226 für einen Zähler: hier der Zeitschritt. */
function einmalcode(schluessel: Buffer, zaehler: number, stellen: number): string {
  const nachricht = Buffer.alloc(8);
  nachricht.writeBigUInt64BE(BigInt(zaehler));
  const mac = createHmac('sha1', schluessel).update(nachricht).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const wert = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(wert % 10 ** stellen).padStart(stellen, '0');
}

/** Der Code, den eine App zu diesem Geheimnis und Zeitpunkt zeigt (sechs Stellen, auf Wunsch mehr). */
export function totpCode(geheimnisBase32: string, zeitMs: number, stellen: number = STELLEN): string {
  return einmalcode(base32Dekodiere(geheimnisBase32), zeitschritt(zeitMs), stellen);
}

/**
 * Zu welchem Zeitschritt gehört dieser Code? Geprüft werden der Schritt der
 * Uhr und je einer davor und danach (Fenster ±30 s, für Uhren, die ein wenig
 * abweichen). Gibt den Schritt zurück, den der Code erzeugt hat, oder null:
 * wer einen Code nur einmal annehmen will, merkt sich diesen Schritt. Treffen
 * zwei Schritte denselben Code, gilt der spätere. Es wird immer alles
 * verglichen und zeitkonstant, ein Treffer bricht nichts ab.
 */
export function findeTotpSchritt(geheimnisBase32: string, code: string, zeitMs: number): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const schluessel = base32Dekodiere(geheimnisBase32);
  const gegeben = Buffer.from(code);
  const jetzt = zeitschritt(zeitMs);
  let treffer: number | null = null;
  for (const schritt of [jetzt + 1, jetzt, jetzt - 1]) {
    if (schritt < 0) continue; // vor dem Anfang der Zählung gibt es keinen Code
    const gleich = timingSafeEqual(Buffer.from(einmalcode(schluessel, schritt, STELLEN)), gegeben);
    if (gleich && treffer === null) treffer = schritt;
  }
  return treffer;
}

/** Stimmt der Code im Fenster von ±30 s? Wiederholte Codes erkennt diese Funktion nicht, dafür gibt es `findeTotpSchritt`. */
export function pruefeTotp(geheimnisBase32: string, code: string, zeitMs: number): boolean {
  return findeTotpSchritt(geheimnisBase32, code, zeitMs) !== null;
}
