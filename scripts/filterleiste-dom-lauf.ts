/**
 * Mini-DOM-Lauf für die Teamboard-Filterleiste.
 * Aufruf: npx tsx scripts/filterleiste-dom-lauf.ts
 *
 * Warum ein Skript und kein vitest-Test: das eingebettete Client-Skript
 * braucht ein DOM, und im Projekt gibt es bewusst keine jsdom-Abhängigkeit
 * (Hausregel: keine neuen npm-Pakete ohne Not). Die Suite prüft das
 * ausgelieferte Dokument deshalb als Text; dieses Skript führt es einmal
 * gegen ein handgeschriebenes Mini-DOM aus und belegt das Verhalten, das
 * eine Text-Prüfung nicht belegen kann:
 *
 *   1. Ein Klick auf einen Dimensions-Knopf klappt sein Panel auf.
 *   2. Eine Auswahl im Panel filtert die Lanes tatsächlich.
 *   3. Escape schließt ZUERST das Filter-Panel; erst der nächste Escape
 *      schließt das Detail-Panel.
 *   4. Ein Klick außerhalb der Leiste schließt das offene Panel.
 *   5. Feindliche Fremddaten (Projekt-Art "</script><b>…") landen als TEXT
 *      im Panel, nicht als Markup.
 *
 * Das Mini-DOM kann nur, was das Client-Skript benutzt — es ist eine
 * Prüfhilfe, kein Browser-Ersatz.
 */
import { renderSeite } from '../src/services/teamboard/seite.js';
import type { BoardStand } from '../src/services/teamboard/daten.js';

// ─── Mini-DOM ────────────────────────────────────────────────────

type Kind = Knoten | string;

class Knoten {
  className = '';
  kinder: Kind[] = [];
  eltern: Knoten | null = null;
  attribute: Record<string, string> = {};
  hoerer: Record<string, ((ev: any) => void)[]> = {};
  hidden = false;
  type = '';
  title = '';
  name = '';
  alt = '';
  src = '';
  value = '';
  checked = false;
  disabled = false;
  scrollLeft = 0;
  style: Record<string, string> = {};
  classList = {
    add: (k: string) => {
      if (!this.className.split(' ').includes(k)) this.className = (this.className + ' ' + k).trim();
    },
    remove: (k: string) => {
      this.className = this.className.split(' ').filter((t) => t !== k).join(' ');
    },
  };

  constructor(public tagName: string) {}

  get textContent(): string {
    return this.kinder.map((k) => (typeof k === 'string' ? k : k.textContent)).join('');
  }
  set textContent(wert: string) {
    this.kinder = [];
    if (wert !== '') this.kinder.push(String(wert));
  }

  appendChild(k: Knoten): Knoten {
    k.eltern = this;
    this.kinder.push(k);
    return k;
  }
  replaceWith(neu: Knoten): void {
    if (!this.eltern) return;
    const i = this.eltern.kinder.indexOf(this);
    if (i !== -1) this.eltern.kinder[i] = neu;
    neu.eltern = this.eltern;
  }
  remove(): void {
    if (!this.eltern) return;
    const i = this.eltern.kinder.indexOf(this);
    if (i !== -1) this.eltern.kinder.splice(i, 1);
  }
  contains(n: Knoten | null): boolean {
    for (let k: Knoten | null = n; k; k = k.eltern) if (k === this) return true;
    return false;
  }
  setAttribute(name: string, wert: string): void {
    this.attribute[name] = wert;
  }
  getAttribute(name: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.attribute, name) ? this.attribute[name] : null;
  }
  addEventListener(typ: string, fn: (ev: any) => void): void {
    (this.hoerer[typ] = this.hoerer[typ] || []).push(fn);
  }
  alleKnoten(): Knoten[] {
    const liste: Knoten[] = [];
    this.kinder.forEach((k) => {
      if (typeof k === 'string') return;
      liste.push(k, ...k.alleKnoten());
    });
    return liste;
  }
  /** Nur die zwei Selektoren, die das Client-Skript benutzt. */
  querySelectorAll(sel: string): Knoten[] {
    return this.alleKnoten().filter((k) =>
      sel === '[hidden]' ? k.hidden : k.getAttribute(sel.slice(1, -1)) !== null,
    );
  }
  kinderKnoten(): Knoten[] {
    return this.kinder.filter((k): k is Knoten => typeof k !== 'string');
  }
  get childNodes(): Kind[] {
    return this.kinder;
  }
}

const wurzel = new Knoten('div');
const nachId: Record<string, Knoten> = {};
function feld(id: string, tag = 'div'): Knoten {
  const k = new Knoten(tag);
  k.attribute.id = id;
  nachId[id] = k;
  wurzel.appendChild(k);
  return k;
}

