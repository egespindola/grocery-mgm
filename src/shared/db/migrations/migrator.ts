import { type Clock, systemClock } from '../../clock';
import type { Database } from '../database.port';
import { splitStatements } from './split-statements';

export interface Migration {
  /** Zero-padded sequence number taken from the file name, e.g. `0001`. */
  version: string;
  name: string;
  sql: string;
}

const CREATE_SCHEMA_MIGRATIONS = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
)`;

/**
 * Applies every migration not yet recorded in `schema_migrations`, in version order. Each
 * migration and its bookkeeping row run in one `batch`, so a failing migration leaves no trace.
 * Returns the versions applied by this call (empty when the database is already up to date).
 */
export async function migrate(
  db: Database,
  migrations: readonly Migration[],
  clock: Clock = systemClock,
): Promise<string[]> {
  const ordered = [...migrations].sort((a, b) => a.version.localeCompare(b.version));
  ordered.forEach((migration, i) => {
    if (migration.version === ordered[i - 1]?.version) {
      throw new Error(`Duplicate migration version ${migration.version}`);
    }
  });

  await db.execute(CREATE_SCHEMA_MIGRATIONS);
  const rows = await db.query<{ version: string }>('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map((row) => row.version));

  const appliedNow: string[] = [];
  for (const migration of ordered) {
    if (applied.has(migration.version)) continue;
    try {
      await db.batch([
        ...splitStatements(migration.sql).map((sql) => ({ sql })),
        {
          sql: 'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
          params: [migration.version, clock.now()],
        },
      ]);
    } catch (error) {
      throw new Error(`Migration ${migration.version}_${migration.name} failed`, { cause: error });
    }
    appliedNow.push(migration.version);
  }
  return appliedNow;
}
