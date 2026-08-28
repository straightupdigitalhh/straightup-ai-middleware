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
        istWiederkehrend: false,
        arbeitsart: null,
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
        istWiederkehrend: false,
        arbeitsart: null,
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
        istWiederkehrend: false,
        arbeitsart: null,
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
        istWiederkehrend: false,
        arbeitsart: null,
        assigneeIds: [],
      },
    ]);
  });

  it('setzt istWiederkehrend, arbeitsart und assigneeIds aus der Rohantwort von /me/allavailabletasks (Produktionskette der einzigen Stelle, die OffeneAufgabe erzeugt)', async () => {
    fakeFetch(200, [
      {
        id: 't-5',
        name: 'Wiederkehrende Wartung',
        isRecurring: true,
        // Arbeitsart der Aufgabe — Werte im echten Workspace: Interne
        // Arbeit, Vertriebstätigkeit, Projektarbeit.
        typeOfWork: { id: 'tow-1', name: 'Projektarbeit' },
        taskStatus: { name: 'Offen', type: 'todo' },
        assignees: [{ id: 'u-lea' }, { id: 'u-jan' }],
      },
    ]);
    const client = new AworkClient('T', BASE_URL);
    const result = await client.getAvailableTasks();
    expect(result[0].istWiederkehrend).toBe(true);
    expect(result[0].arbeitsart).toBe('Projektarbeit');
    expect(result[0].assigneeIds).toEqual(['u-lea', 'u-jan']);
  });

  it('lässt arbeitsart null, wenn die Aufgabe kein typeOfWork trägt (nicht jede Aufgabe hat eine Arbeitsart)', async () => {
    fakeFetch(200, [
      { id: 't-6', name: 'Ohne Arbeitsart', taskStatus: { name: 'Offen', type: 'todo' }, assignees: [] },
      { id: 't-7', name: 'Leeres typeOfWork', typeOfWork: null, taskStatus: { name: 'Offen', type: 'todo' }, assignees: [] },
    ]);
    const client = new AworkClient('T', BASE_URL);
    const result = await client.getAvailableTasks();
    expect(result.map((a) => a.arbeitsart)).toEqual([null, null]);
  });

  // ─── getProjectsLeicht ───────────────────────────────────────

  it('liefert Projekt-Stammdaten (Art + Status-Typ) aus GET /projects, paginiert mit pageSize 1000', async () => {
    // Echte Antwortform von GET /projects (28.08.2026), auf die zwei
    // gebrauchten Felder gekürzt.
    const calls = pagedFetch([
      [
        {
          id: 'proj-intern',
          name: 'straightup Intern',
          projectType: { id: 'pt-1', name: 'straightup Projekt' },
          projectStatus: { id: 'ps-1', name: 'Läuft', type: 'progress' },
        },
        {
          id: 'proj-kunde-x',
          name: 'Kunde X',
          projectType: { id: 'pt-2', name: 'Website-Support' },
          projectStatus: { id: 'ps-2', name: 'Abgeschlossen', type: 'closed' },
        },
      ],
    ]);
    const client = new AworkClient('T', BASE_URL);
    const result = await client.getProjectsLeicht();
    expect(result).toEqual([
      { id: 'proj-intern', artName: 'straightup Projekt', statusTyp: 'progress' },
      { id: 'proj-kunde-x', artName: 'Website-Support', statusTyp: 'closed' },
    ]);
    const url = decodeURIComponent(calls[0].url);
    expect(url).toContain('/projects?');
    expect(url).toContain('pageSize=1000');
    // Nur eine Seite geholt: die erste Seite war nicht voll.
    expect(calls).toHaveLength(1);
  });

  it('liefert artName/statusTyp null, wenn projectType bzw. projectStatus fehlen (6 Projekte ohne Art im echten Workspace)', async () => {
    fakeFetch(200, [
      { id: 'proj-ohne-art', name: 'Ohne Art' },
      { id: 'proj-leere-felder', name: 'Leere Felder', projectType: null, projectStatus: null },
    ]);
    const client = new AworkClient('T', BASE_URL);
    expect(await client.getProjectsLeicht()).toEqual([
      { id: 'proj-ohne-art', artName: null, statusTyp: null },
      { id: 'proj-leere-felder', artName: null, statusTyp: null },
    ]);
  });

  it('holt alle Seiten (fetchAllPages), wenn die erste Seite voll ist', async () => {
    const ersteSeite = Array.from({ length: 1000 }, (_, i) => ({
      id: `p-${i}`,
      projectType: { name: 'Website-Support' },
      projectStatus: { type: 'progress' },
    }));
    const calls = pagedFetch([
      ersteSeite,
      [{ id: 'p-1000', projectType: { name: 'Vorlagen' }, projectStatus: { type: 'not-started' } }],
    ]);
    const client = new AworkClient('T', BASE_URL);
    const result = await client.getProjectsLeicht();
    expect(result).toHaveLength(1001);
    expect(result[1000]).toEqual({ id: 'p-1000', artName: 'Vorlagen', statusTyp: 'not-started' });
    expect(calls).toHaveLength(2);
  });

  // ─── Teamboard: Schreibmethoden (Stufe 3) ────────────────────
  // Diese vier Methoden schreiben aktiv (Statuswechsel, Kommentar) bzw.
  // lesen für den Schreibpfad (Status-Liste, Einzelaufgabe) — bis Stufe 2
  // war awork ausschließlich lesend angebunden.

  it('getTaskStatuses ruft GET /projects/{id}/taskstatuses und mappt id/name/type', async () => {
    const calls = fakeFetch(200, [
      { id: 's-todo', name: 'Offen', type: 'todo' },
      { id: 's-done', name: 'Erledigt', type: 'done' },
    ]);
    const client = new AworkClient('T', BASE_URL);
    const result = await client.getTaskStatuses('proj-1');
    expect(result).toEqual([
      { id: 's-todo', name: 'Offen', type: 'todo' },
      { id: 's-done', name: 'Erledigt', type: 'done' },
    ]);
    expect(calls[0].url).toBe(`${BASE_URL}/projects/proj-1/taskstatuses`);
  });

  it('changeTaskStatus schickt POST /tasks/changestatuses mit Array-Body [{taskId,statusId}] und wirft NICHT bei 204 mit leerem Body', async () => {
    // Der wichtigste Fall: ein JSON-Parse auf leerem Body würde sonst knallen
    // — request() muss auf res.text() zurückfallen (awork.ts:153-157).
    const calls: { url: string; init: any }[] = [];
    fetchMock.mockImplementation(async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        status: 204,
        statusText: 'No Content',
        headers: { get: () => null },
        text: async () => '',
      };
    });
    const client = new AworkClient('T', BASE_URL);
    await expect(client.changeTaskStatus('t-1', 's-done')).resolves.toBeUndefined();
    expect(calls[0].url).toBe(`${BASE_URL}/tasks/changestatuses`);
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(calls[0].init.body)).toEqual([{ taskId: 't-1', statusId: 's-done' }]);
  });

  it('changeTaskStatus wirft bei HTTP-Fehler mit Status und Operation im Text, ohne Token', async () => {
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: { get: () => null },
      text: async () => 'ungültiger Status',
    }));
    const client = new AworkClient('GEHEIM-TOKEN', BASE_URL);
    await expect(client.changeTaskStatus('t-1', 's-x')).rejects.toThrow(/400/);
    try {
      await client.changeTaskStatus('t-1', 's-x');
    } catch (fehler) {
      expect(String(fehler)).not.toContain('GEHEIM-TOKEN');
      expect(String(fehler)).toContain('changestatuses');
    }
  });

  it('getTask mappt id/name/taskStatusId/taskStatus/projectId/isRecurring', async () => {
    const calls = fakeFetch(200, {
      id: 't-9',
      name: 'Migration prüfen',
      taskStatusId: 's-done',
      taskStatus: { id: 's-done', name: 'Erledigt', type: 'done' },
      projectId: 'proj-intern',
      isRecurring: true,
    });
    const client = new AworkClient('T', BASE_URL);
    const result = await client.getTask('t-9');
    expect(result).toEqual({
      id: 't-9',
      name: 'Migration prüfen',
      taskStatusId: 's-done',
      taskStatus: { id: 's-done', name: 'Erledigt', type: 'done' },
      projectId: 'proj-intern',
      isRecurring: true,
    });
    expect(calls[0].url).toBe(`${BASE_URL}/tasks/t-9`);
  });

  it('getTask liefert null bei 404', async () => {
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: { get: () => null },
      text: async () => 'nicht gefunden',
    }));
    const client = new AworkClient('T', BASE_URL);
    expect(await client.getTask('unbekannt')).toBeNull();
  });

  it('createTaskComment schickt POST /tasks/{id}/comments mit {message, userId}', async () => {
    const calls = fakeFetch(200, { id: 'c-1' });
    const client = new AworkClient('T', BASE_URL);
    await client.createTaskComment('t-1', 'Erledigt via Teamboard', 'u-jan');
    expect(calls[0].url).toBe(`${BASE_URL}/tasks/t-1/comments`);
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(calls[0].init.body)).toEqual({ message: 'Erledigt via Teamboard', userId: 'u-jan' });
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
