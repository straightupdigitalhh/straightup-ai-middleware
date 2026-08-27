import { FormEvent, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../App';

export default function LoginPage() {
  const { refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.login(email, password);
      await refresh();
      const next = new URLSearchParams(window.location.search).get('next');
      // Rücksprung nur auf die eigene Origin — geprüft mit demselben WHATWG-Parser,
      // der auch navigiert (new URL). String-Prüfungen sind hier grundsätzlich
      // unsicher: der Parser strippt z. B. Tab/LF/CR überall im String, sodass
      // "/\t/evil.tld" zu "//evil.tld" würde. Navigiert wird deshalb auf das
      // GEPARSTE href, nie auf den Rohstring.
      if (next) {
        let ziel: URL | null = null;
        try { ziel = new URL(next, window.location.origin); } catch { /* kaputter Wert ⇒ kein Sprung */ }
        if (ziel && ziel.origin === window.location.origin) {
          window.location.assign(ziel.href);
          return;
        }
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verbindung fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center bg-neutral-50 p-4">
      <div className="card w-full max-w-sm">
        <img src="/app/logo.png" alt="straightup" className="h-9 mb-1" />
        <h1 className="font-heading font-semibold text-lg mb-6 text-neutral-500">Hub</h1>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="email">E-Mail</label>
            <input
              id="email" type="email" className="input" autoComplete="username"
              value={email} onChange={e => setEmail(e.target.value)} required
            />
          </div>
          <div>
            <label className="label" htmlFor="password">Passwort</label>
            <input
              id="password" type="password" className="input" autoComplete="current-password"
              value={password} onChange={e => setPassword(e.target.value)} required
            />
          </div>
          {error && <p className="text-sm text-brand-coral">{error}</p>}
          <button type="submit" className="btn-primary w-full justify-center" disabled={busy}>
            {busy ? 'Anmelden…' : 'Anmelden'}
          </button>
        </form>
      </div>
    </div>
  );
}
