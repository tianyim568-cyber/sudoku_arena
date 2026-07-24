import { createContext, useContext, useState, useEffect } from 'react';
import { api, setToken as setApiToken } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      setApiToken(token);
      api.getMe().then(res => {
        if (res.code === 200) setUser(res.data);
        else { localStorage.removeItem('token'); setApiToken(null); }
        setLoading(false);
      }).catch(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (username, password) => {
    const res = await api.login(username, password);
    if (res.code === 200) {
      setApiToken(res.data.token);
      setUser(res.data.user);
      return true;
    }
    throw new Error(res.message);
  };

  const logout = () => {
    localStorage.removeItem('token');
    setApiToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
