import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock wird gehoisted – Variablen für die Factory müssen via vi.hoisted entstehen
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('node-fetch', () => ({ default: fetchMock }));

// Import NACH dem Mock
const { AworkClient } = await import('../src/services/awork.js');

const BASE_URL = 'https://api.example.com/v1';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    statusText: 'OK',
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function binaryResponse(bytes: Uint8Array, status: number, contentType: string) {
  return {
    ok: status < 400,
    status,
    statusText: 'OK',
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? contentType : null) },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    text: async () => '',
  };
}

/** Antwortet einmalig mit demselben Body – analog Stufe-1-Testmuster fakeFetch. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: any }[] = [];
  fetchMock.mockImplementation(async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return jsonResponse(body, status);
  });
  return calls;
}

/** Antwortet je nach ?page=-Query-Parameter mit einer anderen Seite. */
function pagedFetch(pages: unknown[][]) {
  const calls: { url: string; init: any }[] = [];
  fetchMock.mockImplementation(async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    const page = Number(new URL(String(url)).searchParams.get('page') ?? '1');
    const body = pages[page - 1] ?? [];
    return jsonResponse(body);
  });
  return calls;
}

describe('AworkClient – Teamboard-Lesemethoden', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  // ─── getBoardUsers ───────────────────────────────────────────

  it('liefert aktive, interne Nutzer (deaktivierte und externe fallen raus, Namen getrimmt)', async () => {
    const calls = fakeFetch(200, [
      { id: 'u-lea', firstName: 'Lea', lastName: 'Stöber', isDeactivated: false, isExternal: false },
      { id: 'u-lara', firstName: 'Lara', lastName: 'Goldammer ', isDeactivated: false, isExternal: false },
      { id: 'u-gabi', firstName: 'Gabi', isDeactivated: false, isExternal: false },
      { id: 'u-weg', firstName: 'Alt', lastName: 'Konto', isDeactivated: true, isExternal: false },
      { id: 'u-ext', firstName: 'Fremd', lastName: 'Dienstleister', isDeactivated: false, isExternal: true },
    ]);
    const client = new AworkClient('T', BASE_URL);
    const result = await client.getBoardUsers();
    expect(result).toEqual([
      { id: 'u-lea', vorname: 'Lea', nachname: 'Stöber' },
      { id: 'u-lara', vorname: 'Lara', nachname: 'Goldammer' },
      { id: 'u-gabi', vorname: 'Gabi', nachname: '' },
    ]);
    expect(calls[0].url).toContain('/users?');
  });

  it('paginiert getBoardUsers, bis eine Seite nicht mehr voll ist (pageSize=1000)', async () => {
    const seite1 = Array.from({ length: 999 }, (_, i) => ({
      id: `u-${i}`,
      firstName: `Nutzer${i}`,
      lastName: 'Aktiv',
      isDeactivated: false,
      isExternal: false,
    }));
    seite1.push({ id: 'u-weg', firstName: 'Alt', lastName: 'Konto', isDeactivated: true, isExternal: false });
    const seite2 = [
      { id: 'u-lea', firstName: 'Lea', lastName: 'Stöber', isDeactivated: false, isExternal: false },
      { id: 'u-ext', firstName: 'Fremd', lastName: 'Dienstleister', isDeactivated: false, isExternal: true },
    ];
    const calls = pagedFetch([seite1, seite2]);
    const client = new AworkClient('T', BASE_URL);
    const result = await client.getBoardUsers();

    // seite1: 999 aktive + 1 deaktivierter (rausgefiltert); seite2: 1 aktiver + 1 externer (rausgefiltert)
    expect(result).toHaveLength(1000);
    expect(calls).toHaveLength(2);
    expect(decodeURIComponent(calls[0].url)).toContain('page=1');
    expect(decodeURIComponent(calls[0].url)).toContain('pageSize=1000');
    expect(decodeURIComponent(calls[1].url)).toContain('page=2');
    expect(result.find((u) => u.id === 'u-lea')).toEqual({ id: 'u-lea', vorname: 'Lea', nachname: 'Stöber' });
    expect(result.find((u) => u.id === 'u-weg')).toBeUndefined();
    expect(result.find((u) => u.id === 'u-ext')).toBeUndefined();
  });

  // ─── getRunningTimers ────────────────────────────────────────

  it('liefert laufende Timer mit kombiniertem Start-Zeitpunkt, Pausen und projektId', async () => {
    // Echte Antwortform vom 26.08.2026: laufender Eintrag hat startTimeUtc mit
    // 7 Nachkommastellen und kein endTimeUtc; Pausen sind {startDate, duration, endDate}.
    const calls = fakeFetch(200, [
      {
        userId: 'u-lea',
        task: { name: 'YOOtheme Updates', taskIdentifier: 'STRI-37' },
        project: { id: 'proj-intern', name: 'straightup Intern' },
        startDateUtc: '2026-08-26T00:00:00Z',
        startTimeUtc: '09:03:31.2966885',
        breaks: [
          { startDate: '2026-08-26T09:31:32Z', duration: 1593, endDate: '2026-08-26T09:58:05Z' },
          { startDate: '2026-08-26T10:31:00Z', duration: 0 },
        ],
        duration: 0,
      },
      // Timer ohne Aufgabe und ohne Projekt (nur frei getrackt):
      { userId: 'u-jan', startDateUtc: '2026-08-26T00:00:00Z', startTimeUtc: '07:00:00', breaks: [], duration: 0 },
    ]);
    const client = new AworkClient('T', BASE_URL);
    const result = await client.getRunningTimers();
    expect(result).toEqual([
      {
        userId: 'u-lea',
        aufgabenName: 'YOOtheme Updates',
        aufgabenKennung: 'STRI-37',
        projektName: 'straightup Intern',
        projektId: 'proj-intern',
        startUtc: '2026-08-26T09:03:31Z',
        pausen: [
          { startUtc: '2026-08-26T09:31:32Z', dauerSekunden: 1593, endeUtc: '2026-08-26T09:58:05Z' },
          { startUtc: '2026-08-26T10:31:00Z', dauerSekunden: 0, endeUtc: null },
        ],
      },
      {
        userId: 'u-jan',
        aufgabenName: null,
        aufgabenKennung: null,
        projektName: null,
        projektId: null,
        startUtc: '2026-08-26T07:00:00Z',
        pausen: [],
      },
    ]);
    const url = decodeURIComponent(calls[0].url).replace(/\+/g, ' ');
    expect(url).toContain('/timeentries?');
    // Spec Abschnitt 3 (Stufe-1): "endTimeUtc eq null" allein reicht NICHT
    // (manuelle Dauer-Buchungen haben auch kein Ende) — startTimeUtc muss
    // zusätzlich gesetzt sein, damit nur echte laufende Timer übrig bleiben.
    expect(url).toContain('filterby=endTimeUtc eq null and startTimeUtc ne null');
  });

  it('liefert eine leere Pausen-Liste und projektId:null, wenn ein Timer-Eintrag kein breaks- und kein project-Feld hat', async () => {
    // awork liefert breaks/project nicht in jeder Antwortform garantiert mit —
    // der Code fängt das über "?? []" bzw. "?? null" ab; dieser Test pinnt nur
    // das bestehende Verhalten.
    fakeFetch(200, [
      { userId: 'u-jan', startDateUtc: '2026-08-26T00:00:00Z', startTimeUtc: '07:00:00', duration: 0 },
    ]);
    const client = new AworkClient('T', BASE_URL);
    const result = await client.getRunningTimers();
    expect(result).toEqual([
      {
        userId: 'u-jan',
        aufgabenName: null,
        aufgabenKennung: null,
        projektName: null,
        projektId: null,
        startUtc: '2026-08-26T07:00:00Z',
        pausen: [],
      },
    ]);
  });

  // ─── getAvailableTasks ───────────────────────────────────────

  it('liefert offene Aufgaben mit Assignees, Status, Fälligkeit, Prio und projektId', async () => {
    // Echte Antwortform von GET /me/allavailabletasks (26.08.2026), gekürzt.
    const calls = fakeFetch(200, [
      {
        id: 't-1',
        name: 'YOOtheme Updates',
        taskIdentifier: 'STRI-37',
        isPrio: false,
        dueOn: null,
        taskStatus: { name: 'EntwicklerCheck', type: 'review' },
        project: { id: 'proj-intern', name: 'straightup Intern' },
        assignees: [{ id: 'u-lea', firstName: 'Lea' }],
      },
      {
        id: 't-2',
        name: 'Angebot schreiben',
        taskIdentifier: 'KUND-3',
        isPrio: true,
        dueOn: '2026-08-27T00:00:00Z',
        taskStatus: { name: 'In Bearbeitung', type: 'progress' },
        project: { id: 'proj-kunde-x', name: 'Kunde X' },
        assignees: [{ id: 'u-lea' }, { id: 'u-jan' }],
      },
      // Aufgabe ohne Assignee und ohne Projekt — muss robust durchlaufen:
      { id: 't-3', name: 'Lose Idee', taskStatus: { name: 'Offen', type: 'todo' }, assignees: [] },
    ]);
    const client = new AworkClient('T', BASE_URL);
    const result = await client.getAvailableTasks();
    expect(result).toEqual([
      {
        id: 't-1',
        name: 'YOOtheme Updates',
        kennung: 'STRI-37',
        projektName: 'straightup Intern',
        projektId: 'proj-intern',
        statusName: 'EntwicklerCheck',
        statusTyp: 'review',
        faelligAm: null,
        istPrio: false,
        assigneeIds: ['u-lea'],
      },
      {
        id: 't-2',
        name: 'Angebot schreiben',
        kennung: 'KUND-3',
        projektName: 'Kunde X',
        projektId: 'proj-kunde-x',
        statusName: 'In Bearbeitung',
        statusTyp: 'progress',
        faelligAm: '2026-08-27T00:00:00Z',
        istPrio: true,
        assigneeIds: ['u-lea', 'u-jan'],
      },
      {
        id: 't-3',
        name: 'Lose Idee',
        kennung: null,
        projektName: null,
        projektId: null,
        statusName: 'Offen',
        statusTyp: 'todo',
        faelligAm: null,
        istPrio: false,
        assigneeIds: [],
      },
    ]);
    const url = decodeURIComponent(calls[0].url).replace(/\+/g, ' ');
    // Spec Abschnitt 3 (Stufe-1): /tasks ist für den API-Token gesperrt; der
    // richtige Pfad ist /me/allavailabletasks (me = API-Nutzer, sieht alle
    // Projekte). Nicht "aufräumen" auf /tasks.
    expect(url).toContain('/me/allavailabletasks?');
    expect(url).toContain("filterby=taskStatus/type ne 'done'");
  });

  it('liefert Defaults und projektId:null, wenn eine Aufgabe kein taskStatus- und kein project-Feld hat', async () => {
    // awork liefert taskStatus/project nicht in jeder Antwortform garantiert
    // mit — der Code fängt das über "??"-Pfade ab; dieser Test pinnt nur das
    // bestehende Verhalten.
    fakeFetch(200, [{ id: 't-4', name: 'Ohne Status', assignees: [] }]);
    const client = new AworkClient('T', BASE_URL);
    const result = await client.getAvailableTasks();
    expect(result).toEqual([
      {
        id: 't-4',
        name: 'Ohne Status',
        kennung: null,
        projektName: null,
        projektId: null,
        statusName: '',
        statusTyp: 'todo',
        faelligAm: null,
        istPrio: false,
        assigneeIds: [],
      },
    ]);
  });

  // ─── getTimeEntriesForRange / getTimeEntriesForDay ──────────

  it('getTimeEntriesForRange baut denselben StartDateLocal-ge/le-Filter wie getTimeEntriesForDay und paginiert', async () => {
    const seite1 = Array.from({ length: 1000 }, (_, i) => ({ id: `t-${i}`, userId: 'u1', duration: 60 }));
    const seite2 = [{ id: 't-1000', userId: 'u1', duration: 120 }];
    const calls = pagedFetch([seite1, seite2]);
    const client = new AworkClient('T', BASE_URL);
    const result = await client.getTimeEntriesForRange('2026-08-24', '2026-08-26');

    expect(result).toHaveLength(1001);
    expect(calls).toHaveLength(2);
    const url = decodeURIComponent(calls[0].url).replace(/\+/g, ' ');
    expect(url).toContain('/timeentries?');
    expect(url).toContain(
      "filterby=StartDateLocal ge datetime'2026-08-24T00:00:00' and StartDateLocal le datetime'2026-08-26T23:59:59'"
    );
  });

  it('getTimeEntriesForDay delegiert an getTimeEntriesForRange mit demselben Tag als from und to', async () => {
    const calls = fakeFetch(200, [{ id: 't1', userId: 'u1', duration: 60 }]);
    const client = new AworkClient('T', BASE_URL);
    const result = await client.getTimeEntriesForDay('2026-08-26');
    expect(result).toEqual([{ id: 't1', userId: 'u1', duration: 60 }]);
    const url = decodeURIComponent(calls[0].url).replace(/\+/g, ' ');
    expect(url).toContain(
      "filterby=StartDateLocal ge datetime'2026-08-26T00:00:00' and StartDateLocal le datetime'2026-08-26T23:59:59'"
    );
  });

  // ─── getUserImage ────────────────────────────────────────────
  // Endpunkt verifiziert am 26.08.2026 gegen die offizielle OpenAPI-Spec
  // (developers.awork.com/openapi.json, GET /files/images/{entityName}/{entityId})
  // und per Echt-Probe (read-only) in Stufe 1.

  it('liefert das Profilbild eines Nutzers mit dem von awork gelieferten Content-Type', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG-Signatur, nur Testdaten
    const calls: { url: string; init: any }[] = [];
    fetchMock.mockImplementation(async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      return binaryResponse(bytes, 200, 'image/png');
    });
    const client = new AworkClient('T', BASE_URL);
    const result = await client.getUserImage('u-lea');
    expect(result).not.toBeNull();
    expect(result!.typ).toBe('image/png');
    expect(Buffer.compare(result!.bytes, Buffer.from(bytes))).toBe(0);
    expect(calls[0].url).toBe(`${BASE_URL}/files/images/users/u-lea`);
    expect(calls[0].init.method).toBe('GET');
    expect((calls[0].init.headers as Record<string, string>)['Authorization']).toBe('Bearer T');
  });

  it('liefert null, wenn ein Nutzer kein Profilbild hat (404 — laut Stufe-1-Echt-Probe auch bei unbekannter userId)', async () => {
    fetchMock.mockImplementation(async () => binaryResponse(new Uint8Array(), 404, 'text/plain'));
    const client = new AworkClient('T', BASE_URL);
    expect(await client.getUserImage('u-ohne-bild')).toBeNull();
  });

  it('wirft bei einem anderen HTTP-Fehler als 404 einen verständlichen Fehler (Token nie in der Fehlermeldung)', async () => {
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 500,
      statusText: 'ISE',
      headers: { get: () => null },
      text: async () => 'kaputt',
    }));
    const client = new AworkClient('GEHEIM-TOKEN', BASE_URL);
    await expect(client.getUserImage('u-x')).rejects.toThrow(/500/);
    try {
      await client.getUserImage('u-x');
    } catch (fehler) {
      expect(String(fehler)).not.toContain('GEHEIM-TOKEN');
    }
  });
});
