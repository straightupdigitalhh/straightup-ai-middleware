import { useCallback, useEffect, useState } from 'react';
import { api, FeedbackKey, FeedbackMember, FeedbackProject, formatDateTime } from '../lib/api';
import { useAuth } from '../App';

export default function BugBeePage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [keys, setKeys] = useState<FeedbackKey[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // Sichtbarer Klartext-Key je Verbindung (nach „anzeigen")
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setKeys(await api.feedbackKeys());
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage('Schlüssel in die Zwischenablage kopiert');
      setTimeout(() => setMessage(''), 2500);
    } catch {
      setMessage('Kopieren nicht möglich – bitte manuell markieren');
    }
  };

  const reveal = async (id: string) => {
    setError('');
    try {
      const { key } = await api.revealFeedbackKey(id);
      setRevealed(prev => ({ ...prev, [id]: key }));
    } catch (e: any) {
      setError(e.message);
    }
  };

  const revoke = async (id: string) => {
    if (!confirm('Verbindung widerrufen? Der Schlüssel funktioniert danach nicht mehr.')) return;
    setError('');
    try {
      await api.revokeFeedbackKey(id);
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Verbindung endgültig aus der Liste löschen? Das lässt sich nicht rückgängig machen.')) return;
    setError('');
    try {
      await api.deleteFeedbackKey(id);
      setRevealed(prev => { const n = { ...prev }; delete n[id]; return n; });
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-semibold">BugBee</h1>
        <p className="text-neutral-500 text-sm mt-1">
          Feedback-Verbindungen verwalten. Der Verbindungsschlüssel wird auf jedem Gerät einmal
          in der Extension eingetragen und lässt sich hier jederzeit erneut anzeigen.
        </p>
      </div>

      {message && <p className="mb-3 text-sm text-brand-green">{message}</p>}
      {error && <p className="mb-3 text-sm text-brand-coral">{error}</p>}

      {isAdmin && <CreateForm onCreated={load} onNotice={setMessage} />}

      <h2 className="font-heading font-semibold mb-3">Verbindungen</h2>
      <div className="space-y-3">
        {keys.map(k => {
          const active = k.revokedAt === null;
          return (
            <div key={k.id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{k.label}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${
                      k.type === 'customer' ? 'bg-brand-mint/40 text-brand-ink' : 'bg-neutral-100 text-neutral-600'
                    }`}>
                      {k.type === 'customer' ? 'Kunde' : 'intern'}
                    </span>
                    {active
                      ? <span className="rounded-full bg-brand-green/15 text-brand-green px-2 py-0.5 text-xs">aktiv</span>
                      : <span className="rounded-full bg-neutral-100 text-neutral-500 px-2 py-0.5 text-xs">widerrufen</span>}
                  </div>
                  <div className="text-sm text-neutral-500 mt-1 break-words">{k.domains.join(', ')}</div>
                  <div className="text-xs text-neutral-400 mt-1">
                    angelegt {formatDateTime(k.createdAt)} · {k.keyPrefix}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  {isAdmin && (
                    <button className="btn-secondary" onClick={() => reveal(k.id)}>Schlüssel anzeigen</button>
                  )}
                  {active && isAdmin && (
                    <button className="btn-secondary" onClick={() => revoke(k.id)}>Widerrufen</button>
                  )}
                  {!active && isAdmin && (
                    <button className="btn-danger" onClick={() => remove(k.id)}>Löschen</button>
                  )}
                </div>
              </div>

              {revealed[k.id] && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-neutral-50 border border-neutral-200 p-3">
                  <code className="font-mono text-sm break-all flex-1 min-w-0">{revealed[k.id]}</code>
                  <button className="btn-secondary shrink-0" onClick={() => copy(revealed[k.id])}>Kopieren</button>
                  <button
                    className="text-xs text-neutral-400 hover:text-brand-ink shrink-0"
                    onClick={() => setRevealed(prev => { const n = { ...prev }; delete n[k.id]; return n; })}
                  >ausblenden</button>
                </div>
              )}
            </div>
          );
        })}
        {keys.length === 0 && !error && (
          <p className="text-neutral-400 text-sm">Noch keine Verbindungen angelegt.</p>
        )}
      </div>
    </div>
  );
}

// ─── Anlage-Formular ─────────────────────────────────────────────

function CreateForm({ onCreated, onNotice }: { onCreated: () => void; onNotice: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<FeedbackProject[]>([]);
  const [members, setMembers] = useState<FeedbackMember[]>([]);

  const [label, setLabel] = useState('');
  const [projectId, setProjectId] = useState('');
  const [domains, setDomains] = useState('');
  const [type, setType] = useState<'internal' | 'customer'>('internal');
  const [assigneeId, setAssigneeId] = useState('');

  const [newKey, setNewKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.feedbackProjects().then(setProjects).catch(e => setError(e.message));
  }, [open]);

  useEffect(() => {
    setAssigneeId('');
    setMembers([]);
    if (type === 'customer' && projectId) {
      api.feedbackProjectMembers(projectId).then(setMembers).catch(e => setError(e.message));
    }
  }, [type, projectId]);

  const submit = async () => {
    setError(''); setNewKey('');
    const domainList = domains.split(',').map(d => d.trim()).filter(Boolean);
    if (!label.trim()) { setError('Bezeichnung fehlt'); return; }
    if (!projectId) { setError('Projekt auswählen'); return; }
    if (domainList.length === 0) { setError('Mindestens eine Domain angeben'); return; }
    if (type === 'customer' && !assigneeId) { setError('Standard-Empfänger für Kunden-Keys wählen'); return; }
    setBusy(true);
    try {
      const res = await api.createFeedbackKey({
        label: label.trim(), projectId, domains: domainList, type,
        defaultAssigneeId: type === 'customer' ? assigneeId : null,
      });
      setNewKey(res.key);
      onNotice('Verbindung angelegt');
      setLabel(''); setDomains(''); setAssigneeId('');
      onCreated();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button className="btn-primary mb-6" onClick={() => setOpen(true)}>+ Neue Verbindung</button>
    );
  }

  return (
    <div className="card mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-heading font-semibold">Neue Verbindung</h2>
        <button className="text-sm text-neutral-400 hover:text-brand-ink" onClick={() => setOpen(false)}>schließen</button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="label">Bezeichnung</label>
          <input className="input" value={label} onChange={e => setLabel(e.target.value)}
            placeholder="z. B. Kunde XY – Website" />
        </div>
        <div>
          <label className="label">Projekt</label>
          <select className="input" value={projectId} onChange={e => setProjectId(e.target.value)}>
            <option value="">– auswählen –</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Domains (kommagetrennt)</label>
          <input className="input" value={domains} onChange={e => setDomains(e.target.value)}
            placeholder="kunde.de, www.kunde.de" />
        </div>
        <div>
          <label className="label">Typ</label>
          <select className="input" value={type} onChange={e => setType(e.target.value as 'internal' | 'customer')}>
            <option value="internal">intern (Team, mit Zuweisung)</option>
            <option value="customer">Kunde (fester Empfänger)</option>
          </select>
        </div>
        {type === 'customer' && (
          <div className="md:col-span-2">
            <label className="label">Standard-Empfänger (awork-Mensch)</label>
            <select className="input" value={assigneeId} onChange={e => setAssigneeId(e.target.value)}
              disabled={!projectId}>
              <option value="">{projectId ? '– auswählen –' : 'erst Projekt wählen'}</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-brand-coral">{error}</p>}

      {newKey ? (
        <div className="mt-4 rounded-lg bg-brand-mint/20 border border-brand-mint p-4">
          <p className="text-sm mb-2">Verbindung angelegt. Dieser Schlüssel gehört in die Extension:</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="font-mono text-sm break-all flex-1 min-w-0">{newKey}</code>
            <button className="btn-secondary shrink-0"
              onClick={() => navigator.clipboard.writeText(newKey).then(() => onNotice('Schlüssel kopiert'))}>
              Kopieren
            </button>
          </div>
          <p className="text-xs text-neutral-500 mt-2">
            Kein Stress – du kannst ihn später jederzeit über „Schlüssel anzeigen" erneut aufrufen.
          </p>
        </div>
      ) : (
        <button className="btn-primary mt-4" onClick={submit} disabled={busy}>
          {busy ? 'Lege an…' : 'Verbindung anlegen'}
        </button>
      )}
    </div>
  );
}
