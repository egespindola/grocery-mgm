import type { Database, ExecuteResult, Row, SqlValue, Statement } from './database.port';
import { translateSqliteError } from './sqlite-errors';

// Minimal shape of the Edge Runtime SQL API (`globalThis.Azion.Sql.Database`). The `azion/sql`
// package is not used here because it runs statements concurrently and has no bound parameters;
// see docs/spikes/azion-sql-atomicity.md.
export interface AzionSqlRow {
  getValue(index: number): SqlValue;
}

export interface AzionSqlRows {
  columnCount(): number;
  columnName(index: number): string;
  next(): Promise<AzionSqlRow | null | undefined>;
}

export interface AzionSqlConnection {
  query(sql: string, params?: SqlValue[]): Promise<AzionSqlRows>;
  execute(sql: string, params?: SqlValue[]): Promise<unknown>;
}

export type OpenAzionDatabase = (name: string) => Promise<AzionSqlConnection>;

export interface AzionSqlDatabaseOptions {
  name: string;
  open?: OpenAzionDatabase;
}

declare global {
  var Azion: { Sql?: { Database?: { open: OpenAzionDatabase } } } | undefined;
}

function runtimeOpen(name: string): Promise<AzionSqlConnection> {
  const open = globalThis.Azion?.Sql?.Database?.open;
  if (!open) throw new Error('Azion Edge SQL runtime API is not available');
  return open(name);
}

const returnsRows = (sql: string) => /^\s*(SELECT|WITH|PRAGMA)\b|\bRETURNING\b/i.test(sql);

async function readRows<T extends Row>(rows: AzionSqlRows): Promise<T[]> {
  const columns = Array.from({ length: rows.columnCount() }, (_, i) => rows.columnName(i));
  const result: T[] = [];
  if (columns.length === 0) return result;
  for (let row = await rows.next(); row; row = await rows.next()) {
    const record: Row = {};
    columns.forEach((column, i) => {
      record[column] = row.getValue(i);
    });
    result.push(record as T);
  }
  return result;
}

export function createAzionSqlDatabase({
  name,
  open = runtimeOpen,
}: AzionSqlDatabaseOptions): Database {
  let connection: Promise<AzionSqlConnection> | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  const connect = () => {
    if (!connection) {
      connection = open(name).then(async (conn) => {
        await conn.execute('PRAGMA foreign_keys = ON');
        return conn;
      });
      connection.catch(() => {
        connection = undefined;
      });
    }
    return connection;
  };

  // The connection is shared by every request handled by the isolate. Operations are serialized
  // so that a batch's BEGIN…COMMIT, or an execute and its changes() lookup, never interleave with
  // statements from another request.
  const exclusive = <T>(fn: (conn: AzionSqlConnection) => Promise<T>): Promise<T> => {
    const task = queue.then(async () => {
      try {
        return await fn(await connect());
      } catch (error) {
        throw translateSqliteError(error);
      }
    });
    queue = task.catch(() => undefined);
    return task;
  };

  const query = async <T extends Row>(conn: AzionSqlConnection, sql: string, params: SqlValue[]) =>
    readRows<T>(await conn.query(sql, params));

  return {
    query: <T extends Row = Row>(sql: string, params: readonly SqlValue[] = []) =>
      exclusive((conn) => query<T>(conn, sql, [...params])),

    execute: (sql, params = []) =>
      exclusive(async (conn): Promise<ExecuteResult> => {
        await conn.execute(sql, [...params]);
        const [info] = await query<{ changes: number; id: number }>(
          conn,
          'SELECT changes() AS changes, last_insert_rowid() AS id',
          [],
        );
        return { changes: Number(info?.changes ?? 0), lastInsertId: Number(info?.id ?? 0) };
      }),

    batch: (statements: readonly Statement[]) =>
      exclusive(async (conn) => {
        await conn.execute('BEGIN');
        try {
          const results: Row[][] = [];
          for (const { sql, params = [] } of statements) {
            if (returnsRows(sql)) {
              results.push(await query(conn, sql, [...params]));
            } else {
              await conn.execute(sql, [...params]);
              results.push([]);
            }
          }
          await conn.execute('COMMIT');
          return results;
        } catch (error) {
          await conn.execute('ROLLBACK').catch(() => undefined);
          throw error;
        }
      }),
  };
}
