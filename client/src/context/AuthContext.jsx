import { createContext, useContext, useEffect, useState } from 'react';
import api from '../api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem('opsdesk_user') || localStorage.getItem('caseflow_user');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const [company, setCompany] = useState({ name: 'Enterprise' });
  const [loading, setLoading] = useState(
    Boolean(localStorage.getItem('opsdesk_token') || localStorage.getItem('caseflow_token'))
  );

  useEffect(() => {
    const token = localStorage.getItem('opsdesk_token') || localStorage.getItem('caseflow_token');
    if (!token) {
      setLoading(false);
      return;
    }

    api.get('/auth/me')
      .then(({ data }) => {
        setUser(data.user);
        setCompany(data.company || { name: 'Enterprise' });
        localStorage.setItem('opsdesk_user', JSON.stringify(data.user));
      })
      .catch(() => {
        localStorage.removeItem('opsdesk_token');
        localStorage.removeItem('opsdesk_user');
        localStorage.removeItem('caseflow_token');
        localStorage.removeItem('caseflow_user');
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const acceptSession = (data) => {
    localStorage.setItem('opsdesk_token', data.token);
    localStorage.setItem('opsdesk_user', JSON.stringify(data.user));
    // Backwards compatibility
    localStorage.setItem('caseflow_token', data.token);
    localStorage.setItem('caseflow_user', JSON.stringify(data.user));

    setUser(data.user);
    setCompany(data.company || { name: 'Enterprise' });
  };

  const updateUser = (u) => {
    setUser(u);
    localStorage.setItem('opsdesk_user', JSON.stringify(u));
  };

  const logout = () => {
    [
      'opsdesk_token',
      'opsdesk_user',
      'caseflow_token',
      'caseflow_user',
      'caseflow_company'
    ].forEach((k) => localStorage.removeItem(k));
    setUser(null);
    setCompany({ name: 'Enterprise' });
  };

  return (
    <AuthContext.Provider value={{ user, company, loading, acceptSession, updateUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
