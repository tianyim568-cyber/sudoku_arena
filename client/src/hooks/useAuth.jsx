import { createContext, useContext, useState, useEffect } from 'react';
import { api, setToken as setApiToken } from '../api';

const AuthContext = createContext(null);

// The server returns the user with `id`; the game UI reads `user.userId`
// everywhere. Normalize so `userId` is always available.
function normalizeUser(u) {
  if (!u) return u;
  return { ...u, userId: u.userId != null ? u.userId : u.id };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      setApiToken(token);
      api.getMe().then(res => {
        if (res.code === 200) setUser(normalizeUser(res.data));
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
      setUser(normalizeUser(res.data.user));
      return true;
    }
    throw new Error(res.message);
  };

  const registerAndLogin = async (organizationName, adminUsername, password) => {
    const res = await api.register(organizationName, adminUsername, password);
    if (res.code === 200 && res.data?.token) {
      setApiToken(res.data.token);
      setUser(normalizeUser(res.data.user));
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
    <AuthContext.Provider value={{ user, loading, login, registerAndLogin, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
