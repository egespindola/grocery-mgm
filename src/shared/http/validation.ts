import { zValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import type { core, ZodType } from 'zod';
import { type FieldError, ValidationError } from '../errors';

const DETAILS: Partial<Record<keyof ValidationTargets, string>> = {
  json: 'Request body is invalid',
  query: 'Query parameters are invalid',
  param: 'Path parameters are invalid',
};

export function formatIssuePath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((field, key) => {
    if (typeof key === 'number') return `${field}[${key}]`;
    const name = String(key);
    return field === '' ? name : `${field}.${name}`;
  }, '');
}

export function toFieldErrors(error: core.$ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    field: formatIssuePath(issue.path),
    message: issue.message,
  }));
}

/** `zValidator` that reports failures as a 422 problem instead of the default 400 body. */
export const validate = <Target extends keyof ValidationTargets, Schema extends ZodType>(
  target: Target,
  schema: Schema,
) =>
  zValidator(target, schema, (result) => {
    if (!result.success) {
      throw new ValidationError(toFieldErrors(result.error), DETAILS[target]);
    }
  });
