export function StatusBadge({ kind, children }: { kind: 'ok' | 'error' | 'muted' | 'running'; children: string }) {
  const styles = {
    ok: 'bg-brand-mint/50 text-green-900',
    error: 'bg-red-50 text-brand-coral',
    muted: 'bg-neutral-100 text-neutral-500',
    running: 'bg-blue-50 text-blue-700',
  }[kind];
  return <span className={`inline-block rounded-pill px-3 py-0.5 text-xs font-medium ${styles}`}>{children}</span>;
}

export function runBadge(status: 'running' | 'ok' | 'error') {
  if (status === 'ok') return <StatusBadge kind="ok">ok</StatusBadge>;
  if (status === 'error') return <StatusBadge kind="error">Fehler</StatusBadge>;
  return <StatusBadge kind="running">läuft…</StatusBadge>;
}