const body = new Knoten('body');
const dokumentHoerer: Record<string, { fn: (ev: any) => void; capture: boolean }[]> = {};
const dokument = {
  body,
  getElementById: (id: string) => nachId[id] ?? null,
  createElement: (tag: string) => new Knoten(tag),
  querySelectorAll: (sel: string) => wurzel.querySelectorAll(sel),
  addEventListener: (typ: string, fn: (ev: any) => void, capture?: boolean) => {
    (dokumentHoerer[typ] = dokumentHoerer[typ] || []).push({ fn, capture: capture === true });
  },
  visibilityState: 'visible',
};

/** Klick mit Capture am Dokument, danach Ziel und Bubble-Pfad. */
function klick(ziel: Knoten): void {
  const ev = { target: ziel, preventDefault() {} };
  (dokumentHoerer['click'] || []).filter((h) => h.capture).forEach((h) => h.fn(ev));
  for (let k: Knoten | null = ziel; k; k = k.eltern) (k.hoerer['click'] || []).forEach((fn) => fn(ev));
  (dokumentHoerer['click'] || []).filter((h) => !h.capture).forEach((h) => h.fn(ev));
}
function taste(key: string): void {
  (dokumentHoerer['keydown'] || []).forEach((h) => h.fn({ key }));
}
function aenderung(ziel: Knoten): void {
  (ziel.hoerer['change'] || []).forEach((fn) => fn({ target: ziel }));
}

// ─── Fixture ─────────────────────────────────────────────────────

const BOESE = '</script><b>x</b>';

function karte(over: Record<string, unknown>) {
  return {
    id: 'a-1',
    name: 'Aufgabe',
    kennung: null,
    projektName: 'Projekt',
    projektId: 'p-1',
    statusName: 'Offen',
    statusTyp: 'todo',
    faelligAm: null,
    istPrio: false,
    istWiederkehrend: false,
    arbeitsart: 'Projektarbeit',
    assigneeIds: ['u-1'],
    ueberfaellig: false,
    ...over,
  } as any;
}

const stand: BoardStand = {
  board: {
    stand: '2026-08-28T10:00:00.000Z',
    lanes: [
      {
        userId: 'u-1',
        name: 'Anna Beispiel',
        timer: null,
        aufgaben: [karte({ id: 'a-progress', statusTyp: 'progress', statusName: 'In Bearbeitung' })],
      },
      {
        userId: 'u-2',
        name: 'Bea Beispiel',
        timer: null,
        aufgaben: [karte({ id: 'a-todo', statusTyp: 'todo', projektId: 'p-2' })],
      },
    ],
  },
  alterSekunden: 0,
};

const projekte = {
  'p-1': { art: BOESE, status: 'progress' },
  'p-2': { art: 'Website-Support', status: 'closed' },
};

// ─── Lauf ────────────────────────────────────────────────────────

const html = renderSeite(stand, { aworkUserId: 'u-1', istAdmin: true }, projekte);
const skript = html.split('<script>\n')[1].split('\n</script>')[0];

// Die festen Elemente des Dokuments, so wie das Markup sie anlegt.
feld('board-daten').textContent = html.split('type="application/json">')[1].split('</script>')[0];
feld('stand', 'span');
feld('banner');
feld('zeiten-hinweis');
feld('filterzeile');
feld('ausgeblendet-chip', 'span');
feld('ausgeblendet-liste');
feld('lanes');
feld('panel').hidden = true;

const fetchAufrufe: { url: string; init: any }[] = [];
function fetchStub(url: string, init?: any): Promise<any> {
  fetchAufrufe.push({ url, init });
  if (url.indexOf('/einstellungen') !== -1 && (!init || init.method !== 'PUT')) {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ reihenfolge: null, ausgeblendet: [], filter: null }),
    });
  }
  if (url.indexOf('/zeiten') !== -1) {
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ zeiten: {}, hinweis: null }) });
  }
  return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
}

const lauf = new Function(
  'document',
  'fetch',
  'setInterval',
  'clearInterval',
  'requestAnimationFrame',
  'location',
  'console',
  'JSON',
  skript,
);
lauf(
  dokument,
  fetchStub,
  () => 0,
  () => {},
  (fn: () => void) => fn(),
  {
    reload() {
      throw new Error('location.reload() im Mini-DOM-Lauf aufgerufen');
    },
  },
  console,
  JSON,
);

// ─── Prüfungen ───────────────────────────────────────────────────

let fehler = 0;
function pruefe(name: string, bedingung: boolean, zusatz = ''): void {
  if (bedingung) {
    console.log(`  ok   ${name}`);
    return;
  }
  fehler++;
  console.log(`  FEHL ${name}${zusatz ? ' — ' + zusatz : ''}`);
}

const leiste = nachId['filterzeile'];
const lanes = nachId['lanes'];
const panel = nachId['panel'];

