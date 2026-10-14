import BetterSqlite3 from 'better-sqlite3';
import type { Database, ExecuteResult, Row, SqlValue, Statement } from './database.port';
import { translateSqliteError } from './sqlite-errors';

export interface BetterSqliteDatabase extends Database {
  close(): void;
}

export function createBetterSqliteDatabase(filename = ':memory:'): BetterSqliteDatabase {
  const db = new BetterSqlite3(filename);
  db.pragma('foreign_keys = ON');

  const run = <T>(fn: () => T): Promise<T> => {
    try {
      return Promise.resolve(fn());
    } catch (error) {
      return Promise.reject(translateSqliteError(error));
    }
  };

  const execute = (sql: string, params: readonly SqlValue[] = []): ExecuteResult => {
    const { changes, lastInsertRowid } = db.prepare(sql).run(...params);
    return { changes, lastInsertId: Number(lastInsertRowid) };
  };

  const runInBatch = ({ sql, params = [] }: Statement): Row[] => {
    const stmt = db.prepare(sql);
    if (stmt.reader) return stmt.all(...params) as Row[];
    stmt.run(...params);
    return [];
  };

  const batch = db.transaction((statements: readonly Statement[]) => statements.map(runInBatch));

  return {
    query: <T extends Row = Row>(sql: string, params: readonly SqlValue[] = []) =>
      run(() => db.prepare(sql).all(...params) as T[]),
    execute: (sql, params) => run(() => execute(sql, params)),
    batch: (statements) => run(() => batch(statements)),
    close: () => db.close(),
  };
}
