import { describe, expect, it } from 'vitest';
import { buildApp } from './app';

describe('buildApp', () => {
  it('responds to GET /health', async () => {
    const res = await buildApp().request('/api/v1/health');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('returns 404 for unknown routes', async () => {
    const res = await buildApp().request('/api/v1/nope');

    expect(res.status).toBe(404);
  });
});
