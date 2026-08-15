import { createContext, useContext, useState, useEffect } from 'react';
import { api, setToken as setApiToken } from '../api';

// useAuth — the hook that answers "who is logged in?" across the app.
//
// A hook is a reusable function any component calls to access shared
// capabilities — like a power socket you plug into. The component just
// calls `useAuth()` and receives `{ user, login, logout, ... }` instead of
// receiving these values through every parent ("prop drilling").
//
// <AuthProvider> (below) holds the state; useAuth() reads it.
//
// Two kinds of login, each with its own JWT:
//   • ORG — the regular login (admins, judges, players). Like a house key:
//     yours, opens every door.
//   • COMPETITION — a participant enters via /competition/:identifier to
//     join ONE competition. Like a hotel room key: works only for that room,
//     only for this stay. The token carries `competitionId` to mark this.
//
// We tell them apart by looking for `competitionId` in the token's claims.
// `authType` ("ORG" vs "COMPETITION") lets pages branch without re-decoding.

const AuthContext = createContext(null);

// Roles recognized as administrators on the client.
// `ORG_ADMIN` is the tenant administrator; `SUPER_ADMIN` is the platform owner
// with cross-organization rights. The legacy `ADMIN` role was removed when
// multi-tenancy landed — a token carrying it is rejected by the server.
// Single source of truth — pages read `isAdmin` from the context instead of
// comparing role strings themselves.
// Mirrors ADMIN_ROLES in server/src/middleware/auth.js — keep both in sync.
export const ADMIN_ROLES = ['ORG_ADMIN', 'SUPER_ADMIN'];

// The server returns the user with `id`; the game UI reads `user.userId`
// everywhere. Normalize so `userId` is always available.
function normalizeUser(u) {
  if (!u) return u;
  return { ...u, userId: u.userId != null ? u.userId : u.id };
}

// Read the claims of a JWT WITHOUT verifying its signature.
// This is safe here because the result is only used to decide what the UI
// shows and where to redirect. Every real authorization decision is made by
// the server, which does verify the signature. Never trust these claims for
// anything that grants access.
export function decodeJwtPayload(token) {
  try {
    const part = String(token).split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    // atob yields a binary string; re-decode as UTF-8 so non-ASCII display
    // names (the seeded accounts use Chinese) survive.
    const utf8 = decodeURIComponent(
      atob(padded)
        .split('')
        .map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('')
    );
    return JSON.parse(utf8);
  } catch {
    return null;
  }
}

// Claim shapes, matching server/src/middleware/auth.js on Sylvain's branch:
//   org-scoped:         { userId, username, role, organizationId }
//   competition-scoped: { type: 'competition', competitionId, userId, role,
//                         participantId, organizationId }
// The explicit `type` marker is the intended discriminator; `competitionId`
// is kept as a fallback so a token missing the marker is still recognised.
function isCompetitionToken(claims) {
  if (claims == null) return false;
  return claims.type === 'competition' || claims.competitionId != null;
}

// Expired tokens must not restore a session. The org flow finds out via the
// failing /auth/me call, but a competition session is rebuilt from the claims
// alone, so the check has to happen here too.
function isExpired(claims) {
  return typeof claims?.exp === 'number' && claims.exp * 1000 <= Date.now();
}

// Build the user object a competition session exposes to the UI.
// `userId` is always present in the competition payload and identifies judges
// as well as players; `participantId` is null for judges. `username` is not
// carried by competition tokens, so the UI falls back to the role label.
function userFromCompetitionClaims(claims) {
  return normalizeUser({
    userId: claims.userId ?? claims.participantId ?? null,
    participantId: claims.participantId ?? null,
    username: claims.username ?? null,
    displayName: claims.displayName ?? claims.username ?? null,
    role: claims.role,
    competitionId: claims.competitionId,
    organizationId: claims.organizationId ?? claims.orgId ?? null,
  });
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      return;
    }

    const claims = decodeJwtPayload(token);
    if (isExpired(claims)) {
      localStorage.removeItem('token');
      setApiToken(null);
      setLoading(false);
      return;
    }

    setApiToken(token);

    // A competition session is rebuilt from the token itself: /auth/me belongs
    // to the org world and would not describe a judge or player correctly.
    if (isCompetitionToken(claims)) {
      setUser(userFromCompetitionClaims(claims));
      setLoading(false);
      return;
    }

    api.getMe().then(res => {
      if (res.code === 200) setUser(normalizeUser(res.data));
      else { localStorage.removeItem('token'); setApiToken(null); }
      setLoading(false);
    }).catch(() => setLoading(false));
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

  // Org registration: creates the organization and signs the admin straight in.
  const registerAndLogin = async (organizationName, adminUsername, password) => {
    const res = await api.register(organizationName, adminUsername, password);
    if (res.code === 200 && res.data?.token) {
      setApiToken(res.data.token);
      setUser(normalizeUser(res.data.user));
      return true;
    }
    throw new Error(res.message);
  };

  // Competition entry (judges and players). Goes through the context so the
  // session is registered — calling setToken() directly would store the token
  // while leaving `user` null, and PrivateRoute would bounce back to /login.
  const competitionLogin = async (identifier, username, password) => {
    const res = await api.competitionLogin(identifier, username, password);
    if (res.code !== 200 || !res.data?.token) {
      const err = new Error(res.message || 'Competition login failed');
      err.code = res.code;
      throw err;
    }
    setApiToken(res.data.token);
    const claims = decodeJwtPayload(res.data.token) || {};
    // The server answers { token, competition, user }; older shapes sent only a
    // token. Prefer what it sends, and fall back to the token's own claims.
    const competitionId =
      res.data.competition?.id ?? res.data.competitionId ?? claims.competitionId;
    const session = res.data.user
      ? normalizeUser({ ...res.data.user, competitionId })
      : userFromCompetitionClaims({ ...claims, competitionId });
    setUser(session);
    return session;
  };

  const logout = () => {
    localStorage.removeItem('token');
    setApiToken(null);
    setUser(null);
  };

  // Which world this session belongs to — lets pages branch without re-decoding.
  const authType = user?.competitionId != null ? 'COMPETITION' : user ? 'ORG' : null;

  // Pages ask "is this an administrator?" instead of comparing role strings,
  // so a future role rename only has to change ADMIN_ROLES above.
  const isAdmin = ADMIN_ROLES.includes(user?.role);

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      login,
      registerAndLogin,
      competitionLogin,
      logout,
      authType,
      isAdmin,
      competitionId: user?.competitionId ?? null,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
