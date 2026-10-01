import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ConstraintViolationError } from '../db/sqlite-errors';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { paginationQuery, toPage } from './pagination';
import { handleError, handleNotFound } from './problem';
import { validate } from './validation';

function buildTestApp() {
  const app = new Hono();
  app.onError(handleError);
  app.notFound(handleNotFound);

  app.get('/not-found', () => {
    throw new NotFoundError('Category 7 not found');
  });
  app.get('/conflict', () => {
    throw new ConflictError('Shopping list is completed');
  });
  app.get('/unique', () => {
    throw new ConstraintViolationError('unique');
  });
  app.get('/validation', () => {
    throw new ValidationError([{ field: 'category_id', message: 'Category does not exist' }]);
  });
  app.get('/http', () => {
    throw new HTTPException(400, { message: 'Bad header' });
  });
  app.get('/boom', () => {
    throw new Error('SQLITE_IOERR: disk I/O error at /var/data/grocery.db');
  });
  app.post(
    '/items',
    validate(
      'json',
      z.object({
        name: z.string().trim().min(1),
        items: z.array(z.object({ quantity: z.number().positive() })),
      }),
    ),
    (c) => c.json(c.req.valid('json'), 201),
  );
  app.get('/page', validate('query', paginationQuery), (c) => {
    const pagination = c.req.valid('query');
    return c.json(toPage(['x'], pagination, 57));
  });

  return app;
}

async function problemOf(res: Response) {
  expect(res.headers.get('content-type')).toBe('application/problem+json');
  return res.json();
}

describe('problem+json error handling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const app = buildTestApp();

  it('maps NotFoundError to 404', async () => {
    const res = await app.request('/not-found');

    expect(res.status).toBe(404);
    expect(await problemOf(res)).toEqual({
      type: 'https://grocery-mgm/errors/not-found',
      title: 'Resource not found',
      status: 404,
      detail: 'Category 7 not found',
      instance: '/not-found',
    });
  });

  it('maps unknown routes to a 404 problem', async () => {
    const res = await app.request('/nope', { method: 'DELETE' });

    expect(res.status).toBe(404);
    expect(await problemOf(res)).toMatchObject({
      status: 404,
      detail: 'No route matches DELETE /nope',
    });
  });

  it.each(['/conflict', '/unique'])('maps conflicts from %s to 409', async (path) => {
    const res = await app.request(path);

    expect(res.status).toBe(409);
    expect(await problemOf(res)).toMatchObject({
      type: 'https://grocery-mgm/errors/conflict',
      title: 'Conflict',
      status: 409,
      instance: path,
    });
  });

  it('maps ValidationError to 422 with field errors', async () => {
    const res = await app.request('/validation');

    expect(res.status).toBe(422);
    expect(await problemOf(res)).toEqual({
      type: 'https://grocery-mgm/errors/validation',
      title: 'Validation failed',
      status: 422,
      detail: 'Request is invalid',
      instance: '/validation',
      errors: [{ field: 'category_id', message: 'Category does not exist' }],
    });
  });

  it('keeps the status of client HTTP exceptions', async () => {
    const res = await app.request('/http');

    expect(res.status).toBe(400);
    expect(await problemOf(res)).toMatchObject({ title: 'Bad request', detail: 'Bad header' });
  });

  it('hides internals of unexpected errors behind a 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await app.request('/boom');
    const body = await problemOf(res);

    expect(res.status).toBe(500);
    expect(body).toEqual({
      type: 'https://grocery-mgm/errors/internal',
      title: 'Internal server error',
      status: 500,
      detail: 'An unexpected error occurred',
      instance: '/boom',
    });
    expect(JSON.stringify(body)).not.toMatch(/SQLITE|grocery\.db/);
  });

  it('answers malformed JSON with 400', async () => {
    const res = await app.request('/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"name": ',
    });

    expect(res.status).toBe(400);
    expect(await problemOf(res)).toMatchObject({
      type: 'https://grocery-mgm/errors/bad-request',
      status: 400,
      instance: '/items',
    });
  });

  it('answers schema failures with 422 naming each offending field', async () => {
    const res = await app.request('/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '  ', items: [{ quantity: 1 }, { quantity: 0 }] }),
    });

    expect(res.status).toBe(422);
    const body = await problemOf(res);
    expect(body).toMatchObject({ status: 422, detail: 'Request body is invalid' });
    expect(body.errors.map((e: { field: string }) => e.field)).toEqual([
      'name',
      'items[1].quantity',
    ]);
  });

  it('passes valid bodies through', async () => {
    const res = await app.request('/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: ' Milk ', items: [] }),
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ name: 'Milk', items: [] });
  });
});

describe('pagination', () => {
  const app = buildTestApp();

  it('defaults to limit 20 and offset 0', async () => {
    const res = await app.request('/page');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: ['x'], meta: { limit: 20, offset: 0, total: 57 } });
  });

  it('accepts explicit limit and offset up to the maximum', async () => {
    const res = await app.request('/page?limit=100&offset=40');

    expect(await res.json()).toMatchObject({ meta: { limit: 100, offset: 40 } });
  });

  it.each([
    ['limit=101', 'limit'],
    ['limit=0', 'limit'],
    ['limit=abc', 'limit'],
    ['offset=-1', 'offset'],
  ])('rejects %s with 422', async (query, field) => {
    const res = await app.request(`/page?${query}`);

    expect(res.status).toBe(422);
    expect(await problemOf(res)).toMatchObject({
      detail: 'Query parameters are invalid',
      errors: [{ field }],
    });
  });
});