function knoepfe(klasse: string): Knoten[] {
  return leiste.alleKnoten().filter((k) => k.className === klasse);
}
function laneNamen(): string[] {
  return lanes.kinderKnoten().map((l) => l.kinderKnoten()[0].kinderKnoten()[1].textContent);
}

console.log('\n1) Start');
pruefe('beide Lanes gezeichnet', laneNamen().length === 2, laneNamen().join('/'));
pruefe('fünf Aufklapp-Knöpfe in der Leiste', knoepfe('fdrop').length === 5, String(knoepfe('fdrop').length));
pruefe('zwei Umschalt-Chips (beide aus)', knoepfe('fchip').length === 2);
pruefe('kein Zurücksetzen-Knopf ohne aktiven Filter', knoepfe('zuruecksetzen').length === 0);
pruefe('kein Panel offen', leiste.alleKnoten().filter((k) => k.className === 'fpanel').length === 0);

console.log('\n2) Panel öffnen');
klick(knoepfe('fdrop')[3]); // Aufgaben-Status
let offen = leiste.alleKnoten().filter((k) => k.className === 'fpanel');
pruefe('Panel offen', offen.length === 1);
pruefe(
  'vier Status-Werte im Panel',
  offen[0].kinderKnoten().length === 4,
  offen[0].kinderKnoten().map((z) => z.textContent).join('/'),
);

console.log('\n3) Auswahl filtert die Lanes');
const zeileProgress = offen[0].kinderKnoten()[1]; // In Bearbeitung
aenderung(zeileProgress.kinderKnoten()[0]);
pruefe('nur noch die Lane mit progress-Aufgabe', laneNamen().length === 1 && laneNamen()[0] === 'Anna Beispiel', laneNamen().join('/'));
pruefe('Zähler am Knopf zeigt 1', knoepfe('fdrop')[3].kinderKnoten()[1].textContent === '1');
pruefe('gewählter Filter steht als Chip in der Leiste', knoepfe('aktivchip').length === 1);
pruefe('Zurücksetzen-Knopf erschienen', knoepfe('zuruecksetzen').length === 1);
pruefe(
  'Filter wurde per PUT gesichert',
  fetchAufrufe.some((a) => a.url.indexOf('/einstellungen') !== -1 && a.init && a.init.method === 'PUT'),
);
const letztesPut = fetchAufrufe.filter((a) => a.init && a.init.method === 'PUT').pop();
pruefe(
  'PUT trägt den Filter samt Projekt-Feld',
  JSON.parse(letztesPut!.init.body).filter.status.join(',') === 'progress',
  letztesPut!.init.body,
);

console.log('\n4) Feindliche Projekt-Art landet als Text, nicht als Markup');
klick(knoepfe('fdrop')[0]); // Projekt-Art
const artPanel = leiste.alleKnoten().filter((k) => k.className === 'fpanel')[0];
const artZeile = artPanel.kinderKnoten()[0];
pruefe('Art-Name unverändert als Text im Panel', artZeile.textContent.indexOf(BOESE) !== -1, artZeile.textContent);
pruefe(
  'der Art-Name ist ein Textknoten, kein Element',
  artZeile.kinderKnoten()[1].kinder.every((k) => typeof k === 'string'),
);

console.log('\n5) Klick außerhalb schließt das Panel');
klick(lanes);
pruefe('Panel zu', leiste.alleKnoten().filter((k) => k.className === 'fpanel').length === 0);

console.log('\n6) Escape: erst Filter-Panel, dann Detail-Panel');
const ersteKarte = lanes.kinderKnoten()[0].alleKnoten().filter((k) => k.className === 'karte')[0];
klick(ersteKarte);
pruefe('Detail-Panel offen', panel.hidden === false);
klick(knoepfe('fdrop')[2]); // Fälligkeit
pruefe('Filter-Panel offen', leiste.alleKnoten().filter((k) => k.className === 'fpanel').length === 1);
taste('Escape');
pruefe('erstes Escape schließt NUR das Filter-Panel', leiste.alleKnoten().filter((k) => k.className === 'fpanel').length === 0);
pruefe('Detail-Panel steht noch offen', panel.hidden === false);
taste('Escape');
pruefe('zweites Escape schließt das Detail-Panel', panel.hidden === true);

console.log('\n7) Alle Filter zurücksetzen');
pruefe('vor dem Zurücksetzen ist noch gefiltert', laneNamen().length === 1);
klick(knoepfe('zuruecksetzen')[0]);
pruefe('alle Lanes wieder da', laneNamen().length === 2, laneNamen().join('/'));
pruefe('keine Chips mehr', knoepfe('aktivchip').length === 0);

console.log(fehler === 0 ? '\n✅ Mini-DOM-Lauf: alles grün' : `\n❌ Mini-DOM-Lauf: ${fehler} Fehler`);
process.exit(fehler === 0 ? 0 : 1);
