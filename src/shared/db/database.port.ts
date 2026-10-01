export type SqlValue = string | number | null;

export type Row = Record<string, SqlValue>;

export interface Statement {
  sql: string;
  params?: readonly SqlValue[];
}

export interface ExecuteResult {
  changes: number;
  lastInsertId: number;
}

export interface Database {
  query<T extends Row = Row>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  execute(sql: string, params?: readonly SqlValue[]): Promise<ExecuteResult>;
  /**
   * Runs every statement in order inside a single transaction: either all of them apply or none
   * do. Returns the rows produced by each statement (empty for statements without `RETURNING`).
   */
  batch(statements: readonly Statement[]): Promise<Row[][]>;
}
