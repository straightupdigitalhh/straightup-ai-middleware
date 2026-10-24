import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import {
  DARSTELLUNG_FUNKTIONEN,
  aktuellesAlter,
  ampelRang,
  ampelText,
  apiFehlerText,
  auftragFuerLage,
  auftragNachVerlauf,
  ausgeliefertText,
  backupText,
  datumText,
  eintraegeDerSite,
  flottePasst,
  hostForm,
  i6FuerSite,
  kopfSatz,
  kundeText,
  liegezeitText,
  merkerText,
  mysitesText,
  quelleText,
  rueckfrageText,
  rueckmeldungAuswerten,
  seiteAusHash,
  siteFuerHost,
  siteText,
  standAlterText,
  standNeuLaden,
  stufeText,
  tagText,
  urteileFuerLage,
  verlaufAnfrage,
  vertragText,
  waechterText,
  weltText,
  wirksameAuswahl,
  zahlWort,
  zeitText,
  zugangVerloren,
  type LageZeile,
  type SeitenAuftrag,
} from '../src/services/sicherheit/darstellung.js';

// Sicherheitsplattform Teil 1, Task 10: die reinen Funktionen der Seite
// /sicherheit. Sie laufen hier auf dem Server unter Test und stehen, als Text
// eingebettet, genauso im Skript der Seite (src/services/sicherheit/seite.ts).
// Beispieldaten: test/fixtures/sicherheit-stand.json (der Beispiel-Stand des Kerns).

const BEISPIEL: any = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/sicherheit-stand.json', import.meta.url)), 'utf-8'),
);
const LAGE: LageZeile[] = BEISPIEL.lage;
const FLOTTE: any[] = BEISPIEL.flotte;
const zeile = (befundId: number): LageZeile => LAGE.find((z) => z.befundId === befundId)!;

// ═════════════════════════════════════════════════════════════════
// Die drei aus dem Plan
// ═════════════════════════════════════════════════════════════════

describe('standAlterText', () => {
  it('zeigt_alter_des_stands: bis 119 Minuten normal, ab 120 Minuten rot', () => {
    expect(standAlterText(119)).toEqual({ text: 'Stand vor 1 Stunde 59 Minuten empfangen', rot: false });
    expect(standAlterText(120)).toEqual({ text: 'Stand vor 2 Stunden empfangen', rot: true });
    expect(standAlterText(121)).toEqual({ text: 'Stand vor 2 Stunden 1 Minute empfangen', rot: true });
  });

  it('kurze und lange Zeiten, Einzahl und Mehrzahl', () => {
    expect(standAlterText(0)).toEqual({ text: 'Stand gerade eben empfangen', rot: false });
    expect(standAlterText(1)).toEqual({ text: 'Stand vor 1 Minute empfangen', rot: false });
    expect(standAlterText(5)).toEqual({ text: 'Stand vor 5 Minuten empfangen', rot: false });
    expect(standAlterText(60)).toEqual({ text: 'Stand vor 1 Stunde empfangen', rot: false });
    expect(standAlterText(61)).toEqual({ text: 'Stand vor 1 Stunde 1 Minute empfangen', rot: false });
    expect(standAlterText(47 * 60 + 59)).toEqual({ text: 'Stand vor 47 Stunden 59 Minuten empfangen', rot: true });
    expect(standAlterText(48 * 60)).toEqual({ text: 'Stand vor 2 Tagen empfangen', rot: true });
  });

  it('Bruchteile zählen als angebrochene Minute nicht mit, 119,9 Minuten sind noch nicht rot', () => {
    expect(standAlterText(119.9)).toEqual({ text: 'Stand vor 1 Stunde 59 Minuten empfangen', rot: false });
  });

  it('ohne Stand oder mit unlesbarem Alter: rot, nie „gerade eben"', () => {
    for (const wert of [null, undefined, Number.NaN, -1, '5', Infinity]) {
      expect(standAlterText(wert), String(wert)).toEqual({ text: 'Noch kein Stand empfangen', rot: true });
    }
  });
});

