/**
 * Entwicklungsstand für die Seite /sicherheit: die Middleware lokal mit dem
 * Beispiel-Stand des Kerns (test/fixtures/sicherheit-stand.json), ohne Kern,
 * ohne awork und ohne Mail. Eine eigene Test-Datenbank unter os.tmpdir(), nie
 * data/; die Zugänge stehen in .sicherheit-dev/zugang.json (git-ignoriert).
 *
 *   npx tsx scripts/sicherheit-dev.ts anlegen       → Datenbank neu: ein Konto aus SICHERHEIT_NUTZER mit
 *                                                     zufälligem Passwort und TOTP-Geheimnis, ein fremdes
 *                                                     Konto (für 403), der Beispiel-Stand
 *   npx tsx scripts/sicherheit-dev.ts start [--alter 130]
 *                                                   → Middleware auf Port 3591 (legt an, wenn nötig); der
 *                                                     Stand gilt als gerade empfangen, mit --alter als so
 *                                                     viele Minuten alt (ab 120 ist die Kopfzeile rot)
 *   npx tsx scripts/sicherheit-dev.ts code          → der aktuelle Code der Authenticator-App
 *   npx tsx scripts/sicherheit-dev.ts quittieren [--fehler]
 *                                                   → spielt den Kern: quittiert alle offenen Aufträge
 *                                                     (angewandt, mit --fehler abgelehnt) und schiebt den
 *                                                     Stand neu
 *
 * Gibt nie ein Passwort, Geheimnis oder einen Schlüssel aus, nur Pfade und Zahlen.
 */
import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { openDb } from '../src/core/db.js';
import { totpCode, neuesTotpGeheimnis } from '../src/core/totp.js';
import { UserStore } from '../src/core/users.js';
import { SicherheitSpeicher } from '../src/services/sicherheit/speicher.js';

const WURZEL = resolve(__dirname, '..');
const DATEN = join(tmpdir(), 'straightup-sicherheit-dev');
const DATENBANK = join(DATEN, 'middleware.db');
const ZUGANG = join(WURZEL, '.sicherheit-dev', 'zugang.json');
const BEISPIEL = join(WURZEL, 'test', 'fixtures', 'sicherheit-stand.json');
const PORT = 3591;

interface Zugang {
  hinweis: string;
  adresse: string;
  email: string;
  passwort: string;
  totpGeheimnis: string;
  fremdEmail: string;
  fremdPasswort: string;
  dienstSchluessel: string;
  apiKey: string;
  datenbank: string;
  port: number;
}

const zufall = (bytes: number) => randomBytes(bytes).toString('base64url');
const beispielStand = (): Record<string, unknown> => JSON.parse(readFileSync(BEISPIEL, 'utf-8'));

function leseZugang(): Zugang {
  if (!existsSync(ZUGANG)) throw new Error(`${ZUGANG} fehlt: zuerst "npx tsx scripts/sicherheit-dev.ts anlegen".`);
  return JSON.parse(readFileSync(ZUGANG, 'utf-8')) as Zugang;
}

/** Speichert den Beispiel-Stand, als wäre er vor `alterMinuten` angekommen. */
function standSpeichern(alterMinuten: number): void {
  const db = openDb(DATENBANK);
  new SicherheitSpeicher(db).speichereStand(beispielStand(), new Date(Date.now() - alterMinuten * 60_000));
  db.close();
}

function anlegen(): void {
  mkdirSync(DATEN, { recursive: true });
  for (const datei of ['middleware.db', 'middleware.db-wal', 'middleware.db-shm', 'feedback-keys.json']) rmSync(join(DATEN, datei), { force: true });
  const db = openDb(DATENBANK);
  const users = new UserStore(db);
  const zugang: Zugang = {
    hinweis: 'Nur für die lokale Entwicklung (scripts/sicherheit-dev.ts). Nicht weitergeben, nicht einchecken.',
    adresse: `http://localhost:${PORT}/sicherheit`,
    email: 'pruefer@sicherheit-dev.test',
    passwort: zufall(18),
    totpGeheimnis: neuesTotpGeheimnis(),
    fremdEmail: 'fremd@sicherheit-dev.test',
    fremdPasswort: zufall(18),
    dienstSchluessel: zufall(32),
    apiKey: zufall(32),
    datenbank: DATENBANK,
    port: PORT,
  };
  const pruefer = users.create({ email: zugang.email, name: 'Prüfkonto Sicherheit', role: 'admin', password: zugang.passwort });
  users.create({ email: zugang.fremdEmail, name: 'Fremdes Konto', role: 'admin', password: zugang.fremdPasswort });
  // Eingerichtet wie nach /sicherheit/zweiter-faktor; bestätigen muss jede Anmeldung trotzdem mit einem Code.
  db.prepare('UPDATE users SET totp_geheimnis = ? WHERE id = ?').run(zugang.totpGeheimnis, pruefer.id);
  db.close();
  standSpeichern(0);
  mkdirSync(join(WURZEL, '.sicherheit-dev'), { recursive: true });
  writeFileSync(ZUGANG, `${JSON.stringify(zugang, null, 2)}\n`, { mode: 0o600 });
  console.log(`Datenbank: ${DATENBANK}`);
  console.log(`Zugänge:   ${ZUGANG}`);
}

