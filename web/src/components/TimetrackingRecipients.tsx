import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, TimetrackingUser } from '../lib/api';

interface Props {
  automationId: string;
  settings: Record<string, unknown>;
  onSaved: () => void;
}

/**
 * Komfort-Auswahl der Empfänger für die beiden Zeiterfassungs-Automationen
 * – statt Empfänger von Hand ins Settings-JSON zu schreiben.
 *
 * - timetracking-personal: Häkchen je Mitarbeiter (bekommt eigene Erinnerung).
 *   Ohne Häkchen landet die awork-User-ID in excludeUserIds. Fehlt in awork
 *   eine E-Mail, kann hier eine Adresse als userEmails-Override hinterlegt werden.
 * - timetracking-digest: Empfänger des Management-Digests (freie Adressliste,
 *   Mitarbeiter-Adressen per Klick, externe Adressen per Eingabe).
 */
export default function TimetrackingRecipients({ automationId, settings, onSaved }: Props) {
  const isPersonal = automationId === 'timetracking-personal';
  const isDigest = automationId === 'timetracking-digest';

  const [users, setUsers] = useState<TimetrackingUser[]>([]);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // personal
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  // digest
  const [digestRecipients, setDigestRecipients] = useState<string[]>([]);
  const [newRecipient, setNewRecipient] = useState('');

  useEffect(() => {
    setExcluded(new Set((settings.excludeUserIds as string[]) || []));
    setOverrides({ ...((settings.userEmails as Record<string, string>) || {}) });
    setDigestRecipients([...((settings.digestRecipients as string[]) || [])]);
  }, [settings]);

  const loadUsers = useCallback(async () => {
    try {
      setUsers(await api.timetrackingUsers());
    } catch (e: any) {
      setLoadError(e.message);
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const receivingCount = useMemo(
    () => users.filter(u => !excluded.has(u.id)).length,
    [users, excluded],
  );

  const toggleExcluded = (id: string) => {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleDigest = (email: string) => {
    setDigestRecipients(prev =>
      prev.includes(email) ? prev.filter(e => e !== email) : [...prev, email],
    );
  };

  const addRecipient = () => {
    const email = newRecipient.trim();
    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Keine gültige E-Mail-Adresse');
      return;
    }
    setError('');
    if (!digestRecipients.includes(email)) setDigestRecipients(prev => [...prev, email]);
    setNewRecipient('');
  };

  const save = async () => {
    setSaving(true); setError(''); setMessage('');
    try {
      const patch: Record<string, unknown> = { ...settings };
      if (isPersonal) {
        patch.excludeUserIds = [...excluded];
        // nur nicht-leere Overrides behalten
        const cleaned: Record<string, string> = {};
        for (const [id, mail] of Object.entries(overrides)) {
          if (mail.trim()) cleaned[id] = mail.trim();
        }
        patch.userEmails = cleaned;
      }
      if (isDigest) {
        patch.digestRecipients = digestRecipients;
      }
      await api.patchAutomation(automationId, { settings: patch });
      setMessage('Empfänger gespeichert');
      onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!isPersonal && !isDigest) return null;

  return (
    <div className="card mb-6">
      <h2 className="font-heading font-semibold mb-1">Empfänger</h2>
      {isPersonal && (
        <p className="text-sm text-neutral-500 mb-4">
          Wer bekommt morgens die eigene Zeiten-Erinnerung? {receivingCount} von {users.length} Mitarbeitenden ausgewählt.
        </p>
      )}
      {isDigest && (
        <p className="text-sm text-neutral-500 mb-4">
          Wer bekommt den Management-Digest mit den Zeiten aller Mitarbeitenden?
        </p>
      )}

      {loadError && (
        <p className="text-sm text-brand-coral mb-3">
          awork-Nutzerliste konnte nicht geladen werden: {loadError}
        </p>
      )}

      {isPersonal && (
        <div className="divide-y divide-neutral-100 border-y border-neutral-100">
          {users.map(u => (
            <div key={u.id} className="flex items-center gap-3 py-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-brand-green"
                checked={!excluded.has(u.id)}
                onChange={() => toggleExcluded(u.id)}
                id={`u-${u.id}`}
              />
              <label htmlFor={`u-${u.id}`} className="flex-1 text-sm font-medium cursor-pointer">
                {u.name}
              </label>
              {u.email ? (
                <span className="text-xs text-neutral-400">{u.email}</span>
              ) : (
                <input
                  className="input py-1 text-xs w-56"
                  placeholder="E-Mail in awork fehlt – hier eintragen"
                  value={overrides[u.id] ?? ''}
                  onChange={e => setOverrides(prev => ({ ...prev, [u.id]: e.target.value }))}
                />
              )}
            </div>
          ))}
          {users.length === 0 && !loadError && (
            <p className="py-4 text-sm text-neutral-400">Lade Mitarbeitende…</p>
          )}
        </div>
      )}

      {isDigest && (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            {digestRecipients.map(email => (
              <span key={email} className="inline-flex items-center gap-2 rounded-full bg-brand-mint/40 px-3 py-1 text-sm">
                {email}
                <button
                  onClick={() => setDigestRecipients(prev => prev.filter(e => e !== email))}
                  className="text-neutral-500 hover:text-brand-coral"
                  aria-label="Entfernen"
                >×</button>
              </span>
            ))}
            {digestRecipients.length === 0 && (
              <span className="text-sm text-neutral-400">Noch keine Empfänger ausgewählt</span>
            )}
          </div>

          <div className="flex gap-2 mb-4">
            <input
              className="input flex-1"
              placeholder="E-Mail-Adresse hinzufügen (auch extern)"
              value={newRecipient}
              onChange={e => setNewRecipient(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRecipient(); } }}
            />
            <button onClick={addRecipient} className="btn-secondary shrink-0">Hinzufügen</button>
          </div>

          {users.some(u => u.email) && (
            <div>
              <div className="text-xs uppercase tracking-wide text-neutral-400 mb-2">Mitarbeitende schnell hinzufügen</div>
              <div className="flex flex-wrap gap-2">
                {users.filter(u => u.email).map(u => {
                  const active = digestRecipients.includes(u.email!);
                  return (
                    <button
                      key={u.id}
                      onClick={() => toggleDigest(u.email!)}
                      className={`rounded-full px-3 py-1 text-sm border transition ${
                        active
                          ? 'bg-brand-green/15 border-brand-green text-brand-ink'
                          : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                      }`}
                    >
                      {active ? '✓ ' : '+ '}{u.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {message && <p className="mt-4 text-sm text-brand-green">{message}</p>}
      {error && <p className="mt-4 text-sm text-brand-coral">{error}</p>}

      <button onClick={save} className="btn-primary mt-4" disabled={saving}>
        {saving ? 'Speichere…' : 'Empfänger speichern'}
      </button>
    </div>
  );
}
