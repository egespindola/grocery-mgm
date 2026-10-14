import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAzionSqlDatabase } from './azion-sql.adapter';
import { createFakeAzionRuntime } from './testing/fake-azion-runtime';

describe('createAzionSqlDatabase', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens the named database once and enables foreign keys on it', async () => {
    const runtime = createFakeAzionRuntime();
    const open = vi.fn(runtime.open);
    const db = createAzionSqlDatabase({ name: 'grocery', open });

    await db.query('SELECT 1 AS one');
    await db.query('SELECT 2 AS two');

    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('grocery');
    expect(runtime.log[0]).toBe('PRAGMA foreign_keys = ON');
  });

  it('uses globalThis.Azion.Sql by default', async () => {
    const runtime = createFakeAzionRuntime();
    vi.stubGlobal('Azion', { Sql: { Database: { open: runtime.open } } });

    const rows = await createAzionSqlDatabase({ name: 'grocery' }).query('SELECT 1 AS one');

    expect(rows).toEqual([{ one: 1 }]);
  });

  it('fails clearly when the runtime API is missing, and retries on the next call', async () => {
    const db = createAzionSqlDatabase({ name: 'grocery' });

    await expect(db.query('SELECT 1')).rejects.toThrow(/runtime API is not available/);

    vi.stubGlobal('Azion', { Sql: { Database: { open: createFakeAzionRuntime().open } } });
    await expect(db.query('SELECT 1 AS one')).resolves.toEqual([{ one: 1 }]);
  });

  it('wraps a batch in BEGIN/COMMIT and does not interleave concurrent operations', async () => {
    const runtime = createFakeAzionRuntime();
    const db = createAzionSqlDatabase({ name: 'grocery', open: runtime.open });
    await db.execute('CREATE TABLE t (v TEXT)');
    runtime.log.length = 0;

    await Promise.all([
      db.batch([
        { sql: 'INSERT INTO t (v) VALUES (?)', params: ['a'] },
        { sql: 'INSERT INTO t (v) VALUES (?)', params: ['b'] },
      ]),
      db.query('SELECT COUNT(*) AS n FROM t'),
    ]);

    expect(runtime.log).toEqual([
      'BEGIN',
      'INSERT INTO t (v) VALUES (?)',
      'INSERT INTO t (v) VALUES (?)',
      'COMMIT',
      'SELECT COUNT(*) AS n FROM t',
    ]);
  });

  it('issues ROLLBACK when a batch statement fails', async () => {
    const runtime = createFakeAzionRuntime();
    const db = createAzionSqlDatabase({ name: 'grocery', open: runtime.open });
    runtime.log.length = 0;

    await expect(db.batch([{ sql: 'INSERT INTO missing (v) VALUES (1)' }])).rejects.toThrow(
      /no such table/,
    );

    expect(runtime.log.at(-1)).toBe('ROLLBACK');
  });
});
