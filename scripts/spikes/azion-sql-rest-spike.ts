// MYPRS-4 spike: is a multi-statement request through the Edge SQL REST API (the path `azion/sql`
// takes outside the edge runtime) atomic? See docs/spikes/azion-sql-atomicity.md.
//
// Usage: AZION_TOKEN=... AZION_DB_NAME=<disposable test database> pnpm exec tsx scripts/spikes/azion-sql-rest-spike.ts
import { useExecute, useQuery } from 'azion/sql';

const dbName = process.env.AZION_DB_NAME;
if (!process.env.AZION_TOKEN || !dbName) {
  console.error('Set AZION_TOKEN and AZION_DB_NAME (use a disposable test database).');
  process.exit(1);
}

const TABLE = 'spike_atomicity';

async function rowsWith(value: string): Promise<number> {
  const { data, error } = await useQuery(dbName as string, [
    `SELECT COUNT(*) AS n FROM ${TABLE} WHERE v = '${value}'`,
  ]);
  if (error) throw new Error(`count failed: ${error.message}`);
  return Number(data?.results?.[0]?.rows?.[0]?.[0] ?? Number.NaN);
}

async function attempt(label: string, statements: string[], value: string) {
  const { data, error } = await useExecute(dbName as string, statements);
  const persisted = await rowsWith(value);
  return {
    label,
    state: data?.state,
    error: error?.message,
    rowsPersisted: persisted,
    atomic: persisted === 0,
  };
}

const setup = await useExecute(
  dbName,
  [`DROP TABLE IF EXISTS ${TABLE}`, `CREATE TABLE ${TABLE} (v TEXT NOT NULL UNIQUE)`],
  { force: true },
);
if (setup.error) throw new Error(`setup failed: ${setup.error.message}`);

try {
  const report = [
    await attempt(
      'plain multi-statement request, second INSERT violates UNIQUE',
      [`INSERT INTO ${TABLE} (v) VALUES ('a')`, `INSERT INTO ${TABLE} (v) VALUES ('a')`],
      'a',
    ),
    await attempt(
      'same request wrapped in BEGIN/COMMIT',
      [
        'BEGIN',
        `INSERT INTO ${TABLE} (v) VALUES ('b')`,
        `INSERT INTO ${TABLE} (v) VALUES ('b')`,
        'COMMIT',
      ],
      'b',
    ),
  ];
  console.log(JSON.stringify(report, null, 2));
} finally {
  await useExecute(dbName, [`DROP TABLE IF EXISTS ${TABLE}`], { force: true });
}
