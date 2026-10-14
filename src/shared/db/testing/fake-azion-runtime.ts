import BetterSqlite3 from 'better-sqlite3';
import type { AzionSqlConnection, AzionSqlRows, OpenAzionDatabase } from '../azion-sql.adapter';
import type { SqlValue } from '../database.port';

export interface FakeAzionRuntime {
  open: OpenAzionDatabase;
  /** Every SQL string received by the fake connection, in arrival order. */
  log: string[];
  raw: BetterSqlite3.Database;
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function toRows(columns: string[], values: SqlValue[][]): AzionSqlRows {
  let cursor = 0;
  return {
    columnCount: () => columns.length,
    columnName: (i) => columns[i] ?? '',
    next: async () => {
      const row = values[cursor++];
      return row && { getValue: (i: number) => row[i] ?? null };
    },
  };
}

/**
 * Emulates `Azion.Sql.Database.open` on top of better-sqlite3. Each call yields to the event loop
 * first, so interleaving between concurrent callers becomes observable in `log`.
 */
export function createFakeAzionRuntime(): FakeAzionRuntime {
  const raw = new BetterSqlite3(':memory:');
  const log: string[] = [];

  const connection: AzionSqlConnection = {
    async query(sql, params = []) {
      log.push(sql);
      await tick();
      const stmt = raw.prepare(sql);
      if (!stmt.reader) {
        stmt.run(...params);
        return toRows([], []);
      }
      const columns = stmt.columns().map((column) => column.name);
      return toRows(columns, stmt.raw(true).all(...params) as SqlValue[][]);
    },
    async execute(sql, params = []) {
      log.push(sql);
      await tick();
      raw.prepare(sql).run(...params);
    },
  };

  return { open: async () => connection, log, raw };
}
