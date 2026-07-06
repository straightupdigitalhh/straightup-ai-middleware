import { createContext, useContext, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api, User } from './lib/api';
import Layout from './components/Layout';
import LoginPage from './pages/Login';
import DashboardPage from './pages/Dashboard';
import AutomationsPage from './pages/Automations';
import AutomationDetailPage from './pages/AutomationDetail';
import UsersPage from './pages/Users';
import BugBeePage from './pages/BugBee';

interface AuthState {
  user: User | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({ user: null, refresh: async () => {}, logout: async () => {} });
export const useAuth = () => useContext(AuthContext);

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const { user } = await api.me();
      setUser(user);
    } catch {
      setUser(null);
    }
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  const logout = async () => {
    await api.logout().catch(() => {});
    setUser(null);
  };

  if (loading) {
    return <div className="min-h-screen grid place-items-center text-neutral-400">Lade…</div>;
  }

  return (
    <AuthContext.Provider value={{ user, refresh, logout }}>
      {user ? (
        <Layout>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/automationen" element={<AutomationsPage />} />
            <Route path="/automationen/:id" element={<AutomationDetailPage />} />
            <Route path="/bugbee" element={<BugBeePage />} />
            <Route path="/nutzer" element={<UsersPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      ) : (
        <LoginPage />
      )}
    </AuthContext.Provider>
  );
}
