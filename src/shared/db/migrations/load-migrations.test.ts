import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadMigrations } from './load-migrations';

describe('loadMigrations', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'migrations-'));
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('reads NNNN_description.sql files in order and ignores other files', async () => {
    await writeFile(join(dir, '0002_add_b.sql'), 'CREATE TABLE b (id INTEGER);');
    await writeFile(join(dir, '0001_init.sql'), 'CREATE TABLE a (id INTEGER);');
    await writeFile(join(dir, '.gitkeep'), '');

    expect(await loadMigrations(dir)).toEqual([
      { version: '0001', name: 'init', sql: 'CREATE TABLE a (id INTEGER);' },
      { version: '0002', name: 'add_b', sql: 'CREATE TABLE b (id INTEGER);' },
    ]);
  });

  it('rejects .sql files that do not follow the naming convention', async () => {
    await writeFile(join(dir, '1_init.sql'), '');

    await expect(loadMigrations(dir)).rejects.toThrow('Invalid migration file name: 1_init.sql');
  });

  it('defaults to the project migrations folder', async () => {
    const migrations = await loadMigrations();

    expect(migrations[0]).toMatchObject({ version: '0001', name: 'init' });
  });
});
