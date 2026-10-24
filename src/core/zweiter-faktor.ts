import { DatabaseSync } from 'node:sqlite';
import { tokenHash } from './sessions.js';

// ─── Zweiter Faktor: was gespeichert wird ────────────────────────
//
// Der TOTP-Schritt für /sicherheit hält drei Dinge fest (Migration v6, core/db.ts):
//
//  Je Konto (users): das eingerichtete Geheimnis, der Entwurf, den die
//  Einrichtung gerade zeigt, und der Zeitschritt des zuletzt angenommenen
//  Codes. Ein Code gilt nur einmal: angenommen wird nur ein Schritt, der
//  größer ist als der gemerkte.
//
//  Der Entwurf gehört der Session, die ihn angelegt hat (ihr Token-Hash steht
//  daneben). Nur diese Session sieht ihn wieder, und nur sie kann ihn mit einem
//  Code zum Geheimnis machen. Ruft eine andere Session des Kontos die
//  Einrichtung auf, bekommt sie einen neuen Entwurf, und der alte ist
//  hinfällig. Wer das Passwort kennt und die Seite aufruft, bevor Jan fertig
//  ist, sieht so nie den Schlüssel, den Jan in seine App tippt, und hat nach
//  Jans Einrichtung keinen gültigen Code.
//
//  Je Session (sessions): bis wann sie als bestätigt gilt. Der Merker steht in
//  der Zeile der Session. Wer die Session löscht (Abmelden, Passwortwechsel,
//  Ablauf), beendet die Bestätigung deshalb mit. Wer eine Einrichtung
//  abschließt, löscht die Bestätigungen aller Sessions des Kontos und
//  bestätigt nur die eigene: Bestätigungen aus der Zeit vor einem Zurücksetzen
//  gehörten zum alten Geheimnis und leben nicht wieder auf.
//
// Die Geheimnisse liegen wie die Passwort-Hashes nur in dieser Datenbank. Die
// Einrichtungsseite zeigt den Entwurf, solange nichts eingerichtet ist; danach
// verlässt kein Geheimnis die Datenbank mehr. Das Nutzerobjekt (core/users.ts)
// kennt die Spalten nicht, sie landen also in keiner Antwort über Nutzer.

/** So lange gilt ein angenommener Code für die Session, höchstens bis zu ihrem Ablauf. */
const ZWEITER_FAKTOR_GUELTIG_MS = 12 * 60 * 60 * 1000;

/**
 * Was `entwurfBereitstellen` getan hat: `angelegt` (es gab noch keinen),
 * `ersetzt` (der Entwurf einer anderen Session ist hinfällig) oder null (der
 * Entwurf dieser Session stand schon da, geschrieben wurde nichts).
 */
export type EntwurfEreignis = 'angelegt' | 'ersetzt' | null;

interface NutzerZeile {
  totp_geheimnis: string | null;
  totp_entwurf: string | null;
  totp_entwurf_session: string | null;
}

export class ZweiterFaktorStore {
  constructor(private db: DatabaseSync) {}

  private zeile(userId: string): NutzerZeile | undefined {
    return this.db.prepare('SELECT totp_geheimnis, totp_entwurf, totp_entwurf_session FROM users WHERE id = ?')
      .get(userId) as NutzerZeile | undefined;
  }

  /**
   * Das eingerichtete Geheimnis des Kontos und den Entwurf dieser Session
   * (Base32), je null, wenn es keins gibt. Der Entwurf einer anderen Session
   * zählt hier nicht: er gehört ihr.
   */
  zustand(userId: string, token: string): { geheimnis: string | null; entwurf: string | null } {
    const row = this.zeile(userId);
    const eigener = row?.totp_entwurf_session === tokenHash(token);
    return { geheimnis: row?.totp_geheimnis ?? null, entwurf: eigener ? (row?.totp_entwurf ?? null) : null };
  }

  /**
   * Der Entwurf, den die Einrichtung dieser Session zeigt. Hat die Session
   * schon einen, bleibt er und es wird nichts geschrieben. Sonst wird `neu` ihr
   * Entwurf, und ein vorhandener Entwurf einer anderen Session ist damit
   * hinfällig (`ereignis` sagt, was geschah, damit der Aufrufer es protokollieren
   * kann). Ist schon ein Geheimnis eingerichtet, gibt es keinen Entwurf: null.
   */
  entwurfBereitstellen(userId: string, token: string, neu: string): { entwurf: string; ereignis: EntwurfEreignis } | null {
    const row = this.zeile(userId);
    if (!row || row.totp_geheimnis !== null) return null;
    const hash = tokenHash(token);
    if (row.totp_entwurf !== null && row.totp_entwurf_session === hash) return { entwurf: row.totp_entwurf, ereignis: null };
    this.db.prepare('UPDATE users SET totp_entwurf = ?, totp_entwurf_session = ? WHERE id = ?').run(neu, hash, userId);
    return { entwurf: neu, ereignis: row.totp_entwurf === null ? 'angelegt' : 'ersetzt' };
  }

  /**
   * Schließt die Einrichtung ab, nachdem ein Code zum Entwurf dieser Session
   * gestimmt hat: der Entwurf wird das Geheimnis, der Schritt des Codes wird
   * gemerkt (der Code ist damit verbraucht), die Bestätigungen aller Sessions
   * des Kontos enden, und nur diese Session gilt als bestätigt. Alles oder
   * nichts. false, wenn es inzwischen ein Geheimnis gibt, der Entwurf ein
   * anderer ist als der geprüfte oder er einer anderen Session gehört.
   */
  richteEin(userId: string, token: string, entwurf: string, schritt: number, jetzt: Date): boolean {
    return this.alsEinheit(() => {
      const ergebnis = this.db.prepare(
        `UPDATE users SET totp_geheimnis = totp_entwurf, totp_entwurf = NULL, totp_entwurf_session = NULL, totp_letzter_schritt = ?
         WHERE id = ? AND totp_geheimnis IS NULL AND totp_entwurf = ? AND totp_entwurf_session = ?`,
      ).run(schritt, userId, entwurf, tokenHash(token));
      if (Number(ergebnis.changes) === 0) return false;
      this.db.prepare('UPDATE sessions SET zweiter_faktor_bis = NULL WHERE user_id = ?').run(userId);
      return this.bestaetigeSession(token, jetzt);
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
