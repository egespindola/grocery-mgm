import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAzionSqlDatabase } from './azion-sql.adapter';
import { createBetterSqliteDatabase } from './better-sqlite.adapter';
import type { Database } from './database.port';
import { ConstraintViolationError } from './sqlite-errors';
import { createFakeAzionRuntime } from './testing/fake-azion-runtime';

const SCHEMA = [
  'CREATE TABLE parent (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE)',
  'CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id))',
];

const adapters: Array<[string, () => { db: Database; close: () => void }]> = [
  [
    'better-sqlite3',
    () => {
      const db = createBetterSqliteDatabase();
      return { db, close: () => db.close() };
    },
  ],
  [
    'azion runtime',
    () => {
      const runtime = createFakeAzionRuntime();
      return {
        db: createAzionSqlDatabase({ name: 'test', open: runtime.open }),
        close: () => runtime.raw.close(),
      };
    },
  ],
];

describe.each(adapters)('Database contract: %s', (_name, create) => {
  let db: Database;
  let close: () => void;

  beforeEach(async () => {
    ({ db, close } = create());
    for (const sql of SCHEMA) await db.execute(sql);
  });

  afterEach(() => close());

  const count = async (table: string) =>
    (await db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))[0]?.n;

  it('executes with bound parameters and reports changes and the inserted id', async () => {
    const first = await db.execute('INSERT INTO parent (name) VALUES (?)', ['a']);
    const second = await db.execute('INSERT INTO parent (name) VALUES (?)', ['b']);
    const updated = await db.execute('UPDATE parent SET name = name || ?', ['!']);

    expect(first).toEqual({ changes: 1, lastInsertId: 1 });
    expect(second.lastInsertId).toBe(2);
    expect(updated.changes).toBe(2);
  });

  it('queries rows as objects keyed by column name', async () => {
    await db.execute('INSERT INTO parent (name) VALUES (?), (?)', ['a', 'b']);

    const rows = await db.query('SELECT id, name FROM parent WHERE name = ?', ['b']);

    expect(rows).toEqual([{ id: 2, name: 'b' }]);
  });

  it('enforces foreign keys', async () => {
    await expect(db.execute('INSERT INTO child (parent_id) VALUES (?)', [99])).rejects.toSatisfy(
      (error) => error instanceof ConstraintViolationError && error.kind === 'foreign_key',
    );
  });

  it('translates unique violations', async () => {
    await db.execute('INSERT INTO parent (name) VALUES (?)', ['a']);

    await expect(db.execute('INSERT INTO parent (name) VALUES (?)', ['a'])).rejects.toSatisfy(
      (error) => error instanceof ConstraintViolationError && error.kind === 'unique',
    );
  });

  it('commits a batch and returns the rows of each statement', async () => {
    const results = await db.batch([
      { sql: 'INSERT INTO parent (name) VALUES (?) RETURNING id', params: ['a'] },
      { sql: 'INSERT INTO child (parent_id) VALUES (last_insert_rowid())' },
      { sql: 'SELECT COUNT(*) AS n FROM child' },
    ]);

    expect(results).toEqual([[{ id: 1 }], [], [{ n: 1 }]]);
    expect(await count('parent')).toBe(1);
  });

  it('rolls back every statement when one in the batch fails', async () => {
    await db.execute('INSERT INTO parent (name) VALUES (?)', ['existing']);

    await expect(
      db.batch([
        { sql: 'INSERT INTO parent (name) VALUES (?)', params: ['new'] },
        { sql: 'UPDATE parent SET name = ? WHERE name = ?', params: ['renamed', 'existing'] },
        { sql: 'INSERT INTO child (parent_id) VALUES (?)', params: [99] },
      ]),
    ).rejects.toBeInstanceOf(ConstraintViolationError);

    expect(await db.query('SELECT name FROM parent')).toEqual([{ name: 'existing' }]);
  });

  it('stays usable after a failed batch', async () => {
    await db
      .batch([{ sql: 'INSERT INTO child (parent_id) VALUES (?)', params: [99] }])
      .catch(() => undefined);

    await db.batch([{ sql: 'INSERT INTO parent (name) VALUES (?)', params: ['a'] }]);

    expect(await count('parent')).toBe(1);
  });
});
