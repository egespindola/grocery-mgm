import { createBetterSqliteDatabase } from '../src/shared/db/better-sqlite.adapter';
import type { Database } from '../src/shared/db/database.port';
import { loadMigrations } from '../src/shared/db/migrations/load-migrations';
import { migrate } from '../src/shared/db/migrations/migrator';

interface Target {
  open(): { db: Database; close(): void };
  verify?: boolean;
}

// Each target only picks a Database adapter; the migrator itself depends on the port alone, so
// adding a remote database later means adding an entry here.
const targets: Record<string, Target> = {
  local: {
    open: () => {
      const path = process.env.DATABASE_PATH;
      if (!path) throw new Error('DATABASE_PATH is not set (see .env.example)');
      const db = createBetterSqliteDatabase(path);
      return { db, close: () => db.close() };
    },
  },
  validate: {
    open: () => {
      const db = createBetterSqliteDatabase(':memory:');
      return { db, close: () => db.close() };
    },
    verify: true,
  },
};

async function main(name: string | undefined): Promise<void> {
  const target = name ? targets[name] : undefined;
  if (!target) {
    throw new Error(
      `Unknown target "${name ?? ''}". Use one of: ${Object.keys(targets).join(', ')}`,
    );
  }

  const migrations = await loadMigrations();
  const { db, close } = target.open();
  try {
    const applied = await migrate(db, migrations);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Already up to date');

    if (target.verify) {
      const reapplied = await migrate(db, migrations);
      if (reapplied.length) throw new Error(`Second run was not a no-op: ${reapplied.join(', ')}`);
      console.log('Second run was a no-op');
    }
  } finally {
    close();
  }
}

main(process.argv[2]).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
