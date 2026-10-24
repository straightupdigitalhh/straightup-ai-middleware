// ─── Darstellung der Seite /sicherheit (Teil 1) ──────────────────
//
// Reine Funktionen für das Skript der Seite: Texte, Zuordnungen, die Formen der
// Aufträge und die Rückmeldung mit Obergrenze. Sie laufen in den Tests auf dem
// Server und stehen als Text im Skript der Seite (seite.ts bettet jede Funktion
// aus DARSTELLUNG_FUNKTIONEN per String(fn) ein). Deshalb gilt für jede davon:
//
//  - nur ihre Parameter, Literale und die anderen Funktionen dieser Liste; nichts
//    aus dem Modul (im Browser gibt es den Modul-Rahmen nicht);
//  - keine benannten Funktionswerte im Rumpf, weder `function name()` noch
//    `var f = function` oder `const f = () =>` noch Methoden in Objekten:
//    tsx (esbuild mit keepNames) setzte sonst `__name(...)` davor, und das gibt es
//    im Browser nicht. Rückrufe gehen als namenlose `function (x) {}` in die
//    Aufrufe (Muster und Begründung wie in services/teamboard/seite.ts);
//  - nur Sprachmittel, die Browser und Node gleich können.
//
// Das Format des Stands gehört dem Kern (wachdienst/stand.ts im Repo agents); die
// Typen hier bilden nur ab, was die Seite liest. Daten werden nie als HTML
// eingesetzt, das Skript baut alles mit textContent auf.

export type AmpelWert = 'rot' | 'gelb' | 'gruen' | 'grau';

export interface LageZeile {
  befundId: number;
  typ: string;
  klasse: 'alarm' | 'befund';
  /** Die Site, bei einem Sammelbefund `_alle`, bei einer Quelle `_quelle:<name>`. */
  site: string;
  titel: string;
  text: string;
  seitIso: string;
  liegezeitTage: number;
  status: 'offen' | 'stumm';
  stummBisIso: string | null;
  mitglieder: string[];
}

export interface Kunde { kundeNr: string; firma: string }
export interface Vertrag { aktiv: boolean; bisIso: string | null }
export interface Merker { vip?: boolean; fremdhosting?: boolean; kein_ssh_moeglich?: boolean; pause_bis?: string }

/** Eine Installation der Flotte, so weit die Seite sie liest. */
export interface FlottenZeile {
  id: string;
  site: string;
  domains?: string[];
  kunde?: Kunde | null;
  stufe?: string | null;
  stufeQuelle?: string | null;
  bestaetigt?: boolean;
  merker?: Merker | null;
  welt?: string;
  server?: string | null;
  account?: string | null;
  pfad?: string | null;
  cms?: string | null;
  version?: string | null;
  php?: string | null;
  ampel?: string;
  grund?: string;
}

export interface Runde { id: number; beendetIso: string; quellen: { ok: number; ausgefallen: string[] } }
export interface QuellenZustand { quelle: string; ok: boolean; grund: string | null; dauerMs: number; ausfallserie: number }

/** Der Körper von POST /api/sicherheit/auftraege. */
export interface AuftragKoerper { art: string; site: string; typ?: string; werte: Record<string, unknown> }

/**
 * Ein Auftrag, den diese Seite geschickt hat. `ziel` sagt, wo er angezeigt wird
 * (z. B. `lage:3`, `site:kunde.de:stufe`); `gesendetMs` ist die Uhr des Browsers.
 */
export interface SeitenAuftrag {
  id: string;
  ziel: string;
  gesendetMs: number;
  /** Aus dem Verlauf der Middleware, sobald die Seite ihn dort gesehen hat. */
  erstelltIso: string | null;
  status: 'laeuft' | 'angewandt' | 'fehler' | 'still';
  text: string;
  quittiertIso: string | null;
}

/** Eine Zeile aus GET /api/sicherheit/auftraege. */
export interface VerlaufEintrag {
  id: string;
  erstelltIso: string;
  status: string;
  quittungText: string | null;
  quittiertIso: string | null;
}

export interface FlottenFilter { ampel: string; welt: string; stufe: string; suche: string }

// ─── Wörter und Zahlen ───────────────────────────────────────────

export function zahlWort(n: number, einzahl: string, mehrzahl: string): string {
  return n + ' ' + (n === 1 ? einzahl : mehrzahl);
}

