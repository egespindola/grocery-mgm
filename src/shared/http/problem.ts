import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ConflictError, type FieldError, NotFoundError, ValidationError } from '../errors';

const PROBLEM_TYPE_BASE = 'https://grocery-mgm/errors';

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: readonly FieldError[];
}

interface ProblemDefinition {
  slug: string;
  title: string;
}

const DEFINITIONS: Record<number, ProblemDefinition> = {
  400: { slug: 'bad-request', title: 'Bad request' },
  404: { slug: 'not-found', title: 'Resource not found' },
  409: { slug: 'conflict', title: 'Conflict' },
  422: { slug: 'validation', title: 'Validation failed' },
  500: { slug: 'internal', title: 'Internal server error' },
};

export function problemResponse(
  c: Context,
  status: number,
  fields: { detail?: string; errors?: readonly FieldError[] } = {},
): Response {
  const definition = DEFINITIONS[status] ?? { slug: 'error', title: 'Error' };
  const body: Problem = {
    type: `${PROBLEM_TYPE_BASE}/${definition.slug}`,
    title: definition.title,
    status,
    ...(fields.detail !== undefined && { detail: fields.detail }),
    instance: c.req.path,
    ...(fields.errors !== undefined && { errors: fields.errors }),
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  });
}

export const handleError: ErrorHandler = (error, c) => {
  if (error instanceof ValidationError) {
    return problemResponse(c, 422, { detail: error.message, errors: error.errors });
  }
  if (error instanceof NotFoundError) return problemResponse(c, 404, { detail: error.message });
  if (error instanceof ConflictError) return problemResponse(c, 409, { detail: error.message });
  if (error instanceof HTTPException && error.status < 500) {
    return problemResponse(c, error.status, { detail: error.message });
  }

  console.error(error);
  return problemResponse(c, 500, { detail: 'An unexpected error occurred' });
};

export const handleNotFound: NotFoundHandler = (c) =>
  problemResponse(c, 404, { detail: `No route matches ${c.req.method} ${c.req.path}` });