describe('Alter in der Kopfzeile und Nachladen', () => {
  const GELADEN = Date.parse('2026-10-24T12:00:00.000Z');
  const MINUTE = 60_000;

  it('alter_aus_dem_empfangenen_stand: alterMinuten der Antwort plus die Zeit seit dem Abruf; ein neuer Abruf setzt es zurück', () => {
    expect(aktuellesAlter(3, GELADEN, GELADEN)).toBe(3);
    expect(aktuellesAlter(3, GELADEN, GELADEN + 5 * MINUTE)).toBe(8);
    // ein offener Reiter wird zur richtigen Zeit rot …
    expect(standAlterText(aktuellesAlter(119, GELADEN, GELADEN + 59_999)).rot).toBe(false);
    expect(standAlterText(aktuellesAlter(119, GELADEN, GELADEN + MINUTE)).rot).toBe(true);
    // … und ein frischer Abruf (neue Antwort, neue Abrufzeit) zeigt wieder das Alter des neuen Stands
    expect(standAlterText(aktuellesAlter(2, GELADEN + MINUTE, GELADEN + MINUTE))).toEqual({ text: 'Stand vor 2 Minuten empfangen', rot: false });
  });

  it('eine zurückgestellte Uhr zieht nichts ab; ohne lesbares Alter null (dann „Noch kein Stand empfangen")', () => {
    expect(aktuellesAlter(3, GELADEN, GELADEN - 10 * MINUTE)).toBe(3);
    for (const wert of [null, undefined, Number.NaN, -1, '3']) expect(aktuellesAlter(wert, GELADEN, GELADEN + MINUTE), String(wert)).toBeNull();
    expect(standAlterText(aktuellesAlter(null, GELADEN, GELADEN))).toEqual({ text: 'Noch kein Stand empfangen', rot: true });
  });

  const fall = (teile: Partial<Parameters<typeof standNeuLaden>[0]>) =>
    standNeuLaden({ sichtbar: true, ohneZugang: false, ebenSichtbar: false, letzterVersuchMs: GELADEN, jetztMs: GELADEN, ...teile });

  it('stand_alle_5_minuten_nur_sichtbar: nachladen nur bei sichtbarem Reiter und frühestens 5 Minuten nach dem letzten Versuch', () => {
    expect(fall({ jetztMs: GELADEN + 5 * MINUTE - 1 })).toBe(false);
    expect(fall({ jetztMs: GELADEN + 5 * MINUTE })).toBe(true);
    expect(fall({ sichtbar: false, jetztMs: GELADEN + 60 * MINUTE })).toBe(false);
    expect(fall({ letzterVersuchMs: 0 })).toBe(true); // noch nie versucht
  });

  it('sofort, wenn der Reiter wieder sichtbar wird, aber nicht im Verborgenen', () => {
    expect(fall({ ebenSichtbar: true, jetztMs: GELADEN + 1000 })).toBe(true);
    expect(fall({ ebenSichtbar: true, sichtbar: false })).toBe(false);
  });

  it('nach_401_oder_403_kein_automatisches_nachladen: weder nach fünf Minuten noch beim Sichtbarwerden, bis „neu laden"', () => {
    expect(fall({ ohneZugang: true, jetztMs: GELADEN + 60 * MINUTE })).toBe(false);
    expect(fall({ ohneZugang: true, ebenSichtbar: true })).toBe(false);
    expect(zugangVerloren(401)).toBe(true);
    expect(zugangVerloren(403)).toBe(true);
    for (const status of [0, 200, 400, 409, 413, 500, 503]) expect(zugangVerloren(status), String(status)).toBe(false);
  });
});

describe('Reiter und Filter', () => {
  it('seiteAusHash: nur die fünf Reiter, sonst null', () => {
    expect(seiteAusHash('#flotte')).toBe('flotte');
    expect(seiteAusHash('#waechter')).toBe('waechter');
    for (const hash of ['', '#', '#Flotte', '#welle', '#quellen', 'flotte', '#flotte?x']) expect(seiteAusHash(hash), hash).toBeNull();
  });

  it('wirksameAuswahl: eine Auswahl, die es nach dem Nachladen nicht mehr gibt, wird „alle"', () => {
    expect(wirksameAuswahl(['alle', 'mstudio', 'altwelt'], 'altwelt')).toBe('altwelt');
    expect(wirksameAuswahl(['alle', 'mstudio'], 'altwelt')).toBe('alle');
    expect(wirksameAuswahl(['alle'], 'alle')).toBe('alle');
  });
});

describe('liegezeitText', () => {
  it('liegezeit_text: heute, ein Tag, mehrere Tage (Dativ, für „liegt seit …")', () => {
    expect(liegezeitText(0)).toBe('seit heute');
    expect(liegezeitText(1)).toBe('seit 1 Tag');
    expect(liegezeitText(2)).toBe('seit 2 Tagen');
    expect(liegezeitText(20)).toBe('seit 20 Tagen');
  });

  it('Unlesbares ergibt leeren Text statt „seit NaN Tagen"', () => {
    for (const wert of [null, undefined, Number.NaN, -3, '9', 1.5]) expect(liegezeitText(wert), String(wert)).toBe('');
  });
});

describe('ampelText', () => {
  it('ampel_text: die vier Ampeln des Stands als Wort, grün mit Umlaut', () => {
    expect(ampelText('rot')).toBe('rot');
    expect(ampelText('gelb')).toBe('gelb');
    expect(ampelText('gruen')).toBe('grün');
    expect(ampelText('grau')).toBe('grau');
  });

  it('was der Stand nicht kennt, ist grau, nie grün', () => {
    for (const wert of ['grün', 'GRUEN', 'green', '', null, undefined, 3]) expect(ampelText(wert), String(wert)).toBe('grau');
  });

  it('ampelRang ordnet rot vor gelb vor grau vor grün', () => {
    const sortiert = ['grau', 'gruen', 'gelb', 'rot', 'quatsch'].sort((a, b) => ampelRang(a) - ampelRang(b));
    expect(sortiert).toEqual(['rot', 'gelb', 'grau', 'quatsch', 'gruen']);
  });
});

// ═════════════════════════════════════════════════════════════════
// Kopfzeile
// ═════════════════════════════════════════════════════════════════

