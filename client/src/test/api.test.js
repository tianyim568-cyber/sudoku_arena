import { describe, it, expect, vi, afterEach } from 'vitest';
import { api } from '../api';

function mockFetchOnce({ status, body }) {
  global.fetch = vi.fn().mockResolvedValue({
    status,
    text: () => Promise.resolve(body),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('api request envelope', () => {
  it('returns a 404 envelope when the server sends an empty body', async () => {
    mockFetchOnce({ status: 404, body: '' });
    const res = await api.getCompetitionByCode('demo-cup');
    expect(res.code).toBe(404);
    expect(res.data).toBeNull();
  });

  it('returns an envelope when the server sends HTML instead of JSON', async () => {
    mockFetchOnce({ status: 500, body: '<!doctype html><title>Error</title>' });
    const res = await api.getCompetitionByCode('demo-cup');
    expect(res.code).toBe(500);
    expect(res.data).toBeNull();
  });

  it('still parses a normal JSON response', async () => {
    mockFetchOnce({ status: 200, body: '{"code":200,"data":{"name":"Demo Cup"}}' });
    const res = await api.getCompetitionByCode('demo-cup');
    expect(res.code).toBe(200);
    expect(res.data.name).toBe('Demo Cup');
  });

  // A rejected fetch (server down) used to escape as an unhandled rejection,
  // so callers that only inspect res.code rendered nothing at all.
  it('returns an envelope instead of throwing when fetch itself fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const res = await api.createCompetition({ name: 'Autumn Cup' });
    expect(res.code).toBe(0);
    expect(res.message).toMatch(/Failed to fetch/);
    expect(res.data).toBeNull();
  });
});

// Regression guard on the tournament→competition rename. The api object must
// expose only the *Competition names. No compatibility alias: silent aliases
// are what let the client and the server drift apart in the first place.
//
// The legacy names are written as string keys rather than property accesses so
// that a future project-wide search-and-replace on "tournament" cannot quietly
// rewrite this test into one that checks nothing.
const LEGACY_NAMES = [
  'listTour' + 'naments',
  'createTour' + 'nament',
  'getTour' + 'nament',
  'updateTour' + 'nament',
  'deleteTour' + 'nament',
];

describe('api object — the legacy names are gone', () => {
  it.each(LEGACY_NAMES)('does not expose %s', (name) => {
    expect(api[name]).toBeUndefined();
  });

  it('exposes the competition names instead', () => {
    expect(typeof api.listCompetitions).toBe('function');
    expect(typeof api.createCompetition).toBe('function');
    expect(typeof api.getCompetition).toBe('function');
    expect(typeof api.updateCompetition).toBe('function');
    expect(typeof api.deleteCompetition).toBe('function');
  });
});
