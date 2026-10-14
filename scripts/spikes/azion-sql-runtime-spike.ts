// MYPRS-4 spike: an edge function that exercises the production adapter
// (src/shared/db/azion-sql.adapter.ts) against the real Edge SQL runtime API. Deploy it
// temporarily, call `GET /?db=<disposable test database>`, record the JSON report in
// docs/spikes/azion-sql-atomicity.md, then remove the deployment.
import { createAzionSqlDatabase } from '../../src/shared/db/azion-sql.adapter';
import type { Database } from '../../src/shared/db/database.port';
import { ConstraintViolationError } from '../../src/shared/db/sqlite-errors';

interface CheckResult {
  check: string;
  pass: boolean;
  detail?: unknown;
}

const count = async (db: Database, sql: string) =>
  Number((await db.query<{ n: number }>(sql))[0]?.n ?? Number.NaN);

const CHECKS: Array<[string, (db: Database) => Promise<{ pass: boolean; detail?: unknown }>]> = [
  [
    'execute binds params and reports changes / last insert id',
    async (db) => {
      const result = await db.execute('INSERT INTO spike_parent (name) VALUES (?)', ['p1']);
      const rows = await db.query('SELECT id, name FROM spike_parent WHERE name = ?', ['p1']);
      return {
        pass: result.changes === 1 && rows.length === 1 && rows[0]?.id === result.lastInsertId,
        detail: { result, rows },
      };
    },
  ],
  [
    'PRAGMA foreign_keys is enforced and FK failures map to ConstraintViolationError',
    async (db) => {
      try {
        await db.execute('INSERT INTO spike_child (parent_id) VALUES (?)', [999999]);
        return { pass: false, detail: 'insert with a missing parent succeeded' };
      } catch (error) {
        return {
          pass: error instanceof ConstraintViolationError && error.kind === 'foreign_key',
          detail: String((error as Error).cause ?? error),
        };
      }
    },
  ],
  [
    'UNIQUE failures map to ConstraintViolationError',
    async (db) => {
      try {
        await db.execute('INSERT INTO spike_parent (name) VALUES (?)', ['p1']);
        return { pass: false, detail: 'duplicate insert succeeded' };
      } catch (error) {
        return {
          pass: error instanceof ConstraintViolationError && error.kind === 'unique',
          detail: String((error as Error).cause ?? error),
        };
      }
    },
  ],
  [
    'batch commits all statements and returns RETURNING rows',
    async (db) => {
      const results = await db.batch([
        { sql: 'INSERT INTO spike_parent (name) VALUES (?) RETURNING id', params: ['p2'] },
        { sql: 'INSERT INTO spike_child (parent_id) VALUES (last_insert_rowid())' },
      ]);
      const children = await count(db, 'SELECT COUNT(*) AS n FROM spike_child');
      return { pass: results[0]?.length === 1 && children === 1, detail: { results, children } };
    },
  ],
  [
    'batch rolls back every statement when one fails',
    async (db) => {
      const error = await db
        .batch([
          { sql: 'INSERT INTO spike_parent (name) VALUES (?)', params: ['p3'] },
          { sql: 'UPDATE spike_parent SET name = ? WHERE name = ?', params: ['p1-renamed', 'p1'] },
          { sql: 'INSERT INTO spike_child (parent_id) VALUES (?)', params: [999999] },
        ])
        .then(
          () => undefined,
          (e: unknown) => String(e),
        );
      const leaked = await count(
        db,
        "SELECT COUNT(*) AS n FROM spike_parent WHERE name IN ('p3', 'p1-renamed')",
      );
      return { pass: error !== undefined && leaked === 0, detail: { error, leaked } };
    },
  ],
  [
    'connection is usable after a rolled-back batch',
    async (db) => {
      await db.batch([{ sql: 'INSERT INTO spike_parent (name) VALUES (?)', params: ['p4'] }]);
      const rows = await count(db, "SELECT COUNT(*) AS n FROM spike_parent WHERE name = 'p4'");
      return { pass: rows === 1, detail: { rows } };
    },
  ],
];

async function run(dbName: string): Promise<CheckResult[]> {
  const db = createAzionSqlDatabase({ name: dbName });
  await db.execute('DROP TABLE IF EXISTS spike_child');
  await db.execute('DROP TABLE IF EXISTS spike_parent');
  await db.execute(
    'CREATE TABLE spike_parent (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE)',
  );
  await db.execute(
    'CREATE TABLE spike_child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES spike_parent(id))',
  );

  const report: CheckResult[] = [];
  try {
    for (const [check, fn] of CHECKS) {
      try {
        report.push({ check, ...(await fn(db)) });
      } catch (error) {
        report.push({ check, pass: false, detail: `threw: ${String(error)}` });
      }
    }
  } finally {
    await db.execute('DROP TABLE IF EXISTS spike_child');
    await db.execute('DROP TABLE IF EXISTS spike_parent');
  }
  return report;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const dbName = new URL(request.url).searchParams.get('db');
    if (!dbName) return Response.json({ error: 'pass ?db=<test database>' }, { status: 400 });
    try {
      return Response.json(await run(dbName));
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 500 });
    }
  },
};
