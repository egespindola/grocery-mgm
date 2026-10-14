import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Migration } from './migrator';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../migrations', import.meta.url));

const FILE_NAME = /^(\d{4})_([a-z0-9_]+)\.sql$/;

/** Reads `NNNN_description.sql` files from `dir`; other files (e.g. `.gitkeep`) are ignored. */
export async function loadMigrations(dir: string = MIGRATIONS_DIR): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();

  return Promise.all(
    files.map(async (file) => {
      const match = FILE_NAME.exec(file);
      if (!match) throw new Error(`Invalid migration file name: ${file}`);
      const [, version, name] = match as unknown as [string, string, string];
      return { version, name, sql: await readFile(join(dir, file), 'utf8') };
    }),
  );
}
