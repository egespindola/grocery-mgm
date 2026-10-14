import { type BetterSqliteDatabase, createBetterSqliteDatabase } from '../better-sqlite.adapter';
import { loadMigrations } from '../migrations/load-migrations';
import { migrate } from '../migrations/migrator';

/** In-memory database with every migration applied, for integration tests. */
export async function createMigratedDatabase(): Promise<BetterSqliteDatabase> {
  const db = createBetterSqliteDatabase();
  await migrate(db, await loadMigrations());
  return db;
}
