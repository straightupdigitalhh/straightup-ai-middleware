import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, AutomationStatus, formatDateTime } from '../lib/api';
import { StatusBadge } from '../components/StatusBadge';

export default function DashboardPage() {
  const [automations, setAutomations] = useState<AutomationStatus[]>([]);
  const [health, setHealth] = useState<Record<string, string>>({});

  useEffect(() => {
    api.automations().then(setAutomations).catch(() => {});
    api.health().then(h => setHealth(h.checks)).catch(() => setHealth({ middleware: 'nicht erreichbar' }));
  }, []);

  const active = automations.filter(a => a.enabled);
  const lastError = automations.find(a => a.lastRun?.status === 'error');

  return (
    <div>
      <h1 className="font-heading text-2xl font-semibold mb-6">Dashboard</h1>

      <div className="grid gap-4 md:grid-cols-3 mb-8">
        <div className="card">
          <div className="text-sm text-neutral-500 mb-1">System</div>
          <div className="flex items-center gap-2">
            <StatusBadge kind={health.awork?.startsWith('ok') ? 'ok' : 'error'}>
              {health.awork?.startsWith('ok') ? 'awork verbunden' : 'awork gestört'}
            </StatusBadge>
          </div>
          <div className="mt-2 text-xs text-neutral-400">{health.emailPolling || '–'}</div>
        </div>
        <div className="card">
          <div className="text-sm text-neutral-500 mb-1">Automationen</div>
          <div className="text-2xl font-heading font-semibold">
            {active.length}<span className="text-sm text-neutral-400 font-body"> / {automations.length} aktiv</span>
          </div>
          {lastError && (
            <div className="mt-1 text-xs text-brand-coral">Letzter Lauf von „{lastError.name}" schlug fehl</div>
          )}
        </div>
        <div className="card">
          <div className="text-sm text-neutral-500 mb-1">Nächster Lauf</div>
          <div className="text-sm font-medium">
            {formatDateTime(
              active.map(a => a.nextRunAt).filter(Boolean).sort()[0] ?? null,
            )}
          </div>
        </div>
      </div>

      <h2 className="font-heading text-lg font-semibold mb-3">Module</h2>
      <div className="grid gap-4 md:grid-cols-3">
        <Link to="/automationen" className="card hover:border-brand-green transition">
          <h3 className="font-heading font-semibold mb-1">Automationen</h3>
          <p className="text-sm text-neutral-500">Zeiterfassungs-Mails & Co. verwalten, Läufe einsehen</p>
        </Link>
        <a href="/wissenssystem" className="card hover:border-brand-green transition">
          <h3 className="font-heading font-semibold mb-1">Wissenssystem ↗</h3>
          <p className="text-sm text-neutral-500">Transkripte und E-Mails an awork senden</p>
        </a>
        <a href="/feedback-admin" className="card hover:border-brand-green transition">
          <h3 className="font-heading font-semibold mb-1">BugBee ↗</h3>
          <p className="text-sm text-neutral-500">Website-Feedback-Verbindungen verwalten</p>
        </a>
      </div>
    </div>
  );
}
