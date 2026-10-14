import { Hono } from 'hono';
import { handleError, handleNotFound } from './shared/http/problem';

export const API_BASE_PATH = '/api/v1';

// Composition root: adapters are wired to ports here as modules are added.
export type AppDeps = Record<string, never>;

export function buildApp(_deps: AppDeps = {}): Hono {
  const app = new Hono().basePath(API_BASE_PATH);

  app.onError(handleError);
  app.notFound(handleNotFound);

  app.get('/health', (c) => c.json({ status: 'ok' }));

  return app;
}
