import { describe, expect, it } from 'vitest';
import { ConflictError } from '../errors';
import { type ConstraintViolationError, translateSqliteError } from './sqlite-errors';

describe('translateSqliteError', () => {
  it.each([
    ['UNIQUE constraint failed: product_category.name', 'unique'],
    ['PRIMARY KEY constraint failed: inventory.id', 'unique'],
    ['FOREIGN KEY constraint failed', 'foreign_key'],
  ])('maps "%s" to a %s conflict without exposing the original message', (message, kind) => {
    const original = new Error(message);

    const translated = translateSqliteError(original);

    expect(translated).toBeInstanceOf(ConflictError);
    expect(translated).toMatchObject({ kind, cause: original });
    expect((translated as ConstraintViolationError).message).not.toContain(message);
  });

  it('passes other errors and non-errors through unchanged', () => {
    const other = new Error('no such table: product');

    expect(translateSqliteError(other)).toBe(other);
    expect(translateSqliteError('boom')).toBe('boom');
  });
});
