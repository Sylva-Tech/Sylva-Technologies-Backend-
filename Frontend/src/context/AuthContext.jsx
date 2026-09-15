import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import api from '../services/api';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('sylva-token');
    if (!token) {
      setLoading(false);
      return;
    }

    api
      .get('/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((response) => {
        setUser(response.data);
      })
      .catch(() => {
        localStorage.removeItem('sylva-token');
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const response = await api.post('/auth/login', { email, password });
    const userData = response.data;

    localStorage.setItem('sylva-token', userData.token);
    setUser({
      _id: userData._id,
      name: userData.name,
      email: userData.email,
      role: userData.role,
    });

    return userData;
  };

  const register = async (payload) => {
    const response = await api.post('/auth/register', payload);
    const userData = response.data;

    localStorage.setItem('sylva-token', userData.token);
    setUser({
      _id: userData._id,
      name: userData.name,
      email: userData.email,
      role: userData.role,
    });

    return userData;
  };

  const logout = () => {
    localStorage.removeItem('sylva-token');
    setUser(null);
  };

  const value = useMemo(
    () => ({ user, loading, login, register, logout }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
}
