import { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../App';

const navItems = [
  { to: '/', label: 'Dashboard', exact: true },
  { to: '/automationen', label: 'Automationen' },
  { to: '/nutzer', label: 'Nutzer', adminOnly: true },
];

const externalTools = [
  { href: '/wissenssystem', label: 'Wissenssystem ↗' },
  { href: '/feedback-admin', label: 'BugBee ↗' },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen flex">
      <aside className="w-60 shrink-0 border-r border-neutral-200 bg-white flex flex-col">
        <div className="p-6 border-b border-neutral-100">
          <img src="/app/logo.png" alt="straightup" className="h-8" />
          <div className="mt-2 font-heading font-semibold text-sm tracking-wide text-neutral-500">HUB</div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems
            .filter(item => !item.adminOnly || user?.role === 'admin')
            .map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.exact}
                className={({ isActive }) =>
                  `block rounded-lg px-3 py-2 text-sm font-medium transition ${
                    isActive ? 'bg-brand-mint/40 text-brand-ink' : 'text-neutral-600 hover:bg-neutral-100'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          <div className="pt-4 mt-4 border-t border-neutral-100">
            <div className="px-3 pb-1 text-xs uppercase tracking-wide text-neutral-400">Werkzeuge</div>
            {externalTools.map(tool => (
              <a
                key={tool.href}
                href={tool.href}
                className="block rounded-lg px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-100"
              >
                {tool.label}
              </a>
            ))}
          </div>
        </nav>
        <div className="p-4 border-t border-neutral-100 text-sm">
          <div className="font-medium truncate">{user?.name}</div>
          <div className="text-neutral-400 text-xs truncate">{user?.email}</div>
          <button onClick={logout} className="mt-2 text-xs text-brand-coral hover:underline">
            Abmelden
          </button>
        </div>
      </aside>
      <main className="flex-1 p-8 max-w-5xl">{children}</main>
    </div>
  );
}
