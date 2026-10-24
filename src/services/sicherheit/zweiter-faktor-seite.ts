// ─── Seiten für den zweiten Faktor ───────────────────────────────
//
// Serverseitig gerendertes HTML wie /teamboard: ein Dokument mit eingebettetem
// Stil, ohne Skript und ohne etwas von fremden Origins (die CSP der App in
// index.ts erlaubt nur die eigene Origin und Inline-Stil). Reine Funktionen
// ohne Zugriff auf Anfrage oder Datenbank. Alles Dynamische (E-Mail-Adresse,
// Schlüssel, Meldungen) geht durch `h`: nichts davon wird je als HTML
// eingesetzt.

const AUSSTELLER = 'straightup Sicherheit';

const h = (text: string): string => text
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

/** Das Geheimnis in Vierergruppen, so tippt man es aus der Anzeige ab. */
const vierergruppen = (geheimnis: string): string => geheimnis.match(/.{1,4}/g)?.join(' ') ?? '';

/**
 * Die Adresse, die eine Authenticator-App aus einem QR-Code läse (Key-URI-Format
 * von Google Authenticator), hier zum Abtippen oder Kopieren. Die Adresse der
 * E-Mail wird kodiert bis auf das @, das in einem Pfad stehen darf.
 */
function otpauthAdresse(email: string, geheimnis: string): string {
  const aussteller = encodeURIComponent(AUSSTELLER);
  const konto = encodeURIComponent(email).replace(/%40/g, '@');
  return `otpauth://totp/${aussteller}:${konto}?secret=${geheimnis}&issuer=${aussteller}&algorithm=SHA1&digits=6&period=30`;
}

const STIL = `
:root { color-scheme: light dark; --hg: #f5f5f5; --karte: #ffffff; --text: #1a1a1a; --leise: #5f6368; --linie: #d9dce1; --akzent: #0b5fff; --akzent-text: #ffffff; --fehler: #b3261e; --fehler-hg: #fbe9e7; --code-hg: #eef0f3; }
@media (prefers-color-scheme: dark) { :root { --hg: #14161a; --karte: #1d2026; --text: #e6e8eb; --leise: #9aa1ab; --linie: #343a44; --akzent: #6ea0ff; --akzent-text: #0d1117; --fehler: #ffb4ab; --fehler-hg: #3a1f1d; --code-hg: #262b33; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: var(--hg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.5; }
main { max-width: 34rem; margin: 0 auto; padding: 2rem 1rem; }
section { background: var(--karte); border: 1px solid var(--linie); border-radius: 12px; padding: 1.5rem; }
h1 { font-size: 1.4rem; margin: 0 0 .75rem; }
p { margin: 0 0 1rem; }
.leise { color: var(--leise); font-size: .9rem; margin: 1rem 0; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: .5rem 1rem; margin: 0 0 1rem; }
dt { color: var(--leise); }
dd { margin: 0; min-width: 0; }
code { display: block; background: var(--code-hg); border-radius: 6px; padding: .4rem .6rem; font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: .95rem; overflow-wrap: anywhere; user-select: all; }
code#geheimnis { font-size: 1.1rem; letter-spacing: .05em; }
label { display: block; font-weight: 600; margin-bottom: .35rem; }
input { width: 100%; padding: .7rem; border: 1px solid var(--linie); border-radius: 8px; background: var(--karte); color: var(--text); font: inherit; font-size: 1.3rem; letter-spacing: .15em; }
input:focus { outline: 2px solid var(--akzent); outline-offset: 1px; }
button { width: 100%; margin-top: 1rem; padding: .75rem; border: 0; border-radius: 8px; background: var(--akzent); color: var(--akzent-text); font: inherit; font-weight: 600; cursor: pointer; }
.meldung { background: var(--fehler-hg); color: var(--fehler); border-radius: 8px; padding: .75rem; }
`;

function seite(titel: string, inhalt: string): string {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${h(titel)} · ${h(AUSSTELLER)}</title>
<style>${STIL}</style>
</head>
<body>
<main>
<section>
${inhalt}
</section>
</main>
</body>
</html>
`;
}

const meldungsAbsatz = (meldung: string | undefined): string =>
  meldung ? `<p class="meldung" role="alert">${h(meldung)}</p>\n` : '';

function formular(aktion: string, knopf: string): string {
  return `<form method="post" action="${h(aktion)}">
<label for="code">Code aus der App</label>
<input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]*" maxlength="10" required autofocus>
<button type="submit">${h(knopf)}</button>
</form>`;
}

/** Noch kein zweiter Faktor eingerichtet: der Schlüssel zum Abtippen in die App und das Feld für den ersten Code. */
export function renderEinrichten(a: { email: string; geheimnis: string; aktion: string; meldung?: string }): string {
  return seite('Zweiten Faktor einrichten', `<h1>Zweiten Faktor einrichten</h1>
<p>Die Sicherheitsplattform ist zusätzlich zum Passwort durch einen Code aus einer Authenticator-App geschützt. Lege in der App einen neuen Eintrag mit diesen Angaben an und gib danach den Code ein, den die App zeigt.</p>
<dl>
<dt>Konto</dt><dd>${h(a.email)}</dd>
<dt>Schlüssel</dt><dd><code id="geheimnis">${h(vierergruppen(a.geheimnis))}</code></dd>
<dt>Art</dt><dd>zeitbasiert, 6 Stellen, alle 30 Sekunden (SHA-1)</dd>
<dt>Adresse</dt><dd><code id="otpauth">${h(otpauthAdresse(a.email, a.geheimnis))}</code></dd>
</dl>
<p class="leise">Den Schlüssel zeigt diese Seite nur, solange noch nichts eingerichtet ist, und nur dieser Anmeldung: Öffnet jemand die Seite in einer anderen Anmeldung, bekommt er einen eigenen neuen Schlüssel, und dieser hier wird ungültig. Groß- und Kleinschreibung und die Leerzeichen sind egal. Die Adresse ist für Apps, die sie als Text annehmen.</p>
${meldungsAbsatz(a.meldung)}${formular(a.aktion, 'Einrichtung abschließen')}`);
}

/** Der zweite Faktor ist eingerichtet: nur das Feld für den Code, nie der Schlüssel. */
export function renderEingabe(a: { email: string; aktion: string; meldung?: string }): string {
  return seite('Zweiter Faktor', `<h1>Zweiter Faktor</h1>
<p>Gib den aktuellen Code aus deiner Authenticator-App ein, um die Sicherheitsplattform zu öffnen. Die Bestätigung gilt 12 Stunden.</p>
${meldungsAbsatz(a.meldung)}${formular(a.aktion, 'Bestätigen')}
<p class="leise">Angemeldet als ${h(a.email)}.</p>`);
}

/** Eine Seite ohne Formular für Antworten, die nichts weiter erlauben (kein Zugang, nicht eingerichtet, Fehler). */
export function renderHinweis(text: string): string {
  return seite('Zweiter Faktor', `<h1>Zweiter Faktor</h1>
<p>${h(text)}</p>`);
}