describe('kopfSatz', () => {
  it('der Satz aus den Kennzahlen des Beispiels', () => {
    expect(kopfSatz(BEISPIEL.kennzahlen)).toBe(
      '3 Alarme und 7 Befunde liegen offen, der älteste seit 9 Tagen. Alle 12 Installationen sind von innen noch nicht geprüft (ab Teil 2).',
    );
  });

  it('Einzahl, nur Alarme, nur Befunde, nichts offen', () => {
    expect(kopfSatz({ alarmeOffen: 1, befundeOffen: 0, aeltesteLiegezeitTage: 0, installationen: 1 }))
      .toBe('1 Alarm liegt offen, seit heute. Die eine Installation ist von innen noch nicht geprüft (ab Teil 2).');
    expect(kopfSatz({ alarmeOffen: 0, befundeOffen: 2, aeltesteLiegezeitTage: 1, installationen: 3 }))
      .toBe('2 Befunde liegen offen, der älteste seit 1 Tag. Alle 3 Installationen sind von innen noch nicht geprüft (ab Teil 2).');
    expect(kopfSatz({ alarmeOffen: 0, befundeOffen: 0, aeltesteLiegezeitTage: 0, installationen: 0 }))
      .toBe('Nichts liegt offen. Im Inventar steht noch keine Installation.');
  });

  it('fehlende Kennzahlen zählen als 0 statt NaN', () => {
    expect(kopfSatz(null)).toBe('Nichts liegt offen. Im Inventar steht noch keine Installation.');
    expect(kopfSatz({ alarmeOffen: 'x' })).toBe('Nichts liegt offen. Im Inventar steht noch keine Installation.');
  });
});

describe('waechterText', () => {
  it('letzte Runde mit ausgefallener Quelle und ihrer Ausfallserie', () => {
    expect(waechterText(BEISPIEL.runde, BEISPIEL.waechter.quellen)).toEqual({
      text: 'Wächter: Runde 4 beendet 24.10.2026, 13:12, 11 Quellen in Ordnung, ausgefallen: collmex (seit 2 Runden).',
      warnung: true,
    });
  });

  it('alle Quellen in Ordnung; eine Quelle, die erst in dieser Runde ausfiel, ohne Serie', () => {
    expect(waechterText({ id: 7, beendetIso: '2026-10-24T08:00:00.000Z', quellen: { ok: 12, ausgefallen: [] } }, []))
      .toEqual({ text: 'Wächter: Runde 7 beendet 24.10.2026, 10:00, alle 12 Quellen in Ordnung.', warnung: false });
    expect(waechterText(
      { id: 8, beendetIso: '2026-10-24T09:00:00.000Z', quellen: { ok: 1, ausgefallen: ['dns'] } },
      [{ quelle: 'dns', ok: false, grund: 'Zeitlimit', dauerMs: 1, ausfallserie: 1 }],
    )).toEqual({ text: 'Wächter: Runde 8 beendet 24.10.2026, 11:00, 1 Quelle in Ordnung, ausgefallen: dns.', warnung: true });
  });

  it('solange keine Runde beendet ist', () => {
    expect(waechterText(null, [])).toEqual({ text: 'Wächter: noch keine Runde beendet.', warnung: true });
  });
});

// ═════════════════════════════════════════════════════════════════
// Zeiten und Felder
// ═════════════════════════════════════════════════════════════════

describe('Zeiten', () => {
  it('zeitText und datumText in Berliner Zeit, tagText nimmt den Kalendertag des Kerns (UTC)', () => {
    expect(zeitText('2026-10-24T11:12:00.000Z')).toBe('24.10.2026, 13:12');
    expect(zeitText('2026-10-24T23:30:00.000Z')).toBe('25.10.2026, 01:30');
    expect(datumText('2026-10-24T23:30:00.000Z')).toBe('25.10.2026');
    // stumm bis einschließlich 31.10. heißt beim Kern 31.10. 23:59:59.999 UTC; in Berlin wäre das schon der 1.11.
    expect(tagText('2026-10-31T23:59:59.999Z')).toBe('31.10.2026');
    expect(tagText('2025-03-31')).toBe('31.03.2025');
  });

  it('Unlesbares ergibt leeren Text', () => {
    for (const wert of [null, undefined, '', 'gestern', 42]) {
      expect(zeitText(wert), String(wert)).toBe('');
      expect(datumText(wert), String(wert)).toBe('');
      expect(tagText(wert), String(wert)).toBe('');
    }
  });
});

