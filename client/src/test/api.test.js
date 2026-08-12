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
    const res = await api.getCompetitionInfo('demo-cup');
    expect(res.code).toBe(404);
    expect(res.data).toBeNull();
  });

  it('returns an envelope when the server sends HTML instead of JSON', async () => {
    mockFetchOnce({ status: 500, body: '<!doctype html><title>Error</title>' });
    const res = await api.getCompetitionInfo('demo-cup');
    expect(res.code).toBe(500);
    expect(res.data).toBeNull();
  });

  it('still parses a normal JSON response', async () => {
    mockFetchOnce({ status: 200, body: '{"code":200,"data":{"name":"Demo Cup"}}' });
    const res = await api.getCompetitionInfo('demo-cup');
    expect(res.code).toBe(200);
    expect(res.data.name).toBe('Demo Cup');
  });
});
