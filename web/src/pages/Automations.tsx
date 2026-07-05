import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, AutomationStatus, formatDateTime } from '../lib/api';
import { StatusBadge, runBadge } from '../components/StatusBadge';
import { useAuth } from '../App';

export default function AutomationsPage() {
  const { user } = useAuth();
  const [automations, setAutomations] = useState<AutomationStatus[]>([]);
  const [error, setError] = useState('');

  const load = () => api.automations().then(setAutomations).catch(e => setError(e.message));
  useEffect(() => { load(); }, []);

  const toggle = async (a: AutomationStatus) => {
    try {
      await api.patchAutomation(a.id, { enabled: !a.enabled });
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div>
      <h1 className="font-heading text-2xl font-semibold mb-6">Automationen</h1>
      {error && <p className="mb-4 text-sm text-brand-coral">{error}</p>}
      <div className="space-y-4">
        {automations.map(a => (
          <div key={a.id} className="card flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Link to={`/automationen/${a.id}`} className="font-heading font-semibold hover:text-brand-green">
                {a.name}
              </Link>
              <p className="text-sm text-neutral-500 mt-0.5">{a.description}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                {a.enabled
                  ? <StatusBadge kind="ok">aktiv</StatusBadge>
                  : <StatusBadge kind="muted">aus</StatusBadge>}
                {(a.settings as any)?.dryRun === true && <StatusBadge kind="running">Dry-Run</StatusBadge>}
                {a.lastRun && <>letzter Lauf: {runBadge(a.lastRun.status)} {formatDateTime(a.lastRun.startedAt)}</>}
                {a.enabled && a.nextRunAt && <>· nächster: {formatDateTime(a.nextRunAt)}</>}
              </div>
            </div>
            {user?.role === 'admin' && (
              <button
                onClick={() => toggle(a)}
                className={a.enabled ? 'btn-danger shrink-0' : 'btn-primary shrink-0'}
              >
                {a.enabled ? 'Deaktivieren' : 'Aktivieren'}
              </button>
            )}
          </div>
        ))}
        {automations.length === 0 && !error && <p className="text-neutral-400">Lade…</p>}
      </div>
    </div>
  );
}