describe('Felder der Flotte', () => {
  it('zahlWort, siteText und weltText', () => {
    expect(zahlWort(1, 'Alarm', 'Alarme')).toBe('1 Alarm');
    expect(zahlWort(0, 'Alarm', 'Alarme')).toBe('0 Alarme');
    expect(siteText('kunde.de')).toBe('kunde.de');
    expect(siteText('_alle')).toBe('Sammelalarm');
    expect(siteText('_quelle:collmex')).toBe('Quelle collmex');
    expect(weltText('mstudio')).toBe('mStudio');
    expect(weltText('altwelt')).toBe('Alt-Welt');
    expect(weltText('raidboxes')).toBe('Raidboxes');
    expect(weltText('domainfactory')).toBe('domainfactory');
    expect(weltText(null)).toBe('unbekannt');
  });

  it('stufeText mit Quelle und „unbestätigt", ohne Einordnung „nicht eingeordnet"', () => {
    expect(stufeText('standard', 'collmex', false)).toBe('standard, laut Collmex, unbestätigt');
    expect(stufeText('premium', 'abo-text', false)).toBe('premium, laut Abo-Text, unbestätigt');
    expect(stufeText('premium', 'mysites-tag', true)).toBe('premium, laut mySites-Tag');
    expect(stufeText('bewusst-ohne', 'jan', true)).toBe('bewusst ohne, von Jan');
    expect(stufeText('ohne', 'automatisch', false)).toBe('ohne, automatisch, unbestätigt');
    expect(stufeText(null, null, false)).toBe('nicht eingeordnet');
    expect(quelleText('liste')).toBe('laut Liste');
  });

  it('merkerText nennt jeden Merker, pause_bis als Kalendertag', () => {
    expect(merkerText({})).toBe('');
    expect(merkerText(null)).toBe('');
    expect(merkerText({ vip: true, fremdhosting: true, kein_ssh_moeglich: true, pause_bis: '2026-11-30' }))
      .toBe('VIP, Fremdhosting, kein SSH möglich, Pause bis 30.11.2026');
  });

  it('kundeText und vertragText: ohne Abo-Liste „noch nicht geladen" statt „kein Vertrag"', () => {
    expect(kundeText({ kundeNr: '10001', firma: 'Beispiel GmbH' }, true)).toBe('Beispiel GmbH (10001)');
    expect(kundeText(null, true)).toBe('kein Vertrag');
    expect(kundeText(null, false)).toBe('noch nicht geladen');
    expect(kundeText({ kundeNr: '10001', firma: 'Beispiel GmbH' }, false)).toBe('noch nicht geladen');
    expect(kundeText(null, undefined)).toBe('kein Vertrag'); // ein Stand ohne das Feld (vor dem Endreview des Kerns)
    expect(vertragText({ aktiv: true, bisIso: null }, true)).toBe('aktiv');
    expect(vertragText({ aktiv: true, bisIso: '2027-12-31' }, true)).toBe('aktiv bis 31.12.2027');
    expect(vertragText({ aktiv: false, bisIso: '2025-03-31' }, true)).toBe('beendet am 31.03.2025');
    expect(vertragText({ aktiv: false, bisIso: null }, true)).toBe('beendet');
    expect(vertragText(null, true)).toBe('kein Vertrag');
    expect(vertragText(null, false)).toBe('noch nicht geladen');
  });

  it('ausgeliefert, mySites und Backup: null heißt „keine Daten" beziehungsweise „unbekannt"', () => {
    expect(ausgeliefertText(true)).toBe('ja');
    expect(ausgeliefertText(false)).toBe('nein');
    expect(ausgeliefertText(null)).toBe('unbekannt');
    expect(mysitesText({ verbunden: true, letztesAuditIso: '2026-10-24T09:00:00.000Z' })).toBe('verbunden, Audit 24.10.2026, 11:00');
    expect(mysitesText({ verbunden: true, letztesAuditIso: null })).toBe('verbunden, noch kein Audit');
    expect(mysitesText({ verbunden: false, letztesAuditIso: null })).toBe('nicht verbunden');
    expect(mysitesText(null)).toBe('keine Daten');
    expect(backupText({ letztesOkIso: '2026-10-24T03:00:00.000Z', ziel: 'Storage Box' })).toBe('24.10.2026, 05:00, Storage Box');
    expect(backupText({ letztesOkIso: null, ziel: 'Storage Box' })).toBe('kein erfolgreiches (Storage Box)');
    expect(backupText({ letztesOkIso: null, ziel: null })).toBe('kein erfolgreiches');
    expect(backupText(null)).toBe('keine Daten');
  });
});

// ═════════════════════════════════════════════════════════════════
// Sites, Hosts und Einträge
// ═════════════════════════════════════════════════════════════════

