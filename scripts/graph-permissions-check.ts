/**
 * Zeigt, welche Microsoft-Graph-Berechtigungen der App-Registrierung
 * tatsächlich erteilt sind – ohne etwas zu verändern.
 *
 * Holt ein App-Token (Client Credentials) und liest dessen "roles"-Claim:
 * darin stehen exakt die Application Permissions, denen ein Admin
 * zugestimmt hat.
 *
 *   npx tsx scripts/graph-permissions-check.ts
 *
 * Benötigt MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET (.env bzw. Server-Env).
 */
import 'dotenv/config';
import fetch from 'node-fetch';

async function main() {
  const { MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET } = process.env;
  if (!MS_TENANT_ID || !MS_CLIENT_ID || !MS_CLIENT_SECRET) {
    console.error('❌ MS_TENANT_ID, MS_CLIENT_ID und MS_CLIENT_SECRET müssen gesetzt sein (.env)');
    process.exit(1);
  }

  const res = await fetch(`https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: MS_CLIENT_ID,
      client_secret: MS_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
    }).toString(),
  });

  if (!res.ok) {
    console.error(`❌ Token-Anfrage fehlgeschlagen (${res.status}):`);
    console.error(await res.text());
    console.error('\nHinweis: "invalid_client" deutet oft auf ein abgelaufenes Client-Secret hin.');
    process.exit(1);
  }

  const { access_token } = await res.json() as { access_token: string };
  const payload = JSON.parse(Buffer.from(access_token.split('.')[1], 'base64url').toString('utf-8'));
  const roles: string[] = (payload.roles || []).sort();

  console.log('─── App-Registrierung ───────────────────────────────');
  console.log(`App (Client-ID): ${payload.appid}`);
  console.log(`Tenant:          ${payload.tid}`);
  console.log('');
  console.log('─── Erteilte Application Permissions (roles) ────────');
  if (roles.length === 0) {
    console.log('(keine – der Admin-Consent fehlt vermutlich noch)');
  }
  for (const role of roles) console.log(`  • ${role}`);
  console.log('');

  console.log('─── Einordnung ──────────────────────────────────────');
  if (roles.includes('Mail.Send')) {
    console.log('✅ Mail.Send ist erteilt – die Zeiterfassungs-Mails können ohne weitere Azure-Schritte versendet werden.');
  } else {
    console.log('ℹ️  Mail.Send fehlt – für die Zeiterfassungs-Mails in Entra ergänzen (+ Admin Consent).');
  }
  const broad = roles.filter(r => /^(Mail|MailboxSettings|Calendars|Contacts)\./.test(r));
  if (broad.length > 0) {
    console.log('');
    console.log('⚠️  WICHTIG: Application Permissions wie ' + broad.join(', ') + ' gelten');
    console.log('   standardmäßig für ALLE Postfächer im Tenant – nicht nur für das');
    console.log('   Middleware-Postfach. Empfehlung: Zugriff per Exchange Application');
    console.log('   Access Policy auf das eine Postfach einschränken (siehe');
    console.log('   docs/architektur-review-2026-07.md bzw. README-Hinweis).');
    console.log('');
    console.log('   Prüfen, ob bereits eine Policy greift (Exchange Online PowerShell):');
    console.log(`   Test-ApplicationAccessPolicy -AppId ${payload.appid} -Identity <beliebige@straightup-digital.de>`);
  }
}

main().catch(e => {
  console.error('❌ Prüfung fehlgeschlagen:', e.message);
  process.exit(1);
});
