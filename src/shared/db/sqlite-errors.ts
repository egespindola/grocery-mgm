import { ConflictError } from '../errors';

export type ConstraintKind = 'unique' | 'foreign_key';

export class ConstraintViolationError extends ConflictError {
  readonly kind: ConstraintKind;

  constructor(kind: ConstraintKind, options?: ErrorOptions) {
    super(
      kind === 'unique'
        ? 'A resource with the same unique value already exists'
        : 'The resource is referenced by, or references, another resource',
      options,
    );
    this.kind = kind;
  }
}

// Matched on the message rather than on driver error codes so that better-sqlite3 and the Azion
// runtime, which only exposes the SQLite message text, are translated the same way.
const PATTERNS: ReadonlyArray<[RegExp, ConstraintKind]> = [
  [/UNIQUE constraint failed|PRIMARY KEY constraint failed/i, 'unique'],
  [/FOREIGN KEY constraint failed/i, 'foreign_key'],
];

export function translateSqliteError(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  for (const [pattern, kind] of PATTERNS) {
    if (pattern.test(error.message)) return new ConstraintViolationError(kind, { cause: error });
  }
  return error;
}
