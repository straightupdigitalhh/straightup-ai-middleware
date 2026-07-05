import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, AutomationRun, AutomationStatus, formatDateTime } from '../lib/api';
import { runBadge } from '../components/StatusBadge';
import { useAuth } from '../App';

export default function AutomationDetailPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [automation, setAutomation] = useState<AutomationStatus | null>(null);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [openRun, setOpenRun] = useState<number | null>(null);
  const [settingsText, setSettingsText] = useState('');
  const [cron, setCron] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      // Detail (inkl. Settings) nur für Admins; Member sehen die Liste
      const a = isAdmin
        ? await api.automation(id)
        : (await api.automations()).find(x => x.id === id) ?? null;
      setAutomation(a);
      if (a) {
        setCron(a.cron ?? '');
        if (a.settings) setSettingsText(JSON.stringify(a.settings, null, 2));
      }
      setRuns(await api.automationRuns(id));
    } catch (e: any) {
      setError(e.message);
    }
  }, [id, isAdmin]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setError(''); setMessage('');
    let settings: Record<string, unknown> | undefined;
    if (isAdmin && settingsText.trim()) {
      try {
        settings = JSON.parse(settingsText);
      } catch {
        setError('Settings sind kein gültiges JSON');
        return;
      }
    }
    try {
      await api.patchAutomation(id, { cron: cron || null, settings });
      setMessage('Gespeichert');
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const runNow = async () => {
    setError(''); setMessage('');
    try {
      const { runId } = await api.runAutomation(id);
      setMessage(`Lauf ${runId} gestartet…`);
      // kurz warten, dann Historie aktualisieren
      setTimeout(load, 1500);
      setTimeout(load, 5000);
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (!automation) {
    return <p className="text-neutral-400">{error || 'Lade…'}</p>;
  }

  return (
    <div>
      <Link to="/automationen" className="text-sm text-neutral-400 hover:text-brand-ink">← Automationen</Link>
      <div className="flex items-start justify-between gap-4 mt-2 mb-6">
        <div>
          <h1 className="font-heading text-2xl font-semibold">{automation.name}</h1>
          <p className="text-neutral-500 text-sm mt-1">{automation.description}</p>
        </div>
        {isAdmin && (
          <button onClick={runNow} className="btn-primary shrink-0" disabled={automation.running}>
            {automation.running ? 'läuft…' : 'Jetzt ausführen'}
          </button>
        )}
      </div>

      {message && <p className="mb-3 text-sm text-brand-green">{message}</p>}
      {error && <p className="mb-3 text-sm text-brand-coral">{error}</p>}

      {isAdmin && (
        <div className="card mb-6">
          <h2 className="font-heading font-semibold mb-3">Konfiguration</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="label" htmlFor="cron">Zeitplan (Cron, Europe/Berlin)</label>
              <input id="cron" className="input font-mono" value={cron} onChange={e => setCron(e.target.value)}
                placeholder="55 8 * * 1-5" />
              <p className="mt-1 text-xs text-neutral-400">leer = nur manuell ausführbar</p>
            </div>
            <div>
              <label className="label" htmlFor="settings">Settings (JSON)</label>
              <textarea id="settings" className="input font-mono min-h-32" value={settingsText}
                onChange={e => setSettingsText(e.target.value)} spellCheck={false} />
            </div>
          </div>
          <button onClick={save} className="btn-primary mt-4">Speichern</button>
        </div>
      )}

      <h2 className="font-heading font-semibold mb-3">Läufe</h2>
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-neutral-400 border-b border-neutral-100">
              <th className="px-4 py-2">Start</th>
              <th className="px-4 py-2">Auslöser</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Ergebnis</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {runs.map(run => (
              <>
                <tr key={run.id} className="border-b border-neutral-50">
                  <td className="px-4 py-2 whitespace-nowrap">{formatDateTime(run.startedAt)}</td>
                  <td className="px-4 py-2">{run.trigger === 'manual' ? 'manuell' : 'Zeitplan'}</td>
                  <td className="px-4 py-2">{runBadge(run.status)}</td>
                  <td className="px-4 py-2 text-neutral-600">{run.summary || run.error || '–'}</td>
                  <td className="px-4 py-2 text-right">
                    {run.log && (
                      <button
                        className="text-xs text-neutral-400 hover:text-brand-ink"
                        onClick={() => setOpenRun(openRun === run.id ? null : run.id)}
                      >
                        {openRun === run.id ? 'Log ausblenden' : 'Log'}
                      </button>
                    )}
                  </td>
                </tr>
                {openRun === run.id && run.log && (
                  <tr key={`${run.id}-log`}>
                    <td colSpan={5} className="px-4 py-3 bg-neutral-50">
                      <pre className="text-xs whitespace-pre-wrap text-neutral-600">{run.log}</pre>
                    </td>
                  </tr>
                )}
              </>
            ))}
            {runs.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-neutral-400">Noch keine Läufe</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
