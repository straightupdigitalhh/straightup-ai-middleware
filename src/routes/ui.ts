import { Router, Request, Response } from 'express';

const router = Router();

const HTML = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>straightup Wissenssystem</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #1a1a1a; min-height: 100vh; }
    .container { max-width: 640px; margin: 0 auto; padding: 2rem 1rem; }
    h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: .25rem; }
    h2 { font-size: 1.1rem; font-weight: 600; margin-bottom: 1rem; }
    .subtitle { color: #666; margin-bottom: 2rem; font-size: .9rem; }
    .card { background: white; border-radius: 12px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,.1); margin-bottom: 1rem; }
    label { display: block; font-weight: 500; margin-bottom: .5rem; font-size: .9rem; }
    select, textarea, input { width: 100%; padding: .75rem; border: 1px solid #ddd; border-radius: 8px; font-size: .95rem; font-family: inherit; }
    select:focus, textarea:focus, input:focus { outline: none; border-color: #0066ff; box-shadow: 0 0 0 3px rgba(0,102,255,.1); }
    textarea { min-height: 250px; resize: vertical; }
    .row { display: flex; gap: 1rem; }
    .row > div { flex: 1; }
    .btn { display: inline-block; padding: .75rem 1.5rem; background: #0066ff; color: white; border: none; border-radius: 8px; font-size: 1rem; font-weight: 500; cursor: pointer; width: 100%; margin-top: 1rem; }
    .btn:hover { background: #0052cc; }
    .btn:disabled { background: #ccc; cursor: not-allowed; }
    .status { margin-top: 1rem; padding: 1rem; border-radius: 8px; display: none; font-size: .9rem; line-height: 1.5; white-space: pre-wrap; }
    .status.success { display: block; background: #e8f5e9; color: #2e7d32; }
    .status.error { display: block; background: #fbe9e7; color: #c62828; }
    .status.loading { display: block; background: #e3f2fd; color: #1565c0; }
    .meta { font-size: .85rem; color: #666; margin-top: .5rem; }
    .tabs { display: flex; gap: .5rem; margin-bottom: 1.5rem; }
    .tab { padding: .5rem 1rem; border-radius: 8px; cursor: pointer; font-size: .9rem; background: #eee; border: none; font-family: inherit; }
    .tab.active { background: #0066ff; color: white; }
    .hidden { display: none; }
    .field { margin-bottom: 1rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>straightup Wissenssystem</h1>
    <p class="subtitle">Transkripte und E-Mails an awork senden</p>

    <div class="card" id="login-card">
      <h2>Anmelden</h2>
      <div class="field">
        <label for="master-key">Master-Schlüssel</label>
        <input type="password" id="master-key" autocomplete="current-password">
      </div>
      <button class="btn" id="btn-login">Anmelden</button>
      <div class="status" id="login-status"></div>
    </div>

    <div id="main-content" class="hidden">
    <div class="tabs">
      <button class="tab active" data-tab="transcript">Transkript</button>
      <button class="tab" data-tab="email">E-Mail</button>
    </div>

    <div class="card" id="tab-transcript">
      <div class="row">
        <div class="field">
          <label for="customer">Kunde</label>
          <select id="customer">
            <option value="">Wird geladen...</option>
          </select>
        </div>
        <div class="field">
          <label for="project">Projekt</label>
          <select id="project">
            <option value="">Erst Kunde wählen</option>
          </select>
        </div>
      </div>

      <div class="field">
        <label for="source">Quelle</label>
        <select id="source">
          <option value="krisp">Krisp</option>
          <option value="plaud">Plaud</option>
          <option value="zoom">Zoom</option>
          <option value="teams">Teams</option>
          <option value="manual">Manuell</option>
        </select>
      </div>

      <div class="field">
        <label for="transcript">Transkript</label>
        <textarea id="transcript" placeholder="Transkript hier einfügen..."></textarea>
      </div>

      <button class="btn" id="btn-transcript">Transkript verarbeiten</button>
    </div>

    <div class="card hidden" id="tab-email">
      <div class="row">
        <div class="field">
          <label for="email-customer">Kunde</label>
          <select id="email-customer">
            <option value="">Wird geladen...</option>
          </select>
        </div>
        <div class="field">
          <label for="email-project">Projekt</label>
          <select id="email-project">
            <option value="">Erst Kunde wählen</option>
          </select>
        </div>
      </div>

      <div class="row">
        <div class="field">
          <label for="email-subject">Betreff</label>
          <input type="text" id="email-subject" placeholder="E-Mail Betreff">
        </div>
        <div class="field">
          <label for="email-from">Von</label>
          <input type="text" id="email-from" placeholder="absender@firma.de">
        </div>
      </div>

      <div class="field">
        <label for="email-body">E-Mail-Text</label>
        <textarea id="email-body" placeholder="E-Mail-Inhalt hier einfügen..."></textarea>
      </div>

      <button class="btn" id="btn-email">E-Mail verarbeiten</button>
    </div>

    <div class="status" id="status"></div>
    </div>
  </div>

  <script>
    // Gleicher Storage-Key wie /feedback-admin → einmal anmelden reicht.
    const STORAGE_KEY = 'straightupMasterKey';
    let customers = [];

    // ─── Auth-Helfer ─────────────────────────────────────────────

    function getStoredKey() {
      return sessionStorage.getItem(STORAGE_KEY) || '';
    }

    function authHeaders() {
      return { 'X-API-Key': getStoredKey() };
    }

    function showLogin(message) {
      document.getElementById('main-content').classList.add('hidden');
      document.getElementById('login-card').classList.remove('hidden');
      if (message) showStatusIn('login-status', message, 'error');
    }

    function showMainContent() {
      document.getElementById('login-card').classList.add('hidden');
      document.getElementById('main-content').classList.remove('hidden');
    }

    function handleUnauthorized() {
      sessionStorage.removeItem(STORAGE_KEY);
      showLogin('Schlüssel ungültig oder abgelaufen');
    }

    // ─── Status-Boxen ────────────────────────────────────────────

    function showStatusIn(elId, msg, type) {
      const el = document.getElementById(elId);
      el.className = 'status ' + type;
      el.textContent = msg;
    }

    function showStatus(msg, type) {
      showStatusIn('status', msg, type);
    }

    // ─── Select-Befüllung (XSS-sicher via textContent) ───────────

    function setOptions(selectId, placeholderText, items) {
      const el = document.getElementById(selectId);
      el.innerHTML = '';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = placeholderText;
      el.appendChild(placeholder);
      for (const item of items) {
        const option = document.createElement('option');
        option.value = item;
        option.textContent = item;
        el.appendChild(option);
      }
    }

    // ─── Login ───────────────────────────────────────────────────

    async function attemptLogin(key) {
      try {
        const res = await fetch('/api/customers', { headers: { 'X-API-Key': key } });
        if (res.status === 200) {
          const data = await res.json();
          customers = data.customers || [];
          sessionStorage.setItem(STORAGE_KEY, key);
          showMainContent();
          setOptions('customer', 'Kunde wählen...', customers);
          setOptions('email-customer', 'Kunde wählen...', customers);
          return true;
        }
        if (res.status === 401) {
          showStatusIn('login-status', 'Schlüssel ungültig', 'error');
        } else {
          showStatusIn('login-status', 'Fehler ' + res.status, 'error');
        }
        return false;
      } catch (e) {
        showStatusIn('login-status', 'Verbindung zum Server fehlgeschlagen: ' + e.message, 'error');
        return false;
      }
    }

    document.getElementById('btn-login').addEventListener('click', async () => {
      const key = document.getElementById('master-key').value;
      if (!key) { showStatusIn('login-status', 'Bitte Master-Schlüssel eingeben.', 'error'); return; }
      const btn = document.getElementById('btn-login');
      btn.disabled = true;
      await attemptLogin(key);
      btn.disabled = false;
    });

    document.getElementById('master-key').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('btn-login').click();
    });

    // ─── Tabs ────────────────────────────────────────────────────

    function switchTab(tab) {
      document.querySelectorAll('.tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tab);
      });
      document.getElementById('tab-transcript').classList.toggle('hidden', tab !== 'transcript');
      document.getElementById('tab-email').classList.toggle('hidden', tab !== 'email');
      document.getElementById('status').className = 'status';
    }

    document.querySelectorAll('.tab').forEach(t => {
      t.addEventListener('click', () => switchTab(t.dataset.tab));
    });

    // ─── Projekte laden ──────────────────────────────────────────

    async function loadProjectsInto(customerSel, projectSel) {
      const customer = document.getElementById(customerSel).value;
      if (!customer) { setOptions(projectSel, 'Erst Kunde wählen', []); return; }

      setOptions(projectSel, 'Wird geladen...', []);
      try {
        const res = await fetch('/api/projects?customer=' + encodeURIComponent(customer), { headers: authHeaders() });
        if (res.status === 401) { handleUnauthorized(); return; }
        const data = await res.json();
        const names = (data.projects || []).map(p => p.name);
        setOptions(projectSel, '(kein spezifisches Projekt)', names);
      } catch (e) {
        setOptions(projectSel, 'Fehler beim Laden', []);
      }
    }

    document.getElementById('customer').addEventListener('change', () => loadProjectsInto('customer', 'project'));
    document.getElementById('email-customer').addEventListener('change', () => loadProjectsInto('email-customer', 'email-project'));

    // ─── Absenden ────────────────────────────────────────────────

    async function submitTranscript() {
      const customer = document.getElementById('customer').value;
      const project = document.getElementById('project').value;
      const content = document.getElementById('transcript').value;
      const source = document.getElementById('source').value;

      if (!customer || !content) { showStatus('Bitte Kunde und Transkript angeben.', 'error'); return; }

      const btn = document.getElementById('btn-transcript');
      btn.disabled = true;
      showStatus('Verarbeite Transkript mit Claude AI...', 'loading');

      try {
        const res = await fetch('/api/transcript', {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
          body: JSON.stringify({
            content,
            customerName: customer,
            projectName: project || undefined,
            source,
          }),
        });
        if (res.status === 401) { handleUnauthorized(); btn.disabled = false; return; }
        const data = await res.json();
        if (data.status === 'ok') {
          const r = data.routing;
          showStatus(
            'Transkript verarbeitet!' +
            '\\nTitel: ' + r.title +
            '\\nEntscheidungen: ' + (r.decisionsCount || 0) +
            '\\nAction Items: ' + (r.actionItemsCount || 0) + '\\n\\n' +
            (data.results || []).join('\\n'),
            'success'
          );
        } else {
          showStatus('Fehler: ' + (data.error || data.message || JSON.stringify(data)), 'error');
        }
      } catch (e) {
        showStatus('Fehler: ' + e.message, 'error');
      }
      btn.disabled = false;
    }

    async function submitEmail() {
      const customer = document.getElementById('email-customer').value;
      const project = document.getElementById('email-project').value;
      const subject = document.getElementById('email-subject').value;
      const from = document.getElementById('email-from').value;
      const body = document.getElementById('email-body').value;

      if (!body) { showStatus('Bitte E-Mail-Text angeben.', 'error'); return; }

      const btn = document.getElementById('btn-email');
      btn.disabled = true;
      showStatus('Verarbeite E-Mail mit Claude AI...', 'loading');

      try {
        const res = await fetch('/api/email', {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
          body: JSON.stringify({
            body,
            subject: subject || undefined,
            from: from || undefined,
            customerName: customer || undefined,
            projectName: project || undefined,
          }),
        });
        if (res.status === 401) { handleUnauthorized(); btn.disabled = false; return; }
        const data = await res.json();
        if (data.status === 'ok') {
          const r = data.routing;
          showStatus(
            'E-Mail verarbeitet!' +
            '\\nKategorie: ' + r.emailCategory +
            '\\nTitel: ' + r.title + '\\n' +
            (data.results || []).join('\\n'),
            'success'
          );
        } else {
          showStatus('Fehler: ' + (data.error || data.message || JSON.stringify(data)), 'error');
        }
      } catch (e) {
        showStatus('Fehler: ' + e.message, 'error');
      }
      btn.disabled = false;
    }

    document.getElementById('btn-transcript').addEventListener('click', submitTranscript);
    document.getElementById('btn-email').addEventListener('click', submitEmail);

    // ─── Init ────────────────────────────────────────────────────

    (async function init() {
      const storedKey = getStoredKey();
      if (storedKey) await attemptLogin(storedKey);
    })();
  </script>
</body>
</html>`;

router.get('/', (_req: Request, res: Response) => {
  res.type('html').send(HTML);
});

export default router;
