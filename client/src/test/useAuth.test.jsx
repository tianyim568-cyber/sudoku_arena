import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth, decodeJwtPayload, ADMIN_ROLES } from '../hooks/useAuth';
import { api } from '../api';

// Mock the API module so no real network call happens.
// vi.mock is hoisted above the imports, so `api` above is already the mock.
vi.mock('../api', () => ({
  api: { getMe: vi.fn(), competitionLogin: vi.fn() },
  setToken: vi.fn(),
}));

// Build an unsigned JWT-shaped token: header.payload.signature (base64url).
function makeToken(claims) {
  const b64 = (o) =>
    btoa(unescape(encodeURIComponent(JSON.stringify(o))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.sig`;
}

const inOneHour = () => Math.floor(Date.now() / 1000) + 3600;
const anHourAgo = () => Math.floor(Date.now() / 1000) - 3600;

// Renders the auth state as text so assertions can read it.
function Probe() {
  const { user, loading, authType, competitionId } = useAuth();
  if (loading) return <div>loading</div>;
  return (
    <div>
      <span data-testid="role">{user?.role ?? 'none'}</span>
      <span data-testid="type">{authType ?? 'none'}</span>
      <span data-testid="comp">{String(competitionId)}</span>
      <span data-testid="uid">{String(user?.userId)}</span>
    </div>
  );
}

const renderAuth = () => render(<AuthProvider><Probe /></AuthProvider>);

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => {
  localStorage.clear();
});

describe('decodeJwtPayload', () => {
  it('reads the claims of a well-formed token', () => {
    const claims = decodeJwtPayload(makeToken({ userId: 1, role: 'ORG_ADMIN' }));
    expect(claims.userId).toBe(1);
    expect(claims.role).toBe('ORG_ADMIN');
  });

  it('preserves non-ASCII values (seeded accounts use Chinese names)', () => {
    const claims = decodeJwtPayload(makeToken({ displayName: '管理员' }));
    expect(claims.displayName).toBe('管理员');
  });

  it('returns null instead of throwing on garbage input', () => {
    expect(decodeJwtPayload('not-a-token')).toBeNull();
    expect(decodeJwtPayload('')).toBeNull();
    expect(decodeJwtPayload(undefined)).toBeNull();
  });
});

describe('AuthProvider session restore', () => {
  // Payload shape matches server/src/middleware/auth.js on Sylvain's branch:
  // { type: 'competition', competitionId, userId, role, participantId, organizationId }
  it('rebuilds a competition session from the token, without calling /auth/me', async () => {
    localStorage.setItem('token', makeToken({
      type: 'competition', competitionId: 12, userId: 41, role: 'PLAYER',
      participantId: 77, organizationId: 3, exp: inOneHour(),
    }));
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('role')).toHaveTextContent('PLAYER'));
    expect(screen.getByTestId('type')).toHaveTextContent('COMPETITION');
    expect(screen.getByTestId('comp')).toHaveTextContent('12');
    expect(screen.getByTestId('uid')).toHaveTextContent('41');
    expect(api.getMe).not.toHaveBeenCalled();
  });

  it('identifies a judge, whose participantId is null', async () => {
    localStorage.setItem('token', makeToken({
      type: 'competition', competitionId: 5, userId: 9, role: 'JUDGE',
      participantId: null, organizationId: 3, exp: inOneHour(),
    }));
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('role')).toHaveTextContent('JUDGE'));
    expect(screen.getByTestId('uid')).toHaveTextContent('9');
  });

  it('recognises a competition token by its `type` marker alone', async () => {
    localStorage.setItem('token', makeToken({
      type: 'competition', competitionId: 8, userId: 2, role: 'JUDGE', exp: inOneHour(),
    }));
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('type')).toHaveTextContent('COMPETITION'));
  });

  it('still calls /auth/me for an org token', async () => {
    api.getMe.mockResolvedValue({ code: 200, data: { id: 1, role: 'ORG_ADMIN' } });
    localStorage.setItem('token', makeToken({ userId: 1, role: 'ORG_ADMIN', exp: inOneHour() }));
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('role')).toHaveTextContent('ORG_ADMIN'));
    expect(screen.getByTestId('type')).toHaveTextContent('ORG');
    expect(api.getMe).toHaveBeenCalledTimes(1);
  });

  it('drops an expired competition token instead of restoring the session', async () => {
    localStorage.setItem('token', makeToken({
      type: 'competition', competitionId: 12, userId: 41, role: 'PLAYER', exp: anHourAgo(),
    }));
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('role')).toHaveTextContent('none'));
    expect(localStorage.getItem('token')).toBeNull();
    expect(api.getMe).not.toHaveBeenCalled();
  });

  it('starts logged out when there is no token', async () => {
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('role')).toHaveTextContent('none'));
    expect(screen.getByTestId('type')).toHaveTextContent('none');
  });
});

// Regression guard: the legacy `ADMIN` role was removed when multi-tenancy
// landed. `ADMIN_ROLES` is the single source of truth for "is this an admin
// account?" on the client, and it must accept the post-migration roles
// (ORG_ADMIN tenant admin + SUPER_ADMIN platform owner) while rejecting the
// ghost `ADMIN` role. If a future edit re-adds 'ADMIN' here, the private
// dashboard would open up to accounts the server now refuses.
describe('ADMIN_ROLES (client-side role list)', () => {
  it('does not contain the removed ADMIN role', () => {
    expect(ADMIN_ROLES).not.toContain('ADMIN');
  });

  it('accepts ORG_ADMIN (tenant administrator)', () => {
    expect(ADMIN_ROLES).toContain('ORG_ADMIN');
  });

  it('accepts SUPER_ADMIN (platform owner)', () => {
    expect(ADMIN_ROLES).toContain('SUPER_ADMIN');
  });
});