/** Die Ampel des Stands als Wort. Was der Stand nicht kennt, ist grau: grün nur, wenn der Kern es sagt. */
export function ampelText(ampel: unknown): string {
  if (ampel === 'rot' || ampel === 'gelb' || ampel === 'grau') return ampel;
  if (ampel === 'gruen') return 'grün';
  return 'grau';
}

/** Reihenfolge zum Sortieren: rot, gelb, grau, grün. */
export function ampelRang(ampel: unknown): number {
  var wort = ampelText(ampel);
  return wort === 'rot' ? 0 : wort === 'gelb' ? 1 : wort === 'grau' ? 2 : 3;
}

/** Wie lange ein Eintrag liegt, für „liegt seit …". */
export function liegezeitText(tage: unknown): string {
  if (typeof tage !== 'number' || !Number.isInteger(tage) || tage < 0) return '';
  if (tage === 0) return 'seit heute';
  return tage === 1 ? 'seit 1 Tag' : 'seit ' + tage + ' Tagen';
}

/**
 * Das Alter des Stands für die Kopfzeile. Der Kern schickt alle fünf Minuten
 * einen; ab 120 Minuten ist die Zeile rot. Ohne Stand ist sie es auch.
 */
export function standAlterText(alterMinuten: unknown): { text: string; rot: boolean } {
  if (typeof alterMinuten !== 'number' || !Number.isFinite(alterMinuten) || alterMinuten < 0) {
    return { text: 'Noch kein Stand empfangen', rot: true };
  }
  var m = Math.floor(alterMinuten);
  var wann = '';
  if (m < 1) wann = 'gerade eben';
  else if (m < 60) wann = 'vor ' + zahlWort(m, 'Minute', 'Minuten');
  else if (m < 48 * 60) wann = 'vor ' + zahlWort(Math.floor(m / 60), 'Stunde', 'Stunden') + (m % 60 > 0 ? ' ' + zahlWort(m % 60, 'Minute', 'Minuten') : '');
  else wann = 'vor ' + Math.floor(m / (24 * 60)) + ' Tagen';
  return { text: 'Stand ' + wann + ' empfangen', rot: m >= 120 };
}

/**
 * Das Alter des angezeigten Stands in Minuten: `alterMinuten` aus der Antwort
 * der API plus die Zeit seit diesem Abruf (Browser-Uhr). Ein neuer Abruf setzt
 * es zurück. null, wenn die Antwort kein Alter trägt.
 */
export function aktuellesAlter(alterMinuten: unknown, geladenMs: number, jetztMs: number): number | null {
  if (typeof alterMinuten !== 'number' || !Number.isFinite(alterMinuten) || alterMinuten < 0) return null;
  return alterMinuten + Math.max(0, jetztMs - geladenMs) / 60000;
}

/** Ist der Stand neu zu laden? Nur bei sichtbarem Reiter und frühestens fünf Minuten nach dem letzten Versuch. */
export function standNeuLaden(sichtbar: boolean, letzterVersuchMs: number, jetztMs: number): boolean {
  return sichtbar && jetztMs - letzterVersuchMs >= 5 * 60 * 1000;
}

// ─── Zeiten ──────────────────────────────────────────────────────

