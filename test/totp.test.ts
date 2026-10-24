import { describe, it, expect } from 'vitest';
import { randomBytes } from 'crypto';
import {
  base32Dekodiere,
  base32Kodiere,
  findeTotpSchritt,
  neuesTotpGeheimnis,
  pruefeTotp,
  totpCode,
} from '../src/core/totp.js';

// Sicherheitsplattform Teil 1, Task 9: TOTP (RFC 6238) ohne neue Bibliothek.
// Reine Funktionen: Code berechnen, Code im Fenster prüfen, Geheimnis erzeugen,
// dazu das Base32, in dem Authenticator-Apps ihre Geheimnisse lesen. Die
// Testvektoren stehen im Anhang B der RFC 6238 (SHA-1, Geheimnis "12345678901234567890").

/** Das RFC-Geheimnis "12345678901234567890" als Base32, so wie eine App es erwartet. */
const RFC_GEHEIMNIS = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

/** [Zeit in Sekunden, Code mit 8 Stellen] aus Anhang B der RFC 6238 (SHA-1). */
const RFC_VEKTOREN: [number, string][] = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

describe('totpCode: Testvektoren der RFC 6238', () => {
  it('rfc_6238_testvektoren_8_stellen: alle sechs SHA-1-Vektoren, auch mit führender Null', () => {
    for (const [sekunden, erwartet] of RFC_VEKTOREN) {
      expect(totpCode(RFC_GEHEIMNIS, sekunden * 1000, 8), `${sekunden} s`).toBe(erwartet);
    }
  });

  it('rfc_6238_testvektoren_6_stellen: sechs Stellen sind der Standard und die letzten sechs der acht', () => {
    expect(totpCode(RFC_GEHEIMNIS, 59_000)).toBe('287082'); // Brief: 59 s → 287082
    expect(totpCode(RFC_GEHEIMNIS, 59_000, 6)).toBe('287082');
    for (const [sekunden, achtStellig] of RFC_VEKTOREN) {
      expect(totpCode(RFC_GEHEIMNIS, sekunden * 1000), `${sekunden} s`).toBe(achtStellig.slice(2));
    }
  });

  it('code_bleibt_im_30_sekunden_schritt_gleich: 30 s Schrittweite, Millisekunden zählen nicht', () => {
    expect(totpCode(RFC_GEHEIMNIS, 30_000)).toBe(totpCode(RFC_GEHEIMNIS, 59_999));
    expect(totpCode(RFC_GEHEIMNIS, 29_999)).not.toBe(totpCode(RFC_GEHEIMNIS, 30_000));
    expect(totpCode(RFC_GEHEIMNIS, 60_000)).not.toBe(totpCode(RFC_GEHEIMNIS, 59_999));
  });

  it('geheimnis_mit_leerzeichen_und_kleinbuchstaben: so tippt es jemand aus der Anzeige ab', () => {
    expect(totpCode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq', 59_000)).toBe('287082');
  });

  it('ungueltiges_geheimnis_wirft_ohne_das_geheimnis_zu_nennen', () => {
    expect(() => totpCode('GEZD-1-ungueltig', 59_000)).toThrow();
    try {
      totpCode('GEZD-1-ungueltig', 59_000);
    } catch (e) {
      expect((e as Error).message).not.toContain('GEZD-1-ungueltig');
    }
  });
});

describe('pruefeTotp: Fenster und falsche Codes', () => {
  const T = 2_000_000_000_000; // irgendein Zeitpunkt, fest, damit die Prüfung deterministisch ist
  const code = totpCode(RFC_GEHEIMNIS, T);

  it('fenster_plus_minus_ein_schritt: gleicher Schritt, einen früher und einen später gelten, zwei daneben nicht', () => {
    expect(pruefeTotp(RFC_GEHEIMNIS, code, T)).toBe(true);
    expect(pruefeTotp(RFC_GEHEIMNIS, code, T + 30_000)).toBe(true);
    expect(pruefeTotp(RFC_GEHEIMNIS, code, T - 30_000)).toBe(true);
    expect(pruefeTotp(RFC_GEHEIMNIS, code, T + 60_000)).toBe(false);
    expect(pruefeTotp(RFC_GEHEIMNIS, code, T - 60_000)).toBe(false);
  });

  it('fenster_an_den_schrittgrenzen: der Code aus Schritt 1 (30 bis 59 s) gilt von 0 s bis 89,999 s, nicht ab 90 s', () => {
    const ausSchritt1 = totpCode(RFC_GEHEIMNIS, 59_000);
    expect(pruefeTotp(RFC_GEHEIMNIS, ausSchritt1, 0)).toBe(true);
    expect(pruefeTotp(RFC_GEHEIMNIS, ausSchritt1, 89_999)).toBe(true);
    expect(pruefeTotp(RFC_GEHEIMNIS, ausSchritt1, 90_000)).toBe(false);
  });

  it('falscher_code: ein anderer Code, ein Code zu einem anderen Geheimnis und alles, was keine sechs Ziffern sind', () => {
    expect(pruefeTotp(RFC_GEHEIMNIS, code, T)).toBe(true); // Gegenprobe: der richtige Code geht durch
    const falsch = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
    expect(pruefeTotp(RFC_GEHEIMNIS, falsch, T)).toBe(false);
    expect(pruefeTotp(neuesTotpGeheimnis(), code, T)).toBe(false);
    for (const unbrauchbar of ['', '12345', '1234567', '12 3456', 'abcdef', '12345a', ' 123456', '123456 ', '123456\n', '+12345', '१२३४५६', code + '0']) {
      expect(pruefeTotp(RFC_GEHEIMNIS, unbrauchbar, T), JSON.stringify(unbrauchbar)).toBe(false);
    }
  });

  it('zeit_nahe_1970: Schritte vor dem Anfang der Zählung werden übersprungen statt zu werfen', () => {
    expect(pruefeTotp(RFC_GEHEIMNIS, totpCode(RFC_GEHEIMNIS, 0), 0)).toBe(true);
    expect(pruefeTotp(RFC_GEHEIMNIS, '000000', 0)).toBe(false);
  });
});

describe('findeTotpSchritt: welcher Schritt hat den Code erzeugt', () => {
  it('liefert_den_schritt_des_codes_nicht_den_der_uhr', () => {
    const ausSchritt1 = totpCode(RFC_GEHEIMNIS, 59_000);
    expect(findeTotpSchritt(RFC_GEHEIMNIS, ausSchritt1, 59_000)).toBe(1);
    expect(findeTotpSchritt(RFC_GEHEIMNIS, ausSchritt1, 0)).toBe(1); // Uhr einen Schritt vor dem Code
    expect(findeTotpSchritt(RFC_GEHEIMNIS, ausSchritt1, 89_000)).toBe(1); // Uhr einen Schritt nach dem Code
    expect(findeTotpSchritt(RFC_GEHEIMNIS, ausSchritt1, 90_000)).toBeNull();
  });

  it('der_schritt_ist_die_zeit_geteilt_durch_30_s_abgerundet', () => {
    for (const [sekunden, achtStellig] of RFC_VEKTOREN) {
      expect(findeTotpSchritt(RFC_GEHEIMNIS, achtStellig.slice(2), sekunden * 1000), `${sekunden} s`).toBe(Math.floor(sekunden / 30));
    }
  });

  it('bei_zwei_treffern_gilt_der_spaetere_schritt: ergeben zwei Schritte im Fenster denselben Code, merkt sich der Aufrufer den späteren', () => {
    // Ein Wegwerf-Geheimnis, bei dem die Schritte s und s+1 denselben Code ergeben (offline gesucht, etwa
    // einmal in einer Million): ohne so ein Geheimnis ließe sich die Regel nicht prüfen.
    const KOLLISION = 'XRZCCRRMNF7YXWX7L6SYG7FNWKUCW55K';
    const T = 2_000_000_000_000;
    const s = Math.floor(T / 30_000);
    expect(totpCode(KOLLISION, T)).toBe('082594');
    expect(totpCode(KOLLISION, T + 30_000)).toBe('082594');

    expect(findeTotpSchritt(KOLLISION, '082594', T - 60_000)).toBeNull(); // Uhr in s-2: Fenster s-3 bis s-1
    expect(findeTotpSchritt(KOLLISION, '082594', T - 30_000)).toBe(s); // Uhr in s-1: Fenster s-2 bis s, nur s trifft
    expect(findeTotpSchritt(KOLLISION, '082594', T)).toBe(s + 1); // Uhr in s: s und s+1 treffen, der spätere gilt
    expect(findeTotpSchritt(KOLLISION, '082594', T + 30_000)).toBe(s + 1); // Uhr in s+1: ebenso
    expect(findeTotpSchritt(KOLLISION, '082594', T + 60_000)).toBe(s + 1); // Uhr in s+2: nur s+1 trifft
    expect(findeTotpSchritt(KOLLISION, '082594', T + 90_000)).toBeNull(); // Uhr in s+3: Fenster s+2 bis s+4
  });

  it('kein_treffer_ist_null', () => {
    expect(findeTotpSchritt(RFC_GEHEIMNIS, '287082', 59_000)).toBe(1); // Gegenprobe: der richtige Code trifft
    expect(findeTotpSchritt(RFC_GEHEIMNIS, '000000', 59_000)).toBeNull();
    expect(findeTotpSchritt(RFC_GEHEIMNIS, 'kaputt', 59_000)).toBeNull();
  });
});

describe('Base32 und Geheimnis', () => {
  const LATEIN = (text: string) => Buffer.from(text, 'latin1');

  it('base32_rundreise: Kodieren und Dekodieren ergeben die Bytes zurück, für jede Länge', () => {
    for (let laenge = 0; laenge <= 45; laenge++) {
      const bytes = randomBytes(laenge);
      const text = base32Kodiere(bytes);
      expect(text, `Länge ${laenge}`).toMatch(/^[A-Z2-7]*$/);
      expect(base32Dekodiere(text).equals(bytes), `Länge ${laenge}`).toBe(true);
    }
  });

  it('base32_nach_rfc_4648: die Beispiele aus Abschnitt 10, ohne Auffüllzeichen', () => {
    const faelle: [string, string][] = [
      ['', ''], ['f', 'MY'], ['fo', 'MZXQ'], ['foo', 'MZXW6'], ['foob', 'MZXW6YQ'], ['fooba', 'MZXW6YTB'], ['foobar', 'MZXW6YTBOI'],
    ];
    for (const [klartext, base32] of faelle) {
      expect(base32Kodiere(LATEIN(klartext)), JSON.stringify(klartext)).toBe(base32);
      expect(base32Dekodiere(base32).equals(LATEIN(klartext)), JSON.stringify(klartext)).toBe(true);
    }
    expect(base32Kodiere(LATEIN('12345678901234567890'))).toBe(RFC_GEHEIMNIS);
  });

  it('base32_lesen_erlaubt_leerzeichen_und_kleinbuchstaben: so zeigt die Seite das Geheimnis in Vierergruppen', () => {
    const erwartet = LATEIN('12345678901234567890');
    expect(base32Dekodiere('gezd gnbv gy3t qojq gezd gnbv gy3t qojq').equals(erwartet)).toBe(true);
    expect(base32Dekodiere(' GEZD\tGNBV\nGY3T QOJQ GEZD GNBV GY3T QOJQ ').equals(erwartet)).toBe(true);
  });

  it('base32_lesen_weist_fremde_zeichen_ab: 0, 1, 8, 9, Auffüllzeichen und Umlaute gehören nicht zum Alphabet', () => {
    for (const unbrauchbar of ['GEZ0', 'GEZ1', 'GEZ8', 'GEZ9', 'GEZD=', 'GEZD-GNBV', 'GEZÄ', 'ß']) {
      expect(() => base32Dekodiere(unbrauchbar), unbrauchbar).toThrow();
    }
  });

  it('neues_geheimnis: 20 Zufallsbytes als 32 Zeichen Base32, jedes Mal ein anderes', () => {
    const gesehen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const geheimnis = neuesTotpGeheimnis();
      expect(geheimnis).toMatch(/^[A-Z2-7]{32}$/);
      expect(base32Dekodiere(geheimnis)).toHaveLength(20);
      gesehen.add(geheimnis);
    }
    expect(gesehen.size).toBe(50);
  });

  it('neues_geheimnis_funktioniert_mit_totp: ein erzeugtes Geheimnis liefert Codes, die sich prüfen lassen', () => {
    const geheimnis = neuesTotpGeheimnis();
    const jetzt = 1_800_000_000_000;
    expect(pruefeTotp(geheimnis, totpCode(geheimnis, jetzt), jetzt)).toBe(true);
  });
});
