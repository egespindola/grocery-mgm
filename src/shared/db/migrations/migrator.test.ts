import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../../clock';
import { type BetterSqliteDatabase, createBetterSqliteDatabase } from '../better-sqlite.adapter';
import { type Migration, migrate } from './migrator';

const clock = fixedClock('2026-10-13T12:00:00Z');

const m = (version: string, sql: string): Migration => ({ version, name: `m${version}`, sql });

describe('migrate', () => {
  let db: BetterSqliteDatabase;

  beforeEach(() => {
    db = createBetterSqliteDatabase();
  });

  afterEach(() => db.close());

  const tables = async () =>
    (
      await db.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
    ).map((row) => row.name);

  it('applies pending migrations in version order and records them', async () => {
    const applied = await migrate(
      db,
      [
        m('0002', 'ALTER TABLE a ADD COLUMN extra TEXT;'),
        m('0001', 'CREATE TABLE a (id INTEGER PRIMARY KEY); CREATE TABLE b (id INTEGER);'),
      ],
      clock,
    );

    expect(applied).toEqual(['0001', '0002']);
    expect(await tables()).toEqual(['a', 'b', 'schema_migrations']);
    expect(await db.query('SELECT * FROM schema_migrations ORDER BY version')).toEqual([
      { version: '0001', applied_at: '2026-10-13T12:00:00.000Z' },
      { version: '0002', applied_at: '2026-10-13T12:00:00.000Z' },
    ]);
  });

  it('is a no-op when every migration is already applied', async () => {
    const migrations = [m('0001', 'CREATE TABLE a (id INTEGER)')];
    await migrate(db, migrations, clock);

    expect(await migrate(db, migrations, clock)).toEqual([]);
  });

  it('applies only the migrations added since the last run', async () => {
    await migrate(db, [m('0001', 'CREATE TABLE a (id INTEGER)')], clock);

    const applied = await migrate(
      db,
      [m('0001', 'CREATE TABLE a (id INTEGER)'), m('0002', 'CREATE TABLE b (id INTEGER)')],
      clock,
    );

    expect(applied).toEqual(['0002']);
  });

  it('rolls back a failing migration entirely and keeps the earlier ones', async () => {
    const run = migrate(
      db,
      [
        m('0001', 'CREATE TABLE a (id INTEGER)'),
        m('0002', 'CREATE TABLE b (id INTEGER); INSERT INTO missing VALUES (1);'),
      ],
      clock,
    );

    await expect(run).rejects.toThrow('Migration 0002_m0002 failed');
    expect(await tables()).toEqual(['a', 'schema_migrations']);
    expect(await db.query('SELECT version FROM schema_migrations')).toEqual([{ version: '0001' }]);
  });

  it('rejects duplicate versions before touching the database', async () => {
    const run = migrate(db, [m('0001', 'SELECT 1'), m('0001', 'SELECT 2')], clock);

    await expect(run).rejects.toThrow('Duplicate migration version 0001');
    expect(await tables()).toEqual([]);
  });
});