/** Ein Zeitpunkt in Berliner Zeit: 24.10.2026, 13:12. */
export function zeitText(iso: unknown): string {
  if (typeof iso !== 'string' || iso === '') return '';
  var d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Der Berliner Kalendertag eines Zeitpunkts: 24.10.2026. */
export function datumText(iso: unknown): string {
  if (typeof iso !== 'string' || iso === '') return '';
  var d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Ein Kalendertag, wie der Kern ihn meint (stumm bis, Pause bis, Vertrag bis):
 * die ersten zehn Zeichen. „Stumm bis 31.10." heißt beim Kern 31.10. 23:59 UTC,
 * in Berliner Zeit wäre das schon der 1.11.
 */
export function tagText(iso: unknown): string {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '';
  return iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4);
}

// ─── Kopfzeile ───────────────────────────────────────────────────

/** Der Satz oben auf der Seite, aus den Kennzahlen des Stands (wie in der Anprobe). */
export function kopfSatz(kennzahlen: unknown): string {
  var k = kennzahlen !== null && typeof kennzahlen === 'object' ? (kennzahlen as Record<string, unknown>) : {};
  var a = typeof k.alarmeOffen === 'number' ? k.alarmeOffen : 0;
  var b = typeof k.befundeOffen === 'number' ? k.befundeOffen : 0;
  var t = typeof k.aeltesteLiegezeitTage === 'number' ? k.aeltesteLiegezeitTage : 0;
  var n = typeof k.installationen === 'number' ? k.installationen : 0;
  var satz = '';
  if (a + b === 0) {
    satz = 'Nichts liegt offen.';
  } else {
    var was = a > 0 && b > 0
      ? zahlWort(a, 'Alarm', 'Alarme') + ' und ' + zahlWort(b, 'Befund', 'Befunde')
      : a > 0 ? zahlWort(a, 'Alarm', 'Alarme') : zahlWort(b, 'Befund', 'Befunde');
    satz = was + (a + b === 1 ? ' liegt offen, ' : ' liegen offen, der älteste ') + liegezeitText(t) + '.';
  }
  if (n === 0) return satz + ' Im Inventar steht noch keine Installation.';
  if (n === 1) return satz + ' Die eine Installation ist von innen noch nicht geprüft (ab Teil 2).';
  return satz + ' Alle ' + n + ' Installationen sind von innen noch nicht geprüft (ab Teil 2).';
}

/** Der Zustand des Wächters für die Kopfzeile: letzte Runde und ausgefallene Quellen (mit ihrer Ausfallserie). */
export function waechterText(runde: Runde | null | undefined, quellen: QuellenZustand[] | null | undefined): { text: string; warnung: boolean } {
  if (!runde) return { text: 'Wächter: noch keine Runde beendet.', warnung: true };
  var aus = runde.quellen && Array.isArray(runde.quellen.ausgefallen) ? runde.quellen.ausgefallen : [];
  var ok = runde.quellen && typeof runde.quellen.ok === 'number' ? runde.quellen.ok : 0;
  var liste = Array.isArray(quellen) ? quellen : [];
  var text = 'Wächter: Runde ' + runde.id + ' beendet ' + zeitText(runde.beendetIso) + ', ';
  if (aus.length === 0) return { text: text + 'alle ' + zahlWort(ok, 'Quelle', 'Quellen') + ' in Ordnung.', warnung: false };
  var namen = aus.map(function (name) {
    var q = liste.find(function (x) { return x.quelle === name; });
    return q && q.ausfallserie > 1 ? name + ' (seit ' + q.ausfallserie + ' Runden)' : name;
  });
  return { text: text + zahlWort(ok, 'Quelle', 'Quellen') + ' in Ordnung, ausgefallen: ' + namen.join(', ') + '.', warnung: true };
}

// ─── Felder ──────────────────────────────────────────────────────

/** Sammel- und Quellenzeilen tragen keine Site, sondern `_alle` und `_quelle:<name>`. */
export function siteText(site: string): string {
  if (site === '_alle') return 'Sammelalarm';
  if (site.indexOf('_quelle:') === 0) return 'Quelle ' + site.slice('_quelle:'.length);
  return site;
}

export function weltText(welt: string | null | undefined): string {
  if (welt === 'mstudio') return 'mStudio';
  if (welt === 'altwelt') return 'Alt-Welt';
  if (welt === 'raidboxes') return 'Raidboxes';
  return welt || 'unbekannt';
}

export function stufeName(stufe: string | null | undefined): string {
  if (!stufe) return 'nicht eingeordnet';
  return stufe === 'bewusst-ohne' ? 'bewusst ohne' : stufe;
}

export function quelleText(quelle: string | null | undefined): string {
  if (quelle === 'jan') return 'von Jan';
  if (quelle === 'mysites-tag') return 'laut mySites-Tag';
  if (quelle === 'abo-text') return 'laut Abo-Text';
  if (quelle === 'collmex') return 'laut Collmex';
  if (quelle === 'liste') return 'laut Liste';
  if (quelle === 'automatisch') return 'automatisch';
  return quelle || '';
}

/** Stufe mit Quelle und „unbestätigt"; ohne Einordnung „nicht eingeordnet". */
export function stufeText(stufe: string | null | undefined, quelle: string | null | undefined, bestaetigt: boolean | undefined): string {
  if (!stufe) return 'nicht eingeordnet';
  return [stufeName(stufe), quelleText(quelle), bestaetigt ? '' : 'unbestätigt'].filter(function (t) { return t !== ''; }).join(', ');
}

export function merkerText(merker: Merker | null | undefined): string {
  if (!merker) return '';
  var teile: string[] = [];
  if (merker.vip) teile.push('VIP');
  if (merker.fremdhosting) teile.push('Fremdhosting');
  if (merker.kein_ssh_moeglich) teile.push('kein SSH möglich');
  if (merker.pause_bis) teile.push('Pause bis ' + tagText(merker.pause_bis));
  return teile.join(', ');
}

/** Ist die Abo-Liste noch nicht geladen (`vertraegeGeladen` false), heißt null „noch nicht geladen", nicht „kein Vertrag". */
export function kundeText(kunde: Kunde | null | undefined, vertraegeGeladen: boolean | undefined): string {
  if (vertraegeGeladen === false) return 'noch nicht geladen';
  if (!kunde) return 'kein Vertrag';
  return kunde.firma + ' (' + kunde.kundeNr + ')';
}

export function vertragText(vertrag: Vertrag | null | undefined, vertraegeGeladen: boolean | undefined): string {
  if (vertraegeGeladen === false) return 'noch nicht geladen';
  if (!vertrag) return 'kein Vertrag';
  if (vertrag.aktiv) return vertrag.bisIso ? 'aktiv bis ' + tagText(vertrag.bisIso) : 'aktiv';
  return vertrag.bisIso ? 'beendet am ' + tagText(vertrag.bisIso) : 'beendet';
}

/** Zeigt DNS auf diese Installation? */
export function ausgeliefertText(wert: boolean | null | undefined): string {
  if (wert === true) return 'ja';
  if (wert === false) return 'nein';
  return 'unbekannt';
}

export function mysitesText(m: { verbunden: boolean; letztesAuditIso: string | null } | null | undefined): string {
  if (!m) return 'keine Daten';
  if (!m.verbunden) return 'nicht verbunden';
  return m.letztesAuditIso ? 'verbunden, Audit ' + zeitText(m.letztesAuditIso) : 'verbunden, noch kein Audit';
}

export function backupText(b: { letztesOkIso: string | null; ziel: string | null } | null | undefined): string {
  if (!b) return 'keine Daten';
  if (b.letztesOkIso) return zeitText(b.letztesOkIso) + (b.ziel ? ', ' + b.ziel : '');
  return 'kein erfolgreiches' + (b.ziel ? ' (' + b.ziel + ')' : '');
}

// ─── Sites, Hosts und Einträge ───────────────────────────────────

/** Ein Host wie beim Kern: klein geschrieben, ohne www. */
export function hostForm(text: unknown): string {
  return String(text === null || text === undefined ? '' : text).trim().toLowerCase().replace(/^www\./, '');
}

/**
 * Die Site der Flotte zu einem Host der Lage: der Name einer Site gilt direkt,
 * eine Domain genau einer Site gilt ihrem Namen, sonst null. Einordnungs-Aufträge
 * gehen an diesen Namen, nicht an den Host.
 */
export function siteFuerHost(flotte: { site: string; domains?: string[] }[], host: string): string | null {
  if (flotte.some(function (z) { return z.site === host; })) return host;
  var h = hostForm(host);
  var treffer: string[] = [];
  flotte.forEach(function (z) {
    var hosts = [z.site].concat(z.domains || []).map(hostForm);
    if (hosts.indexOf(h) >= 0 && treffer.indexOf(z.site) < 0) treffer.push(z.site);
  });
  return treffer.length === 1 ? treffer[0] : null;
}

/**
 * Die Einträge der Lage zu einer Site: ihre eigenen (über den Namen und die
 * Domains ihrer Installationen) und die Sammelalarme, in denen sie steht.
 */
export function eintraegeDerSite(lage: LageZeile[], site: string, flotte: { site: string; domains?: string[] }[]): { eigene: LageZeile[]; sammel: LageZeile[] } {
  var hosts = [hostForm(site)];
  flotte.forEach(function (z) {
    if (z.site !== site) return;
    (z.domains || []).forEach(function (d) {
      if (hosts.indexOf(hostForm(d)) < 0) hosts.push(hostForm(d));
    });
  });
  return {
    eigene: lage.filter(function (z) { return z.site.charAt(0) !== '_' && hosts.indexOf(hostForm(z.site)) >= 0; }),
    sammel: lage.filter(function (z) {
      return z.site.charAt(0) === '_' && (z.mitglieder || []).some(function (m) { return hosts.indexOf(hostForm(m)) >= 0; });
    }),
  };
}

/** Der I6 (Aufräumen) einer Site, sonst der Sammel-I6, in dem sie steht, sonst null. */
export function i6FuerSite(lage: LageZeile[], site: string): LageZeile | null {
  var eigener = lage.find(function (z) { return z.typ === 'I6' && hostForm(z.site) === hostForm(site); });
  if (eigener) return eigener;
  var sammel = lage.find(function (z) { return z.typ === 'I6' && z.site === '_alle' && (z.mitglieder || []).indexOf(site) >= 0; });
  return sammel || null;
}

// ─── Urteile und Aufträge ────────────────────────────────────────

/**
 * Die Urteile, die eine Zeile der Lage anbietet. Jede Zeile einer Site: erledigt,
 * stumm und stimmt; „kein Hack" nur, wo ein Hack in Frage steht (A1 Hack-Verdacht,
 * A2 Cloaking, B6a bis B6c Startseite). Sammel- und Quellenzeilen (`_alle`,
 * `_quelle:<name>`) kennen nur erledigt und stumm; einen Sammel-A7 schließt der
 * Kern nicht (er übernimmt DNS nur je Site), er bleibt stumm.
 */
export function urteileFuerLage(zeile: LageZeile): string[] {
  if (zeile.site.charAt(0) === '_') return zeile.typ === 'A7' ? ['stumm'] : ['erledigt', 'stumm'];
  if (['A1', 'A2', 'B6a', 'B6b', 'B6c'].indexOf(zeile.typ) >= 0) return ['erledigt', 'stumm', 'stimmt', 'kein-hack'];
  return ['erledigt', 'stumm', 'stimmt'];
}

/**
 * Die Rückfrage vor den beiden Aktionen, die nicht mit einem Klick abgehen: Sie
 * sagt, was passiert. `zeile` ist bei „aufgeraeumt" der I6, auf den der Auftrag geht.
 */
export function rueckfrageText(art: string, zeile: LageZeile): string {
  if (art === 'kein-hack') {
    return (zeile.klasse === 'alarm' ? 'Der Alarm' : 'Der Befund') + ' „' + zeile.titel + '“ bei ' + siteText(zeile.site)
      + ' wird mit dem Urteil „kein Hack“ geschlossen.';
  }
  if (art === 'aufgeraeumt') {
    var wessen = zeile.site === '_alle'
      ? 'der ' + zahlWort((zeile.mitglieder || []).length, 'Site', 'Sites') + ' dieses Sammelbefunds'
      : 'von ' + zeile.site;
    return 'Die verschwundenen Installationen ' + wessen + ' werden aus dem Inventar entfernt. Auf den Servern wird nichts gelöscht.';
  }
  return '';
}

/** Der Auftrag zu einem Urteil, genau in der Form, die POST /api/sicherheit/auftraege annimmt. */
export function auftragFuerLage(zeile: LageZeile, art: string, bis?: string): AuftragKoerper {
  if (art === 'erledigt') return { art: art, site: zeile.site, typ: zeile.typ, werte: {} };
  if (art === 'stumm') return { art: art, site: zeile.site, typ: zeile.typ, werte: { bis: bis } };
  return { art: art, site: zeile.site, werte: { befundId: zeile.befundId } };
}

/**
 * Was die Seite zu einer Antwort der API sagt, die nicht 2xx ist. `koerper` ist
 * das gelesene JSON oder null, wenn die Antwort kein JSON war (der globale Parser
 * der Middleware antwortet etwa bei einem kaputten Körper mit HTML); Status 0
 * heißt: keine Verbindung. `ziel` nennt, wohin ein Link führen soll.
 */
export function apiFehlerText(status: number, koerper: unknown): { text: string; ziel: 'zweiter-faktor' | 'anmelden' | null } {
  if (status === 0) return { text: 'Die Middleware ist nicht erreichbar.', ziel: null };
  if (koerper === null || typeof koerper !== 'object') {
    return { text: 'Die Middleware hat keine lesbare Antwort geschickt (Status ' + status + ').', ziel: null };
  }
  var k = koerper as Record<string, unknown>;
  if (status === 401) return { text: 'Die Anmeldung ist abgelaufen.', ziel: 'anmelden' };
  if (status === 403 && k.error === 'zweiter_faktor_fehlt') return { text: 'Der zweite Faktor ist nicht mehr bestätigt.', ziel: 'zweiter-faktor' };
  if (status === 503) return { text: 'Die Sicherheitsplattform ist in dieser Middleware nicht eingerichtet.', ziel: null };
  if (typeof k.message === 'string' && k.message !== '') return { text: k.message, ziel: null };
  return { text: 'Die Middleware hat mit Status ' + status + ' geantwortet.', ziel: null };
}

// ─── Rückmeldung mit Obergrenze ──────────────────────────────────

/**
 * Welcher Verlauf zu fragen ist: null, solange kein Auftrag läuft (dann hört das
 * Fragen auf). Kennt die Seite die Erstellzeit jedes laufenden Auftrags, fragt sie
 * ab der frühesten (der Verlauf filtert nach Erstellung); fehlt eine noch (gleich
 * nach dem Abschicken antwortet die API nur mit der ID), fragt sie ohne `seit`
 * nach den jüngsten.
 */
export function verlaufAnfrage(auftraege: SeitenAuftrag[]): string | null {
  var laufende = auftraege.filter(function (a) { return a.status === 'laeuft'; });
  if (laufende.length === 0) return null;
  if (laufende.some(function (a) { return !a.erstelltIso; })) return '/api/sicherheit/auftraege';
  var frueheste = laufende.map(function (a) { return a.erstelltIso as string; }).sort()[0];
  return '/api/sicherheit/auftraege?seit=' + encodeURIComponent(frueheste);
}

/**
 * Der Auftrag nach einem Blick in den Verlauf: angewandt oder fehler mit dem Text
 * des Kerns; nach 10 Minuten ohne Quittung „noch nicht übernommen" (dann fragt die
 * Seite nicht weiter); sonst läuft er weiter. Ein abgeschlossener bleibt, wie er ist.
 */
export function auftragNachVerlauf(auftrag: SeitenAuftrag, eintrag: VerlaufEintrag | undefined, jetztMs: number): SeitenAuftrag {
  if (auftrag.status !== 'laeuft') return auftrag;
  var erstellt = eintrag && typeof eintrag.erstelltIso === 'string' ? eintrag.erstelltIso : auftrag.erstelltIso;
  if (eintrag && (eintrag.status === 'angewandt' || eintrag.status === 'fehler')) {
    var standard = eintrag.status === 'angewandt' ? 'übernommen' : 'vom Kern abgelehnt';
    return Object.assign({}, auftrag, {
      status: eintrag.status, text: eintrag.quittungText || standard, quittiertIso: eintrag.quittiertIso, erstelltIso: erstellt,
    }) as SeitenAuftrag;
  }
  if (jetztMs - auftrag.gesendetMs >= 10 * 60 * 1000) {
    return Object.assign({}, auftrag, { status: 'still', text: 'noch nicht übernommen, der Kern meldet sich nicht', erstelltIso: erstellt }) as SeitenAuftrag;
  }
  return Object.assign({}, auftrag, { erstelltIso: erstellt }) as SeitenAuftrag;
}

// ─── Filter der Flotte ───────────────────────────────────────────

/** Passt die Installation zu den Filtern? Ampel als Wort, Stufe „keine" für ohne Einordnung, Suche in allen Textfeldern. */
export function flottePasst(zeile: FlottenZeile, filter: FlottenFilter, vertraegeGeladen: boolean | undefined): boolean {
  if (filter.ampel !== 'alle' && ampelText(zeile.ampel) !== filter.ampel) return false;
  if (filter.welt !== 'alle' && zeile.welt !== filter.welt) return false;
  if (filter.stufe === 'keine' ? !!zeile.stufe : filter.stufe !== 'alle' && zeile.stufe !== filter.stufe) return false;
  var suche = filter.suche.trim().toLowerCase();
  if (suche === '') return true;
  var text = [
    zeile.id, zeile.site, (zeile.domains || []).join(' '), kundeText(zeile.kunde, vertraegeGeladen),
    stufeText(zeile.stufe, zeile.stufeQuelle, zeile.bestaetigt), merkerText(zeile.merker), zeile.welt, zeile.server,
    zeile.account, zeile.pfad, zeile.cms, zeile.version, zeile.php, zeile.grund,
  ].filter(function (t) { return typeof t === 'string' && t !== ''; }).join(' ').toLowerCase();
  return text.indexOf(suche) >= 0;
}

/** Alles, was seite.ts ins Skript der Seite einbettet. */
export const DARSTELLUNG_FUNKTIONEN = [
  zahlWort, ampelText, ampelRang, liegezeitText, standAlterText, aktuellesAlter, standNeuLaden, zeitText, datumText, tagText,
  kopfSatz, waechterText, siteText, weltText, stufeName, quelleText, stufeText, merkerText, kundeText, vertragText,
  ausgeliefertText, mysitesText, backupText, hostForm, siteFuerHost, eintraegeDerSite, i6FuerSite, urteileFuerLage,
  rueckfrageText, auftragFuerLage, apiFehlerText, verlaufAnfrage, auftragNachVerlauf, flottePasst,
];
