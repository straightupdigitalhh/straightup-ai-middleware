/**
 * Dry-Run der Zeiterfassungs-Automation gegen die echte awork-API.
 * Versendet NICHTS – zeigt nur, was verschickt würde.
 *
 *   npx tsx scripts/timetracking-dry-run.ts            → vorheriger Werktag
 *   npx tsx scripts/timetracking-dry-run.ts 2026-07-03 → bestimmter Tag
 *
 * Benötigt AWORK_API_TOKEN in .env.
 */
import 'dotenv/config';
import { AworkClient, aworkUserEmail } from '../src/services/awork.js';
import { previousWorkday, todayInBerlin, isWorkday } from '../src/services/workdays.js';
import {
  summarizeByUser, renderPersonalEmail, renderDigestEmail, displayName, formatHours,
} from '../src/services/timetracking.js';
import { stripHtml } from '../src/services/microsoft-graph.js';

async function main() {
  if (!process.env.AWORK_API_TOKEN) {
    console.error('❌ AWORK_API_TOKEN fehlt (.env)');
    process.exit(1);
  }

  const today = todayInBerlin();
  const day = process.argv[2] || previousWorkday(today);
  console.log(`Heute: ${today} (Werktag: ${isWorkday(today) ? 'ja' : 'nein'}) → Berichtstag: ${day}\n`);

  const awork = new AworkClient(process.env.AWORK_API_TOKEN);
  const users = (await awork.getUsers()).filter(u => !u.isDeactivated && !u.isArchived);
  const entries = await awork.getTimeEntriesForDay(day);
  console.log(`${users.length} aktive Nutzer, ${entries.length} Zeiteinträge am ${day}\n`);

  const summaries = summarizeByUser(entries);

  console.log('─── Übersicht ───────────────────────────────────────');
  for (const user of users) {
    const summary = summaries.get(user.id);
    const email = aworkUserEmail(user) || '⚠ KEINE E-MAIL in awork';
    console.log(`${displayName(user).padEnd(25)} ${formatHours(summary?.totalSeconds || 0).padStart(8)}   ${email}`);
  }

  console.log('\n─── Beispiel: persönliche Mail (erster Nutzer) ──────');
  if (users.length > 0) {
    const u = users[0];
    const mail = renderPersonalEmail(u.firstName || displayName(u), day, summaries.get(u.id), 8);
    console.log(`Betreff: ${mail.subject}\n`);
    console.log(stripHtml(mail.html));
  }

  console.log('\n─── Digest ──────────────────────────────────────────');
  const digest = renderDigestEmail(day, users, summaries);
  console.log(`Betreff: ${digest.subject}\n`);
  console.log(stripHtml(digest.html));
}

main().catch(e => {
  console.error('❌ Dry-Run fehlgeschlagen:', e.message);
  console.error('   (Hinweis: Falls der timeentries-Filter abgelehnt wird, bitte Fehlertext prüfen – Feldname/Syntax ggf. anpassen)');
  process.exit(1);
});
