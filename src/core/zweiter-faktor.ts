import { DatabaseSync } from 'node:sqlite';
import { tokenHash } from './sessions.js';

// ─── Zweiter Faktor: was gespeichert wird ────────────────────────
//
// Der TOTP-Schritt für /sicherheit hält zwei Dinge fest (Migration v6, core/db.ts):
//
//  Je Konto (users): das eingerichtete Geheimnis, der Entwurf, den die
//  Einrichtung gerade zeigt, und der Zeitschritt des zuletzt angenommenen
//  Codes. Ein Code gilt nur einmal: angenommen wird nur ein Schritt, der
//  größer ist als der gemerkte.
//
//  Je Session (sessions): bis wann sie als bestätigt gilt. Der Merker steht in
//  der Zeile der Session. Wer die Session löscht (Abmelden, Passwortwechsel,
//  Ablauf), beendet die Bestätigung deshalb mit.
//
// Die Geheimnisse liegen wie die Passwort-Hashes nur in dieser Datenbank. Die
// Einrichtungsseite zeigt den Entwurf, solange nichts eingerichtet ist; danach
// verlässt kein Geheimnis die Datenbank mehr. Das Nutzerobjekt (core/users.ts)
// kennt die Spalten nicht, sie landen also in keiner Antwort über Nutzer.

/** So lange gilt ein angenommener Code für die Session, höchstens bis zu ihrem Ablauf. */
const ZWEITER_FAKTOR_GUELTIG_MS = 12 * 60 * 60 * 1000;

export class ZweiterFaktorStore {
  constructor(private db: DatabaseSync) {}

  /** Das eingerichtete Geheimnis und den Entwurf des Kontos (Base32), je null, wenn es keins gibt. */
  zustand(userId: string): { geheimnis: string | null; entwurf: string | null } {
    const row = this.db.prepare('SELECT totp_geheimnis, totp_entwurf FROM users WHERE id = ?')
      .get(userId) as { totp_geheimnis: string | null; totp_entwurf: string | null } | undefined;
    return { geheimnis: row?.totp_geheimnis ?? null, entwurf: row?.totp_entwurf ?? null };
  }

  /**
   * Der Entwurf, den die Einrichtung zeigt. Ein vorhandener bleibt, er wird nie
   * überschrieben (die App und die Seite sollen dasselbe Geheimnis haben);
   * gibt es keinen, wird `neu` der Entwurf. Ist schon ein Geheimnis
   * eingerichtet, gibt es keinen Entwurf: null.
   */
  entwurfBereitstellen(userId: string, neu: string): string | null {
    this.db.prepare(
      'UPDATE users SET totp_entwurf = ? WHERE id = ? AND totp_geheimnis IS NULL AND totp_entwurf IS NULL',
    ).run(neu, userId);
    const { geheimnis, entwurf } = this.zustand(userId);
    return geheimnis === null ? entwurf : null;
  }

  /**
   * Schließt die Einrichtung ab, nachdem ein Code zum Entwurf gestimmt hat: der
   * Entwurf wird das Geheimnis, der Schritt des Codes wird gemerkt (der Code
   * ist damit verbraucht) und die Session gilt als bestätigt. Alles oder
   * nichts. false, wenn es inzwischen ein Geheimnis gibt oder der Entwurf ein
   * anderer ist als der, gegen den der Code geprüft wurde.
   */
  richteEin(userId: string, token: string, entwurf: string, schritt: number, jetzt: Date): boolean {
    return this.alsEinheit(() => {
      const ergebnis = this.db.prepare(
        `UPDATE users SET totp_geheimnis = totp_entwurf, totp_entwurf = NULL, totp_letzter_schritt = ?
         WHERE id = ? AND totp_geheimnis IS NULL AND totp_entwurf = ?`,
      ).run(schritt, userId, entwurf);
      return Number(ergebnis.changes) > 0 && this.bestaetigeSession(token, jetzt);
    });
  }

  /**
   * Nimmt einen Code für das eingerichtete Geheimnis an: merkt den Schritt und
   * bestätigt die Session. false, wenn der Schritt nicht größer ist als der
   * zuletzt angenommene (derselbe Code zweimal gilt nicht, auch nicht aus einer
   * anderen Session) oder es kein Geheimnis gibt. Die Bedingung steht im UPDATE,
   * nicht davor: zwei gleichzeitige Eingaben desselben Codes nimmt nur eine an.
   */
  bestaetige(userId: string, token: string, schritt: number, jetzt: Date): boolean {
    return this.alsEinheit(() => {
      const ergebnis = this.db.prepare(
        `UPDATE users SET totp_letzter_schritt = ?
         WHERE id = ? AND totp_geheimnis IS NOT NULL AND (totp_letzter_schritt IS NULL OR totp_letzter_schritt < ?)`,
      ).run(schritt, userId, schritt);
      return Number(ergebnis.changes) > 0 && this.bestaetigeSession(token, jetzt);
    });
  }

  /**
   * Gilt die Session zu diesem Token jetzt als bestätigt? Nein, wenn es sie
   * nicht mehr gibt, ihr Konto kein Geheimnis (mehr) hat oder die Zeit um ist:
   * Wer das Geheimnis zurücksetzt (Spalte auf NULL), sperrt damit auch die
   * Sessions, die schon bestätigt waren.
   */
  istBestaetigt(token: string, jetzt: Date): boolean {
    const row = this.db.prepare(
      `SELECT s.zweiter_faktor_bis AS bis FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND u.totp_geheimnis IS NOT NULL`,
    ).get(tokenHash(token)) as { bis: string | null } | undefined;
    return row !== undefined && row.bis !== null && Date.parse(row.bis) > jetzt.getTime();
  }

  /** Setzt "bestätigt bis" auf 12 Stunden ab jetzt, höchstens auf den Ablauf der Session. */
  private bestaetigeSession(token: string, jetzt: Date): boolean {
    const bis = new Date(jetzt.getTime() + ZWEITER_FAKTOR_GUELTIG_MS).toISOString();
    const ergebnis = this.db.prepare('UPDATE sessions SET zweiter_faktor_bis = MIN(expires_at, ?) WHERE token_hash = ?')
      .run(bis, tokenHash(token));
    return Number(ergebnis.changes) > 0;
  }

  /** Führt die Arbeit in einer Transaktion aus: bei false oder einem Fehler bleibt alles, wie es war. */
  private alsEinheit(arbeit: () => boolean): boolean {
    this.db.exec('BEGIN');
    try {
      const ok = arbeit();
      this.db.exec(ok ? 'COMMIT' : 'ROLLBACK');
      return ok;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
}
