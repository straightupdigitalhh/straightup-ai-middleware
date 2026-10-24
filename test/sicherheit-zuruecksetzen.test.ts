import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { openDb } from '../src/core/db.js';
import { SessionStore } from '../src/core/sessions.js';
import { UserStore } from '../src/core/users.js';
import { ZweiterFaktorStore } from '../src/core/zweiter-faktor.js';

// docs/sicherheitsplattform.md nennt den Befehl, mit dem Jan den zweiten Faktor
// eines Kontos zurücksetzt: node -e mit node:sqlite, weil das Image (node:22-alpine)
// kein sqlite3 hat. Dieser Test führt genau den Befehl aus der Doku aus, gegen
// eine eigene Datenbank unter os.tmpdir().

const DOKU = readFileSync(fileURLToPath(new URL('../docs/sicherheitsplattform.md', import.meta.url)), 'utf-8');
/** Das Skript zwischen `node -e '` und der schließenden Zeile `' <E-Mail>`. */
const SKRIPT = /node -e '\n([\s\S]*?)\n' \S+/.exec(DOKU)?.[1] ?? null;

const BIS = '2099-01-01T00:00:00.000Z';
const JETZT = new Date('2026-10-24T12:00:00.000Z');

function ausfuehren(datenVerzeichnis: string, email: string): { code: number; aus: string; fehler: string } {
  try {
    const aus = execFileSync(process.execPath, ['-e', SKRIPT ?? '', email], {
      env: { ...process.env, DATA_DIR: datenVerzeichnis, FEEDBACK_DATA_DIR: '' },
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, aus, fehler: '' };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { code: err.status, aus: err.stdout, fehler: err.stderr };
  }
}

/** Zwei Konten mit eingerichtetem und für eine Session bestätigtem zweiten Faktor. */
function anlegen(verzeichnis: string) {
  const db = openDb(join(verzeichnis, 'middleware.db'));
  const users = new UserStore(db);
  const sessions = new SessionStore(db, users);
  const jan = users.create({ email: 'Jan@Example.test', name: 'Jan', role: 'admin', password: 'passwort-fuer-tests' });
  const gabi = users.create({ email: 'gabi@example.test', name: 'Gabi', role: 'member', password: 'passwort-fuer-tests' });
  const sJan = sessions.create(jan.id);
  const sGabi = sessions.create(gabi.id);
  for (const [id, entwurf] of [[jan.id, 'ENTWURFENTWURFENTWURFENTWURF2345'], [gabi.id, null]] as const) {
    db.prepare('UPDATE users SET totp_geheimnis = ?, totp_entwurf = ?, totp_letzter_schritt = 59000000 WHERE id = ?')
      .run('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', entwurf, id);
  }
  db.prepare('UPDATE sessions SET zweiter_faktor_bis = ?').run(BIS);
  db.prepare('UPDATE sessions SET expires_at = ?').run(BIS);
  db.close();
  return { jan, gabi, sJan, sGabi };
}

describe('Zweiter Faktor zurücksetzen (der Befehl aus docs/sicherheitsplattform.md)', () => {
  it('zuruecksetzen_befehl_aus_der_doku: leert Geheimnis, Entwurf und Schritt des Kontos, hebt die Bestätigung seiner Sessions auf, lässt andere Konten stehen; danach ist er neu einrichtbar', () => {
    expect(SKRIPT, 'node -e-Befehl in docs/sicherheitsplattform.md').not.toBeNull();
    const verzeichnis = mkdtempSync(join(tmpdir(), 'zf-zuruecksetzen-'));
    try {
      const { jan, sJan, sGabi } = anlegen(verzeichnis);
      const vorher = openDb(join(verzeichnis, 'middleware.db'));
      expect(new ZweiterFaktorStore(vorher).istBestaetigt(sJan.token, JETZT)).toBe(true);
      vorher.close();

      const ergebnis = ausfuehren(verzeichnis, 'jan@example.test'); // anders geschrieben als das Konto
      expect(ergebnis.code, ergebnis.fehler).toBe(0);
      expect(ergebnis.aus).toContain('Zweiter Faktor zurückgesetzt für jan@example.test');

      const db = openDb(join(verzeichnis, 'middleware.db'));
      const zeile = (email: string) => db.prepare(
        'SELECT totp_geheimnis, totp_entwurf, totp_entwurf_session, totp_letzter_schritt FROM users WHERE email = ?',
      ).get(email);
      expect(zeile('Jan@Example.test')).toEqual({ totp_geheimnis: null, totp_entwurf: null, totp_entwurf_session: null, totp_letzter_schritt: null });
      expect(zeile('gabi@example.test')).toMatchObject({ totp_geheimnis: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', totp_letzter_schritt: 59000000 });
      const store = new ZweiterFaktorStore(db);
      expect(store.istBestaetigt(sJan.token, JETZT)).toBe(false); // gesperrt
      expect(store.istBestaetigt(sGabi.token, JETZT)).toBe(true); // das andere Konto bleibt bestätigt
      expect(db.prepare('SELECT zweiter_faktor_bis FROM sessions WHERE user_id = ?').all(jan.id)).toEqual([{ zweiter_faktor_bis: null }]);
      // neu einrichtbar: die Seite bekommt für diese Session wieder einen Entwurf
      expect(store.entwurfBereitstellen(jan.id, sJan.token, 'NEUESGEHEIMNISNEUESGEHEIMNIS2345')).toEqual({ entwurf: 'NEUESGEHEIMNISNEUESGEHEIMNIS2345', ereignis: 'angelegt' });
      db.close();
    } finally {
      rmSync(verzeichnis, { recursive: true, force: true });
    }
  });

  it('ohne_konto_oder_datenbank_bricht_er_ab: nennt den Grund, ändert nichts und legt keine leere Datenbank an', () => {
    const verzeichnis = mkdtempSync(join(tmpdir(), 'zf-zuruecksetzen-'));
    try {
      const ohneDatenbank = ausfuehren(verzeichnis, 'jan@example.test');
      expect(ohneDatenbank.code).toBe(1);
      expect(ohneDatenbank.fehler).toContain('keine Datenbank');
      expect(existsSync(join(verzeichnis, 'middleware.db'))).toBe(false);

      anlegen(verzeichnis);
      const fremd = ausfuehren(verzeichnis, 'niemand@example.test');
      expect(fremd.code).toBe(1);
      expect(fremd.fehler).toContain('Kein Konto niemand@example.test');
      const db = openDb(join(verzeichnis, 'middleware.db'));
      expect(db.prepare('SELECT COUNT(*) AS n FROM users WHERE totp_geheimnis IS NOT NULL').get()).toEqual({ n: 2 });
      db.close();
    } finally {
      rmSync(verzeichnis, { recursive: true, force: true });
    }
  });
});
