import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock wird gehoisted – Variablen für die Factory müssen via vi.hoisted entstehen
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('node-fetch', () => ({ default: fetchMock }));

// Import NACH dem Mock
const { AworkClient } = await import('../src/services/awork.js');

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    statusText: 'OK',
    headers: { get: (h: string) => (h === 'content-type' ? 'application/json' : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function emptyResponse(status = 204) {
  return {
    ok: true,
    status,
    statusText: 'No Content',
    headers: { get: () => null },
    json: async () => ({}),
    text: async () => '',
  };
}

describe('AworkClient – neue Methoden', () => {
  let client: InstanceType<typeof AworkClient>;

  beforeEach(() => {
    fetchMock.mockReset();
    client = new AworkClient('test-token', 'https://api.example.com/v1');
  });

  it('getProject ruft GET /projects/{id}', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'p1', name: 'Projekt' }));
    const p = await client.getProject('p1');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/v1/projects/p1',
      expect.objectContaining({}),
    );
    expect(p.name).toBe('Projekt');
  });

  it('getProjectMembers ruft GET /projects/{id}/members', async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ id: 'm1', userId: 'u1', firstName: 'Anna', lastName: 'A' }]));
    const members = await client.getProjectMembers('p1');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.com/v1/projects/p1/members');
    expect(members[0].userId).toBe('u1');
  });

  it('createTaskList sendet POST mit {name}', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'l1', name: 'Website-Feedback' }));
    const list = await client.createTaskList('p1', 'Website-Feedback');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/projects/p1/tasklists');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ name: 'Website-Feedback' });
    expect(list.id).toBe('l1');
  });

  it('setTaskAssignees sendet reines UUID-Array als Body', async () => {
    fetchMock.mockResolvedValue(emptyResponse());
    await client.setTaskAssignees('t1', ['u1', 'u2']);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/tasks/t1/setassignees');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual(['u1', 'u2']);
  });

  it('uploadTaskFile sendet multipart mit Feldname "File"', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'f1' }));
    await client.uploadTaskFile('t1', Buffer.from('png-bytes'), 'screenshot.png', 'image/png');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/tasks/t1/files');
    expect(opts.method).toBe('POST');
    // form-data Body: Feldname und Dateiname müssen im Multipart-Stream stehen
    const bodyStr = opts.body.getBuffer().toString();
    expect(bodyStr).toContain('name="File"');
    expect(bodyStr).toContain('filename="screenshot.png"');
    expect(bodyStr).toContain('image/png');
  });

  it('wirft bei non-ok Response einen Fehler mit Status', async () => {
    fetchMock.mockResolvedValue({ ...jsonResponse({}, 500), ok: false, status: 500, statusText: 'ISE', text: async () => 'kaputt' });
    await expect(client.getProject('p1')).rejects.toThrow(/500/);
  });
});
