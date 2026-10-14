import { describe, expect, it } from 'vitest';
import { splitStatements } from './split-statements';

describe('splitStatements', () => {
  it('splits on semicolons and drops empty statements', () => {
    expect(
      splitStatements('CREATE TABLE a (id INTEGER);\n\n;CREATE TABLE b (id INTEGER)\n'),
    ).toEqual(['CREATE TABLE a (id INTEGER)', 'CREATE TABLE b (id INTEGER)']);
  });

  it('keeps semicolons inside quoted strings and identifiers, including escaped quotes', () => {
    const script = `INSERT INTO t VALUES ('a;b', 'it''s;'); SELECT "odd;name", \`x;y\` FROM t;`;

    expect(splitStatements(script)).toEqual([
      `INSERT INTO t VALUES ('a;b', 'it''s;')`,
      'SELECT "odd;name", `x;y` FROM t',
    ]);
  });

  it('drops line and block comments, even when they contain semicolons', () => {
    const script = '-- header; ignored\nSELECT 1; /* a; b */ SELECT 2 -- trailing;';

    expect(splitStatements(script)).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('returns nothing for a script with only comments and whitespace', () => {
    expect(splitStatements('  -- nothing here\n/* or here */\n')).toEqual([]);
  });

  it('rejects unterminated quotes and block comments', () => {
    expect(() => splitStatements("SELECT 'oops")).toThrow(/Unterminated ' quote/);
    expect(() => splitStatements('SELECT 1 /* oops')).toThrow(/Unterminated block comment/);
  });
});
