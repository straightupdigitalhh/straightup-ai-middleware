import fetch from 'node-fetch';

// ─── Types ───────────────────────────────────────────────────────

interface GraphToken {
  accessToken: string;
  expiresAt: number;
}

export interface GraphEmail {
  id: string;
  subject: string;
  bodyPreview: string;
  body: { contentType: string; content: string };
  from: { emailAddress: { name: string; address: string } };
  receivedDateTime: string;
  categories: string[];
}

// ─── HTML Stripping ─────────────────────────────────────────────

export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── Client ─────────────────────────────────────────────────────

export class MicrosoftGraphClient {
  private token: GraphToken | null = null;

  constructor(
    private tenantId: string,
    private clientId: string,
    private clientSecret: string,
    private userEmail: string
  ) {}

  private async getAccessToken(): Promise<string> {
    // Token noch gültig? (5 Min Puffer)
    if (this.token && Date.now() < this.token.expiresAt - 300_000) {
      return this.token.accessToken;
    }

    const url = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Azure AD Token-Fehler ${res.status}: ${text}`);
    }

    const data = await res.json() as { access_token: string; expires_in: number };
    this.token = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    return this.token.accessToken;
  }

  /**
   * Holt E-Mails mit einer bestimmten Kategorie aus der Mailbox.
   */
  async getEmailsByCategory(triggerCategory: string): Promise<GraphEmail[]> {
    const token = await this.getAccessToken();
    const filter = `categories/any(c:c eq '${triggerCategory}')`;
    const params = new URLSearchParams({
      '$filter': filter,
      '$orderby': 'receivedDateTime desc',
      '$top': '10',
      '$select': 'id,subject,body,bodyPreview,from,receivedDateTime,categories',
    });

    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(this.userEmail)}/messages?${params}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401) {
      // Token ungültig → einmal neu versuchen
      this.token = null;
      const freshToken = await this.getAccessToken();
      const retry = await fetch(url, {
        headers: { Authorization: `Bearer ${freshToken}` },
      });
      if (!retry.ok) {
        throw new Error(`Graph API ${retry.status}: ${await retry.text()}`);
      }
      const data = await retry.json() as { value: GraphEmail[] };
      return data.value || [];
    }

    if (!res.ok) {
      throw new Error(`Graph API ${res.status}: ${await res.text()}`);
    }

    const data = await res.json() as { value: GraphEmail[] };
    return data.value || [];
  }

  /**
   * Aktualisiert die Kategorien einer E-Mail (z.B. "→ awork" → "✅ verarbeitet").
   */
  async updateEmailCategories(messageId: string, categories: string[]): Promise<void> {
    const token = await this.getAccessToken();
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(this.userEmail)}/messages/${messageId}`;

    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ categories }),
    });

    if (!res.ok) {
      throw new Error(`Graph API PATCH ${res.status}: ${await res.text()}`);
    }
  }
}
