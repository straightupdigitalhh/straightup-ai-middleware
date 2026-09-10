import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock wird gehoisted – Variablen für die Factory müssen via vi.hoisted entstehen
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('node-fetch', () => ({ default: fetchMock }));

// Import NACH dem Mock
const { MicrosoftGraphClient } = await import('../src/services/microsoft-graph.js');

function tokenResponse() {
  return {
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => ({ access_token: 't', expires_in: 3600 }),
  };
}

function sendMailResponse(status = 202) {
  return {
    ok: status < 400,
    status,
    text: async () => '',
    json: async () => ({}),
  };
}

describe('MicrosoftGraphClient.sendMail', () => {
  let client: InstanceType<typeof MicrosoftGraphClient>;

  beforeEach(() => {
    fetchMock.mockReset();
    // Basis-Client wie im Poller, sendMail läuft aber über ein anderes
    // Postfach (forMailbox) – wie im Relay-Mount in index.ts.
    client = new MicrosoftGraphClient('tenant', 'client', 'secret', 'poller@straightup-digital.de')
      .forMailbox('review@straightup-digital.de');
  });

  it('schickt Klartext an die codierte Postfach-URL, contentType Text, ohne im Gesendet-Ordner abzulegen', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(sendMailResponse(202));

    await client.sendMail(['peter@texter.de'], 'Betreff', 'Klartext-Inhalt', 'Text');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('login.microsoftonline.com');
    const [url, opts] = fetchMock.mock.calls[1];
    expect(url).toBe('https://graph.microsoft.com/v1.0/users/review%40straightup-digital.de/sendMail');
    const body = JSON.parse(opts.body as string);
    expect(body.message.body.contentType).toBe('Text');
    expect(body.message.body.content).toBe('Klartext-Inhalt');
    expect(body.saveToSentItems).toBe(false);
  });

  it('nutzt HTML als Standard-contentType ohne vierten Parameter', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(sendMailResponse(202));

    await client.sendMail(['peter@texter.de'], 'Betreff', '<p>Html</p>');

    const [, opts] = fetchMock.mock.calls[1];
    const body = JSON.parse(opts.body as string);
    expect(body.message.body.contentType).toBe('HTML');
  });
});