async function start(alterMinuten: number): Promise<void> {
  if (!existsSync(ZUGANG) || !existsSync(DATENBANK)) anlegen();
  const z = leseZugang();
  standSpeichern(alterMinuten);
  // Nur was diese Middleware braucht; was nach außen ginge (Graph, Mail-Relay), bleibt aus. Keine .env aus dem Worktree.
  for (const name of ['MS_TENANT_ID', 'MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'MS_MAILBOXES', 'MS_USER_EMAIL', 'MS_SENDER_EMAIL', 'MAIL_RELAY_KEY', 'ADMIN_EMAIL', 'ADMIN_INITIAL_PASSWORD', 'FEEDBACK_DATA_DIR']) {
    delete process.env[name];
  }
  Object.assign(process.env, {
    DOTENV_CONFIG_PATH: join(DATEN, 'keine.env'),
    DATA_DIR: DATEN,
    PORT: String(z.port),
    API_KEY: z.apiKey,
    AWORK_API_TOKEN: 'entwicklung-ohne-awork',
    ANTHROPIC_API_KEY: 'entwicklung-ohne-anthropic',
    SICHERHEIT_DIENSTSCHLUESSEL: z.dienstSchluessel,
    SICHERHEIT_NUTZER: z.email,
  });
  process.chdir(WURZEL); // index.ts sucht das Hub-Frontend unter web/dist
  console.log(`🛡️ Entwicklungsstand: ${z.adresse} (Zugänge in ${ZUGANG})`);
  await import('../src/index.js');
}

async function quittieren(ok: boolean): Promise<void> {
  const z = leseZugang();
  const basis = `http://127.0.0.1:${z.port}/api/sicherheit`;
  const kopf = { 'X-Dienst-Schluessel': z.dienstSchluessel, Accept: 'application/json', 'Content-Type': 'application/json' };
  const offen = await fetch(`${basis}/auftraege?offen=1`, { headers: kopf });
  if (!offen.ok) throw new Error(`Aufträge nicht geholt: Status ${offen.status}`);
  const { auftraege } = (await offen.json()) as { auftraege: { id: string; art: string; site: string }[] };
  for (const a of auftraege) {
    const text = `Entwicklung: ${a.art} für ${a.site} ${ok ? 'als angewandt' : 'als abgelehnt'} quittiert; der Beispiel-Stand bleibt, wie er ist.`;
    const antwort = await fetch(`${basis}/auftraege/${encodeURIComponent(a.id)}/quittung`, { method: 'POST', headers: kopf, body: JSON.stringify({ ok, text }) });
    if (!antwort.ok) throw new Error(`Quittung nicht angenommen: Status ${antwort.status}`);
  }
  const stand = await fetch(`${basis}/stand`, { method: 'POST', headers: kopf, body: JSON.stringify(beispielStand()) });
  if (!stand.ok) throw new Error(`Stand nicht geschoben: Status ${stand.status}`);
  console.log(`${auftraege.length} ${auftraege.length === 1 ? 'Auftrag' : 'Aufträge'} quittiert (${ok ? 'angewandt' : 'abgelehnt'}), Stand neu geschoben.`);
}

async function main(): Promise<void> {
  const [befehl, ...rest] = process.argv.slice(2);
  if (befehl === 'anlegen') return anlegen();
  if (befehl === 'start') {
    const i = rest.indexOf('--alter');
    const alter = i >= 0 ? Number(rest[i + 1]) : 0;
    if (!Number.isFinite(alter) || alter < 0) throw new Error('--alter erwartet Minuten (0 oder mehr).');
    return start(alter);
  }
  if (befehl === 'code') {
    console.log(totpCode(leseZugang().totpGeheimnis, Date.now()));
    return;
  }
  if (befehl === 'quittieren') return quittieren(!rest.includes('--fehler'));
  console.error('Aufruf: npx tsx scripts/sicherheit-dev.ts anlegen | start [--alter <Minuten>] | code | quittieren [--fehler]');
  process.exit(1);
}

main().catch((err) => {
  console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