describe('Sites und Einträge', () => {
  it('hostForm schreibt klein und ohne www., wie der Kern', () => {
    expect(hostForm(' WWW.Kunde.DE ')).toBe('kunde.de');
    expect(hostForm(null)).toBe('');
  });

  it('siteFuerHost: der Name einer Site gilt direkt, eine Domain genau einer Site gilt ihrem Namen, sonst null', () => {
    expect(siteFuerHost(FLOTTE, 'kunde.de')).toBe('kunde.de');
    expect(siteFuerHost(FLOTTE, 'www.muster-shop.de')).toBe('muster-shop.de');
    expect(siteFuerHost(FLOTTE, 'unbekannt.de')).toBeNull();
    const zwei = [
      { site: 'a.de', domains: ['geteilt.de'] },
      { site: 'b.de', domains: ['geteilt.de'] },
    ];
    expect(siteFuerHost(zwei, 'geteilt.de')).toBeNull();
  });

  it('eintraegeDerSite: eigene Einträge über Name und Domains, Sammelalarme über die Mitglieder', () => {
    const { eigene, sammel } = eintraegeDerSite(LAGE, 'kunde.de', FLOTTE);
    expect(eigene.map((z) => z.befundId).sort()).toEqual([2, 3]);
    expect(sammel.map((z) => z.befundId)).toEqual([10]);
    const alias = eintraegeDerSite([{ ...zeile(2), site: 'www.kunde.de' }], 'kunde.de', FLOTTE);
    expect(alias.eigene).toHaveLength(1);
    expect(eintraegeDerSite(LAGE, 'gibt-es-nicht.de', FLOTTE)).toEqual({ eigene: [], sammel: [] });
  });

  it('i6FuerSite: der I6 der Site, sonst der Sammel-I6, in dem sie steht, sonst null', () => {
    expect(i6FuerSite(LAGE, 'verwaist.de')?.befundId).toBe(4);
    expect(i6FuerSite(LAGE, 'intern-dev.de')?.befundId).toBe(11);
    const sammel = { ...zeile(4), befundId: 99, site: '_alle', mitglieder: ['weg-a.de', 'weg-b.de'] };
    expect(i6FuerSite([sammel], 'weg-b.de')?.befundId).toBe(99);
    expect(i6FuerSite(LAGE, 'kunde.de')).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════
// Urteile und Aufträge
// ═════════════════════════════════════════════════════════════════

describe('Urteile in der Lage', () => {
  const HACK_TYPEN = ['A1', 'A2', 'B6c'];
  const ANDERE_TYPEN = ['A3', 'A5', 'A6', 'A7', 'B1', 'B3', 'B4', 'B6a', 'B6b', 'B7', 'B8', 'I1', 'I2', 'I4', 'I8', 'I9'];

  it('kein_hack_nur_bei_hack_typen: „kein Hack" nur bei A1, A2 und B6c (Hack-Verdacht, Cloaking, deutlich veränderte Startseite)', () => {
    for (const typ of HACK_TYPEN) expect(urteileFuerLage({ ...zeile(3), typ }), typ).toEqual(['erledigt', 'stumm', 'stimmt', 'kein-hack']);
    // B6a (Startseite langsam) und B6b (Wartungsmodus) sind kein Hack-Verdacht
    for (const typ of ANDERE_TYPEN) expect(urteileFuerLage({ ...zeile(3), typ }), typ).toEqual(['erledigt', 'stumm', 'stimmt']);
    // im Beispiel-Stand trägt nur der Hack-Verdacht (A1) das Urteil
    expect(LAGE.filter((z) => urteileFuerLage(z).includes('kein-hack')).map((z) => z.typ)).toEqual(['A1']);
  });

  it('aufgeraeumt_statt_erledigt_bei_i6: ein Aufräum-Eintrag bietet „aufgeräumt" statt „erledigt", einzeln wie gesammelt', () => {
    expect(urteileFuerLage(zeile(4))).toEqual(['aufgeraeumt', 'stumm', 'stimmt']);
    expect(urteileFuerLage(zeile(11))).toEqual(['aufgeraeumt', 'stumm', 'stimmt']);
    expect(urteileFuerLage({ ...zeile(4), site: '_alle', mitglieder: ['weg-a.de', 'weg-b.de'] })).toEqual(['aufgeraeumt', 'stumm']);
    // geschickt wird dasselbe wie in der Ansicht Aufräumen: erledigt auf den I6
    expect(auftragFuerLage(zeile(4), 'aufgeraeumt')).toEqual({ art: 'erledigt', site: 'verwaist.de', typ: 'I6', werte: {} });
    expect(LAGE.filter((z) => urteileFuerLage(z).includes('aufgeraeumt')).map((z) => z.befundId)).toEqual([4, 11]);
  });

  it('stimmt_auf_jeder_einzelnen_zeile: jede Zeile einer Site bekommt „stimmt", Sammel- und Quellenzeilen nur erledigt und stumm', () => {
    for (const z of LAGE.filter((x) => !x.site.startsWith('_'))) expect(urteileFuerLage(z), `${z.befundId}`).toContain('stimmt');
    expect(urteileFuerLage(zeile(10))).toEqual(['erledigt', 'stumm']);
    expect(urteileFuerLage({ ...zeile(10), typ: 'B6c' })).toEqual(['erledigt', 'stumm']); // auch ein Sammel-B6 ohne „kein Hack"
    expect(urteileFuerLage({ ...zeile(10), site: '_quelle:collmex', typ: 'A9' })).toEqual(['erledigt', 'stumm']);
  });

  it('ein Sammel-A7 nur stumm: der Kern übernimmt DNS nur je Site', () => {
    expect(urteileFuerLage({ ...zeile(10), typ: 'A7' })).toEqual(['stumm']);
    expect(urteileFuerLage({ ...zeile(3), typ: 'A7' })).toEqual(['erledigt', 'stumm', 'stimmt']);
  });

  it('rueckfrageText nennt, was passiert: „kein Hack" schließt den Eintrag mit dem Urteil, „aufgeräumt" entfernt die verschwundenen Installationen', () => {
    expect(rueckfrageText('kein-hack', zeile(3)))
      .toBe('Der Alarm „Hack-Verdacht (mySites-Audit)“ bei kunde.de wird mit dem Urteil „kein Hack“ geschlossen.');
    expect(rueckfrageText('kein-hack', { ...zeile(2), typ: 'B6c', titel: 'Startseite deutlich verändert' }))
      .toBe('Der Befund „Startseite deutlich verändert“ bei kunde.de wird mit dem Urteil „kein Hack“ geschlossen.');
    expect(rueckfrageText('aufgeraeumt', zeile(4)))
      .toBe('Die verschwundenen Installationen von verwaist.de werden aus dem Inventar entfernt. Auf den Servern wird nichts gelöscht.');
    expect(rueckfrageText('aufgeraeumt', { ...zeile(4), site: '_alle', mitglieder: ['weg-a.de', 'weg-b.de'] }))
      .toBe('Die verschwundenen Installationen der 2 Sites dieses Sammelbefunds werden aus dem Inventar entfernt. Auf den Servern wird nichts gelöscht.');
    expect(rueckfrageText('erledigt', zeile(3))).toBe('');
  });

  it('auftragFuerLage baut genau die Formen, die die API annimmt', () => {
    expect(auftragFuerLage(zeile(3), 'erledigt')).toEqual({ art: 'erledigt', site: 'kunde.de', typ: 'A1', werte: {} });
    expect(auftragFuerLage(zeile(10), 'stumm', '2026-11-01')).toEqual({ art: 'stumm', site: '_alle', typ: 'A3', werte: { bis: '2026-11-01' } });
    expect(auftragFuerLage(zeile(3), 'stimmt')).toEqual({ art: 'stimmt', site: 'kunde.de', werte: { befundId: 3 } });
    expect(auftragFuerLage(zeile(3), 'kein-hack')).toEqual({ art: 'kein-hack', site: 'kunde.de', werte: { befundId: 3 } });
  });
});

describe('apiFehlerText', () => {
  it('ohne zweiten Faktor mit Ziel zur Bestätigung, ohne Anmeldung mit Ziel zum Login', () => {
    expect(apiFehlerText(403, { error: 'zweiter_faktor_fehlt', message: 'egal' }))
      .toEqual({ text: 'Der zweite Faktor ist nicht mehr bestätigt.', ziel: 'zweiter-faktor' });
    expect(apiFehlerText(401, { error: 'Unauthorized' })).toEqual({ text: 'Die Anmeldung ist abgelaufen.', ziel: 'anmelden' });
  });

  it('409, 400 und andere mit dem deutschen Satz der API, 503 mit festem Satz', () => {
    expect(apiFehlerText(409, { error: 'kein_stand', message: 'Es liegt noch kein Stand vor.' }))
      .toEqual({ text: 'Es liegt noch kein Stand vor.', ziel: null });
    expect(apiFehlerText(400, { error: 'unbekannte_site', message: 'Diese Site kommt im aktuellen Stand nicht vor.' }))
      .toEqual({ text: 'Diese Site kommt im aktuellen Stand nicht vor.', ziel: null });
    expect(apiFehlerText(503, { error: 'nicht_konfiguriert', message: 'x' }))
      .toEqual({ text: 'Die Sicherheitsplattform ist in dieser Middleware nicht eingerichtet.', ziel: null });
    expect(apiFehlerText(500, {})).toEqual({ text: 'Die Middleware hat mit Status 500 geantwortet.', ziel: null });
  });

  it('eine Antwort, die kein JSON ist, gilt als nicht angenommen; ohne Verbindung Status 0', () => {
    expect(apiFehlerText(413, null)).toEqual({ text: 'Die Middleware hat keine lesbare Antwort geschickt (Status 413).', ziel: null });
    expect(apiFehlerText(0, null)).toEqual({ text: 'Die Middleware ist nicht erreichbar.', ziel: null });
  });
});

// ═════════════════════════════════════════════════════════════════
// Rückmeldung mit Obergrenze
// ═════════════════════════════════════════════════════════════════

describe('Rückmeldung zu Aufträgen', () => {
  const GESENDET = Date.parse('2026-10-24T12:00:00.000Z');
  const laufend = (teile: Partial<SeitenAuftrag> = {}): SeitenAuftrag => ({
    id: 'a-1', ziel: 'lage:3', gesendetMs: GESENDET, erstelltIso: null, status: 'laeuft', text: 'wird übernommen', quittiertIso: null, ...teile,
  });
  const eintrag = (teile: Record<string, unknown> = {}) => ({
    id: 'a-1', erstelltIso: '2026-10-24T12:00:00.123Z', status: 'offen', quittungText: null, quittiertIso: null, ...teile,
  });

  it('verlaufAnfrage: nichts fragen ohne laufende Aufträge, ohne seit solange eine Erstellzeit fehlt, sonst seit der frühesten', () => {
    expect(verlaufAnfrage([])).toBeNull();
    expect(verlaufAnfrage([laufend({ status: 'angewandt' })])).toBeNull();
    expect(verlaufAnfrage([laufend()])).toBe('/api/sicherheit/auftraege');
    expect(verlaufAnfrage([
      laufend({ id: 'b', erstelltIso: '2026-10-24T12:05:00.000Z' }),
      laufend({ id: 'c', erstelltIso: '2026-10-24T12:01:00.000Z' }),
      laufend({ id: 'd', erstelltIso: '2026-10-24T11:00:00.000Z', status: 'fehler' }),
    ])).toBe('/api/sicherheit/auftraege?seit=2026-10-24T12%3A01%3A00.000Z');
  });

  it('übernimmt die Erstellzeit, solange der Kern nicht quittiert hat', () => {
    expect(auftragNachVerlauf(laufend(), eintrag(), GESENDET + 10_000))
      .toEqual(laufend({ erstelltIso: '2026-10-24T12:00:00.123Z' }));
    expect(auftragNachVerlauf(laufend(), undefined, GESENDET + 10_000)).toEqual(laufend());
  });

  it('angewandt und fehler mit dem Text des Kerns', () => {
    expect(auftragNachVerlauf(laufend(), eintrag({ status: 'angewandt', quittungText: 'Stufe gesetzt.', quittiertIso: '2026-10-24T12:04:00.000Z' }), GESENDET + 20_000))
      .toEqual(laufend({ status: 'angewandt', text: 'Stufe gesetzt.', quittiertIso: '2026-10-24T12:04:00.000Z', erstelltIso: '2026-10-24T12:00:00.123Z' }));
    expect(auftragNachVerlauf(laufend(), eintrag({ status: 'fehler', quittungText: 'Kein offener Befund.', quittiertIso: '2026-10-24T12:04:00.000Z' }), GESENDET + 20_000))
      .toEqual(laufend({ status: 'fehler', text: 'Kein offener Befund.', quittiertIso: '2026-10-24T12:04:00.000Z', erstelltIso: '2026-10-24T12:00:00.123Z' }));
  });

  it('nach 10 Minuten ohne Quittung: noch nicht übernommen, der Kern meldet sich nicht; davor läuft er weiter', () => {
    expect(auftragNachVerlauf(laufend(), eintrag(), GESENDET + 10 * 60_000 - 1).status).toBe('laeuft');
    expect(auftragNachVerlauf(laufend(), eintrag(), GESENDET + 10 * 60_000)).toEqual(
      laufend({ status: 'still', text: 'noch nicht übernommen, der Kern meldet sich nicht', erstelltIso: '2026-10-24T12:00:00.123Z' }),
    );
  });

  it('ein abgeschlossener Auftrag ändert sich nicht mehr', () => {
    const fertig = laufend({ status: 'still', text: 'noch nicht übernommen, der Kern meldet sich nicht' });
    expect(auftragNachVerlauf(fertig, eintrag({ status: 'angewandt', quittungText: 'spät' }), GESENDET + 11 * 60_000)).toBe(fertig);
  });

  it('rueckmeldung_auch_ohne_verlauf: scheitert der Abruf (null), erreicht ein Auftrag die 10-Minuten-Grenze trotzdem', () => {
    const vorher = [laufend(), laufend({ id: null as unknown as string, ziel: 'site:x:stufe' })];
    const davor = rueckmeldungAuswerten(vorher, null, GESENDET + 10 * 60_000 - 1);
    expect(davor.geaendert).toBe(false);
    expect(davor.auftraege.map((a) => a.status)).toEqual(['laeuft', 'laeuft']);
    const danach = rueckmeldungAuswerten(vorher, null, GESENDET + 10 * 60_000);
    expect(danach.geaendert).toBe(true);
    expect(danach.auftraege[0]).toMatchObject({ status: 'still', text: 'noch nicht übernommen, der Kern meldet sich nicht' });
    // ein Auftrag ohne ID (die API hat noch nicht geantwortet) bleibt, wie er ist
    expect(danach.auftraege[1]).toBe(vorher[1]);
    expect(danach.quittiert).toBeNull();
  });

  it('rueckmeldungAuswerten: Quittungen aus dem Verlauf, die jüngste Quittung von „angewandt" zum Nachladen', () => {
    const vorher = [laufend(), laufend({ id: 'a-2', ziel: 'lage:4' }), laufend({ id: 'a-3', ziel: 'lage:5' })];
    const ergebnis = rueckmeldungAuswerten(vorher, [
      eintrag({ status: 'angewandt', quittungText: 'erledigt.', quittiertIso: '2026-10-24T12:03:00.000Z' }),
      eintrag({ id: 'a-2', status: 'angewandt', quittungText: 'erledigt.', quittiertIso: '2026-10-24T12:04:00.000Z' }),
      eintrag({ id: 'a-3', status: 'offen' }),
      eintrag({ id: 'fremd', status: 'fehler', quittungText: 'nicht von dieser Seite' }),
    ], GESENDET + 30_000);
    expect(ergebnis.geaendert).toBe(true);
    expect(ergebnis.quittiert).toBe('2026-10-24T12:04:00.000Z');
    expect(ergebnis.auftraege.map((a) => a.status)).toEqual(['angewandt', 'angewandt', 'laeuft']);
    expect(ergebnis.auftraege[2].erstelltIso).toBe('2026-10-24T12:00:00.123Z');
    expect(rueckmeldungAuswerten(ergebnis.auftraege, [], GESENDET + 40_000).geaendert).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════
// Filter der Flotte
// ═════════════════════════════════════════════════════════════════

describe('flottePasst', () => {
  const alle = { ampel: 'alle', welt: 'alle', stufe: 'alle', suche: '' };
  const passend = (filter: Partial<typeof alle>) => FLOTTE.filter((z) => flottePasst(z, { ...alle, ...filter }, true)).map((z) => z.id);

  it('ohne Filter jede Installation', () => {
    expect(passend({})).toHaveLength(FLOTTE.length);
  });

  it('nach Ampel (als Wort), Welt und Stufe; „keine" findet Installationen ohne Einordnung', () => {
    expect(passend({ ampel: 'rot' })).toHaveLength(FLOTTE.filter((z) => z.ampel === 'rot').length);
    expect(passend({ ampel: 'grün' })).toEqual([]);
    expect(passend({ welt: 'altwelt' })).toEqual(FLOTTE.filter((z) => z.welt === 'altwelt').map((z) => z.id));
    expect(passend({ stufe: 'premium' })).toEqual(['mstudio:p-test02:/html']);
    expect(passend({ stufe: 'keine' })).toEqual([]);
    expect(FLOTTE.filter((z) => flottePasst({ ...z, stufe: null }, { ...alle, stufe: 'keine' }, true))).toHaveLength(FLOTTE.length);
  });

  it('die Suche findet Site, Domain, Kunde, Projekt und Merker, ohne Rücksicht auf Groß- und Kleinschreibung', () => {
    expect(passend({ suche: 'WWW.MUSTER' })).toEqual(['mstudio:p-test02:/html']);
    expect(passend({ suche: 'p-test07' })).toEqual(['mstudio:p-test07:/html']);
    expect(passend({ suche: 'kein ssh' })).toEqual(['altwelt:p100002:test-kopie.de']);
    const firma: string = FLOTTE.find((z) => z.id === 'mstudio:p-test02:/html').kunde.firma;
    expect(passend({ suche: firma.toUpperCase() })).toEqual(['mstudio:p-test02:/html']);
    expect(passend({ suche: 'gibt es nicht' })).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════
// Einbettung
// ═════════════════════════════════════════════════════════════════

describe('Einbettung ins Skript der Seite', () => {
  it('alle Funktionen sind eingebettet', () => {
    const namen = DARSTELLUNG_FUNKTIONEN.map((f) => f.name);
    for (const f of [ampelText, liegezeitText, standAlterText, kopfSatz, waechterText, auftragNachVerlauf, verlaufAnfrage, flottePasst,
      urteileFuerLage, rueckfrageText, aktuellesAlter, standNeuLaden, rueckmeldungAuswerten, zugangVerloren, seiteAusHash, wirksameAuswahl]) {
      expect(namen).toContain(f.name);
    }
    expect(new Set(namen).size).toBe(namen.length);
  });

  it('keine benannten Funktionswerte in den Rümpfen: tsx (esbuild, keepNames) setzte sonst __name(...) davor, das es im Browser nicht gibt', () => {
    for (const f of DARSTELLUNG_FUNKTIONEN) {
      const rumpf = String(f).slice(String(f).indexOf('{'));
      expect(rumpf, f.name).not.toMatch(/\b(?:const|let|var)\s+[\w$]+\s*=\s*(?:function\b|\([^()]*\)\s*=>|[\w$]+\s*=>)/);
      expect(rumpf, f.name).not.toMatch(/[\w$]+\s*:\s*(?:function\b|\([^()]*\)\s*=>)/);
      expect(rumpf, f.name).not.toMatch(/\bfunction\s+[\w$]+\s*\(/);
      expect(rumpf, f.name).not.toContain('__name(');
    }
  });

  it('ohne den Modul-Rahmen lauffähig: aus ihrem Text neu gebaut liefern sie dasselbe wie hier', () => {
    const quelle = DARSTELLUNG_FUNKTIONEN.map(String).join('\n');
    const namen = DARSTELLUNG_FUNKTIONEN.map((f) => f.name);
    // eslint-disable-next-line no-new-func
    const nachgebaut = new Function(`${quelle}\nreturn { ${namen.join(', ')} };`)() as Record<string, (...a: unknown[]) => unknown>;
    expect(nachgebaut.kopfSatz(BEISPIEL.kennzahlen)).toBe(kopfSatz(BEISPIEL.kennzahlen));
    expect(nachgebaut.waechterText(BEISPIEL.runde, BEISPIEL.waechter.quellen)).toEqual(waechterText(BEISPIEL.runde, BEISPIEL.waechter.quellen));
    expect(nachgebaut.standAlterText(121)).toEqual(standAlterText(121));
    expect(nachgebaut.eintraegeDerSite(LAGE, 'kunde.de', FLOTTE)).toEqual(eintraegeDerSite(LAGE, 'kunde.de', FLOTTE));
    expect(FLOTTE.map((z) => nachgebaut.flottePasst(z, { ampel: 'alle', welt: 'alle', stufe: 'alle', suche: 'kein ssh' }, true)))
      .toEqual(FLOTTE.map((z) => flottePasst(z, { ampel: 'alle', welt: 'alle', stufe: 'alle', suche: 'kein ssh' }, true)));
  });

  it('kein Geviertstrich in den Texten', () => {
    for (const f of DARSTELLUNG_FUNKTIONEN) expect(String(f), f.name).not.toContain('\u2014');
  });
});
