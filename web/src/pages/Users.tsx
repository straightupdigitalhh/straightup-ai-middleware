import { FormEvent, useEffect, useState } from 'react';
import { api, User, TeamboardNutzer, formatDateTime } from '../lib/api';
import { StatusBadge } from '../components/StatusBadge';
import { useAuth } from '../App';

export default function UsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [aworkNutzer, setAworkNutzer] = useState<TeamboardNutzer[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [password, setPassword] = useState('');

  const load = () => api.users().then(setUsers).catch(e => setError(e.message));
  useEffect(() => { load(); }, []);
  useEffect(() => { api.teamboardNutzer().then(setAworkNutzer).catch(e => setError(e.message)); }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError(''); setMessage('');
    try {
      await api.createUser({ email, name, role, password });
      setMessage(`Nutzer ${email} angelegt`);
      setEmail(''); setName(''); setPassword(''); setRole('member');
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const setDisabled = async (u: User, disabled: boolean) => {
    setError(''); setMessage('');
    try {
      await api.patchUser(u.id, { disabled });
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const setAworkMapping = async (u: User, aworkUserId: string | null) => {
    setError(''); setMessage('');
    try {
      await api.patchUser(u.id, { aworkUserId });
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div>
      <h1 className="font-heading text-2xl font-semibold mb-6">Nutzer</h1>
      {message && <p className="mb-3 text-sm text-brand-green">{message}</p>}
      {error && <p className="mb-3 text-sm text-brand-coral">{error}</p>}

      <div className="card p-0 overflow-hidden mb-8">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-neutral-400 border-b border-neutral-100">
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">E-Mail</th>
              <th className="px-4 py-2">Rolle</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">awork-Verknüpfung</th>
              <th className="px-4 py-2">Seit</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="border-b border-neutral-50">
                <td className="px-4 py-2 font-medium">{u.name}{u.id === me?.id && <span className="text-neutral-400"> (du)</span>}</td>
                <td className="px-4 py-2 text-neutral-600">{u.email}</td>
                <td className="px-4 py-2">{u.role === 'admin' ? 'Admin' : 'Mitglied'}</td>
                <td className="px-4 py-2">
                  {u.disabledAt
                    ? <StatusBadge kind="muted">deaktiviert</StatusBadge>
                    : <StatusBadge kind="ok">aktiv</StatusBadge>}
                </td>
                <td className="px-4 py-2">
                  <select
                    className="input py-1 text-xs"
                    value={u.aworkUserId ?? ''}
                    onChange={e => setAworkMapping(u, e.target.value || null)}
                  >
                    <option value="">— nicht verknüpft —</option>
                    {aworkNutzer.map(n => (
                      <option key={n.id} value={n.id}>{n.name}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-2 text-neutral-400">{formatDateTime(u.createdAt)}</td>
                <td className="px-4 py-2 text-right">
                  {u.id !== me?.id && (
                    u.disabledAt
                      ? <button className="text-xs text-brand-green hover:underline" onClick={() => setDisabled(u, false)}>aktivieren</button>
                      : <button className="text-xs text-brand-coral hover:underline" onClick={() => setDisabled(u, true)}>deaktivieren</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card max-w-lg">
        <h2 className="font-heading font-semibold mb-3">Nutzer anlegen</h2>
        <form onSubmit={create} className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="label" htmlFor="new-name">Name</label>
              <input id="new-name" className="input" value={name} onChange={e => setName(e.target.value)} required />
            </div>
            <div>
              <label className="label" htmlFor="new-email">E-Mail</label>
              <input id="new-email" type="email" className="input" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div>
              <label className="label" htmlFor="new-role">Rolle</label>
              <select id="new-role" className="input" value={role} onChange={e => setRole(e.target.value as 'admin' | 'member')}>
                <option value="member">Mitglied</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="new-password">Start-Passwort (min. 10 Zeichen)</label>
              <input id="new-password" type="text" className="input" value={password} minLength={10}
                onChange={e => setPassword(e.target.value)} required />
            </div>
          </div>
          <button type="submit" className="btn-primary">Anlegen</button>
        </form>
      </div>
    </div>
  );
}
