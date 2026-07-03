import { Router, Request, Response } from 'express';

const router = Router();

const HTML = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>straightup BugBee – Verbindungen</title>
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
    textarea { min-height: 80px; resize: vertical; }
    .row { display: flex; gap: 1rem; }
    .row > div { flex: 1; }
    .btn { display: inline-block; padding: .75rem 1.5rem; background: #0066ff; color: white; border: none; border-radius: 8px; font-size: 1rem; font-weight: 500; cursor: pointer; width: 100%; margin-top: 1rem; }
    .btn:hover { background: #0052cc; }
    .btn:disabled { background: #ccc; cursor: not-allowed; }
    .btn-secondary { background: #eee; color: #1a1a1a; width: auto; padding: .5rem 1rem; font-size: .85rem; margin-top: .75rem; }
    .btn-secondary:hover { background: #ddd; }
    .btn-revoke { background: #fbe9e7; color: #c62828; width: auto; padding: .4rem .8rem; font-size: .85rem; margin-top: 0; }
    .btn-revoke:hover { background: #f8d7d2; }
    .status { margin-top: 1rem; padding: 1rem; border-radius: 8px; display: none; font-size: .9rem; line-height: 1.5; word-break: break-word; }
    .status.success { display: block; background: #e8f5e9; color: #2e7d32; }
    .status.error { display: block; background: #fbe9e7; color: #c62828; }
    .status.loading { display: block; background: #e3f2fd; color: #1565c0; }
    .meta { font-size: .85rem; color: #666; margin-top: .5rem; }
    .hidden { display: none; }
    .field { margin-bottom: 1rem; }
    .radio-group { display: flex; gap: 1.5rem; }
    .radio-option { display: flex; align-items: center; gap: .4rem; font-weight: 400; }
    .radio-option input { width: auto; }
    .key-box { background: #f5f5f5; border-radius: 8px; padding: .75rem; font-family: 'SF Mono', Consolas, monospace; font-size: .9rem; word-break: break-all; margin: .5rem 0; }
    table { width: 100%; border-collapse: collapse; font-size: .9rem; }
    th, td { text-align: left; padding: .6rem .5rem; border-bottom: 1px solid #eee; }
    th { color: #666; font-weight: 500; font-size: .8rem; text-transform: uppercase; }
    .badge { display: inline-block; padding: .15rem .5rem; border-radius: 999px; font-size: .8rem; }
    .badge.active { background: #e8f5e9; color: #2e7d32; }
    .badge.revoked { background: #f0f0f0; color: #888; }
    .empty-hint { color: #888; font-size: .9rem; padding: .5rem 0; }
  </style>
</head>
<body>
  <div class="container">
    <h1>straightup BugBee</h1>
    <p class="subtitle">Website mit einem awork-Projekt verbinden</p>

    <div class="card" id="login-card">
      <h2>Anmelden</h2>
      <div class="field">
        <label for="master-key">Master-Schlüssel</label>
        <input type="password" id="master-key" placeholder="fbk-admin-...">
      </div>
      <button class="btn" id="btn-login">Anmelden</button>
      <div class="status" id="login-status"></div>
    </div>

    <div id="main-content" class="hidden">
      <div class="card">
        <h2>Neue Verbindung anlegen</h2>

        <div class="field">
          <label for="project-input">awork-Projekt</label>
          <input type="text" id="project-input" list="project-list" placeholder="Projekt suchen...">
          <datalist id="project-list"></datalist>
        </div>

        <div class="field">
          <label for="domains">Domain(s)</label>
          <textarea id="domains" placeholder="kunde.de, www.kunde.de&#10;oder je Zeile eine Domain"></textarea>
        </div>

        <div class="field">
          <label>Typ</label>
          <div class="radio-group">
            <label class="radio-option"><input type="radio" name="type" value="internal" checked> Intern (Team)</label>
            <label class="radio-option"><input type="radio" name="type" value="customer"> Kunde</label>
          </div>
        </div>

        <div class="field hidden" id="assignee-field">
          <label for="assignee">Standard-Assignee</label>
          <select id="assignee">
            <option value="">Projekt wählen...</option>
          </select>
        </div>

        <div class="field">
          <label for="label">Label</label>
          <input type="text" id="label" placeholder="z.B. Kunde XY – Website">
        </div>

        <button class="btn" id="btn-create">Verbindung anlegen</button>
        <div class="status" id="create-status"></div>
      </div>

      <div class="card">
        <h2>Bestehende Verbindungen</h2>
        <table>
          <thead>
            <tr>
              <th>Label</th>
              <th>Domain(s)</th>
              <th>Typ</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="connections-body"></tbody>
        </table>
        <div class="empty-hint hidden" id="connections-empty">Noch keine Verbindungen angelegt.</div>
        <div class="status" id="table-status"></div>
      </div>
    </div>
  </div>

  <script>
    const STORAGE_KEY = 'feedbackAdminKey';
    let projects = [];
    let labelManuallyEdited = false;

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
      if (message) {
        showStatus('login-status', message, 'error');
      }
    }

    function showMainContent() {
      document.getElementById('login-card').classList.add('hidden');
      document.getElementById('main-content').classList.remove('hidden');
    }

    function handleUnauthorized() {
      sessionStorage.removeItem(STORAGE_KEY);
      showLogin('Schlüssel ungültig');
    }

    // ─── Status-Boxen ────────────────────────────────────────────

    function showStatus(elId, msg, type) {
      const el = document.getElementById(elId);
      el.className = 'status ' + type;
      el.textContent = msg;
    }

    function clearStatus(elId) {
      const el = document.getElementById(elId);
      el.className = 'status';
      el.textContent = '';
    }

    function networkErrorMessage(e) {
      return 'Verbindung zum Server fehlgeschlagen: ' + e.message;
    }

    async function serverErrorMessage(res) {
      try {
        const data = await res.json();
        return data.message || data.error || ('Fehler ' + res.status);
      } catch {
        return 'Fehler ' + res.status;
      }
    }

    // ─── Login ───────────────────────────────────────────────────

    async function attemptLogin(key) {
      clearStatus('login-status');
      try {
        const res = await fetch('/api/feedback-keys/projects', { headers: { 'X-API-Key': key } });
        if (res.status === 200) {
          const data = await res.json();
          sessionStorage.setItem(STORAGE_KEY, key);
          showMainContent();
          populateProjects(data);
          await loadConnections();
          return true;
        } else if (res.status === 401) {
          showStatus('login-status', 'Schlüssel ungültig', 'error');
          return false;
        } else {
          showStatus('login-status', await serverErrorMessage(res), 'error');
          return false;
        }
      } catch (e) {
        showStatus('login-status', networkErrorMessage(e), 'error');
        return false;
      }
    }

    document.getElementById('btn-login').addEventListener('click', async () => {
      const key = document.getElementById('master-key').value;
      if (!key) { showStatus('login-status', 'Bitte Master-Schlüssel eingeben.', 'error'); return; }
      const btn = document.getElementById('btn-login');
      btn.disabled = true;
      await attemptLogin(key);
      btn.disabled = false;
    });

    document.getElementById('master-key').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        document.getElementById('btn-login').click();
      }
    });

    // ─── Projekte / Datalist ─────────────────────────────────────

    function populateProjects(data) {
      projects = Array.isArray(data) ? data : [];
      const list = document.getElementById('project-list');
      list.innerHTML = '';
      for (const p of projects) {
        const option = document.createElement('option');
        option.value = p.name;
        option.setAttribute('data-id', p.id);
        list.appendChild(option);
      }
    }

    function findProjectByName(name) {
      return projects.find(p => p.name === name);
    }

    document.getElementById('project-input').addEventListener('input', async () => {
      const name = document.getElementById('project-input').value;
      const project = findProjectByName(name);
      if (!project) return;

      if (!labelManuallyEdited) {
        document.getElementById('label').value = project.name;
      }

      await loadAssignees(project.id);
    });

    document.getElementById('label').addEventListener('input', () => {
      labelManuallyEdited = true;
    });

    // ─── Typ-Umschaltung ─────────────────────────────────────────

    function updateAssigneeVisibility() {
      const type = document.querySelector('input[name="type"]:checked').value;
      document.getElementById('assignee-field').classList.toggle('hidden', type !== 'customer');
    }

    document.querySelectorAll('input[name="type"]').forEach(el => {
      el.addEventListener('change', updateAssigneeVisibility);
    });

    // ─── Assignees laden ─────────────────────────────────────────

    async function loadAssignees(projectId) {
      const select = document.getElementById('assignee');
      select.innerHTML = '';
      const loadingOption = document.createElement('option');
      loadingOption.value = '';
      loadingOption.textContent = 'Wird geladen...';
      select.appendChild(loadingOption);

      try {
        const res = await fetch('/api/feedback-keys/project-members/' + encodeURIComponent(projectId), { headers: authHeaders() });
        if (res.status === 401) { handleUnauthorized(); return; }
        if (!res.ok) {
          select.innerHTML = '';
          const errOption = document.createElement('option');
          errOption.value = '';
          errOption.textContent = 'Fehler beim Laden';
          select.appendChild(errOption);
          return;
        }
        const members = await res.json();
        select.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Assignee wählen...';
        select.appendChild(placeholder);
        for (const m of members) {
          const option = document.createElement('option');
          option.value = m.id;
          option.textContent = m.name;
          select.appendChild(option);
        }
      } catch (e) {
        select.innerHTML = '';
        const errOption = document.createElement('option');
        errOption.value = '';
        errOption.textContent = 'Fehler beim Laden';
        select.appendChild(errOption);
      }
    }

    // ─── Verbindung anlegen ──────────────────────────────────────

    document.getElementById('btn-create').addEventListener('click', async () => {
      clearStatus('create-status');

      const projectName = document.getElementById('project-input').value;
      const project = findProjectByName(projectName);
      const domainsRaw = document.getElementById('domains').value;
      const type = document.querySelector('input[name="type"]:checked').value;
      const assigneeId = document.getElementById('assignee').value;
      const label = document.getElementById('label').value;

      if (!project) { showStatus('create-status', 'Bitte ein gültiges awork-Projekt auswählen.', 'error'); return; }

      const domains = domainsRaw.split(/[,\n]/).map(d => d.trim()).filter(d => d.length > 0);
      if (domains.length === 0) { showStatus('create-status', 'Bitte mindestens eine Domain angeben.', 'error'); return; }

      if (!label) { showStatus('create-status', 'Bitte ein Label angeben.', 'error'); return; }

      if (type === 'customer' && !assigneeId) {
        showStatus('create-status', 'Bitte einen Standard-Assignee auswählen.', 'error');
        return;
      }

      const body = { projectId: project.id, domains, type, label };
      if (type === 'customer') {
        body.defaultAssigneeId = assigneeId;
      }

      const btn = document.getElementById('btn-create');
      btn.disabled = true;
      showStatus('create-status', 'Verbindung wird angelegt...', 'loading');

      try {
        const res = await fetch('/api/feedback-keys', {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
          body: JSON.stringify(body),
        });

        if (res.status === 401) { handleUnauthorized(); btn.disabled = false; return; }

        if (res.status === 201) {
          const record = await res.json();
          renderSuccessBox(record.key);
          await loadConnections();
        } else {
          showStatus('create-status', await serverErrorMessage(res), 'error');
        }
      } catch (e) {
        showStatus('create-status', networkErrorMessage(e), 'error');
      }
      btn.disabled = false;
    });

    function renderSuccessBox(key) {
      const el = document.getElementById('create-status');
      el.className = 'status success';
      el.innerHTML = '';

      const keyBox = document.createElement('div');
      keyBox.className = 'key-box';
      keyBox.textContent = key;
      el.appendChild(keyBox);

      const copyBtn = document.createElement('button');
      copyBtn.className = 'btn btn-secondary';
      copyBtn.textContent = 'Kopieren';
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(key);
        copyBtn.textContent = 'Kopiert!';
        setTimeout(() => { copyBtn.textContent = 'Kopieren'; }, 1500);
      });
      el.appendChild(copyBtn);

      const instructions = document.createElement('div');
      instructions.className = 'meta';
      instructions.innerHTML = '1. straightup BugBee in Chrome installieren.<br>2. Auf der Website das BugBee-Icon klicken.<br>3. Diesen Schlüssel einmal eingeben.';
      el.appendChild(instructions);
    }

    // ─── Verbindungen-Tabelle ────────────────────────────────────

    async function loadConnections() {
      clearStatus('table-status');
      try {
        const res = await fetch('/api/feedback-keys', { headers: authHeaders() });
        if (res.status === 401) { handleUnauthorized(); return; }
        if (!res.ok) {
          showStatus('table-status', await serverErrorMessage(res), 'error');
          return;
        }
        const records = await res.json();
        renderConnections(records);
      } catch (e) {
        showStatus('table-status', networkErrorMessage(e), 'error');
      }
    }

    function renderConnections(records) {
      const tbody = document.getElementById('connections-body');
      tbody.innerHTML = '';
      document.getElementById('connections-empty').classList.toggle('hidden', records.length > 0);

      for (const record of records) {
        const row = document.createElement('tr');
        row.innerHTML = '<td></td><td></td><td></td><td></td><td></td>';

        row.cells[0].textContent = record.label;
        row.cells[1].textContent = (record.domains || []).join(', ');
        row.cells[2].textContent = record.type === 'internal' ? 'Intern' : 'Kunde';

        const isActive = record.revokedAt === null;
        const badge = document.createElement('span');
        badge.className = 'badge ' + (isActive ? 'active' : 'revoked');
        badge.textContent = isActive ? 'aktiv' : 'widerrufen';
        row.cells[3].appendChild(badge);

        if (isActive) {
          const revokeBtn = document.createElement('button');
          revokeBtn.className = 'btn btn-revoke';
          revokeBtn.textContent = 'Widerrufen';
          revokeBtn.addEventListener('click', () => revokeKey(record.key));
          row.cells[4].appendChild(revokeBtn);
        }

        tbody.appendChild(row);
      }
    }

    async function revokeKey(key) {
      clearStatus('table-status');
      try {
        const res = await fetch('/api/feedback-keys/' + encodeURIComponent(key), {
          method: 'DELETE',
          headers: authHeaders(),
        });
        if (res.status === 401) { handleUnauthorized(); return; }
        if (res.status === 204 || res.status === 404) {
          await loadConnections();
        } else {
          showStatus('table-status', await serverErrorMessage(res), 'error');
        }
      } catch (e) {
        showStatus('table-status', networkErrorMessage(e), 'error');
      }
    }

    // ─── Init ────────────────────────────────────────────────────

    updateAssigneeVisibility();

    (async function init() {
      const storedKey = getStoredKey();
      if (storedKey) {
        await attemptLogin(storedKey);
      }
    })();
  </script>
</body>
</html>`;

router.get('/feedback-admin', (_req: Request, res: Response) => {
  res.type('html').send(HTML);
});

export default router;
