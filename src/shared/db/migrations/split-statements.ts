/**
 * Splits a SQL script into individual statements on `;`, ignoring semicolons inside quoted
 * strings, quoted identifiers and comments. Comments are dropped from the output.
 *
 * Statements with nested `;` (such as `CREATE TRIGGER … BEGIN … END`) are not supported.
 */
export function splitStatements(script: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;

  const push = () => {
    const sql = current.trim();
    if (sql) statements.push(sql);
    current = '';
  };

  while (i < script.length) {
    const char = script[i] as string;
    const next = script[i + 1];

    if (char === '-' && next === '-') {
      const end = script.indexOf('\n', i);
      i = end === -1 ? script.length : end;
    } else if (char === '/' && next === '*') {
      const end = script.indexOf('*/', i + 2);
      if (end === -1) throw new Error('Unterminated block comment in SQL script');
      current += ' ';
      i = end + 2;
    } else if (char === "'" || char === '"' || char === '`') {
      let end = i + 1;
      for (;;) {
        end = script.indexOf(char, end);
        if (end === -1) throw new Error(`Unterminated ${char} quote in SQL script`);
        if (script[end + 1] !== char) break;
        end += 2;
      }
      current += script.slice(i, end + 1);
      i = end + 1;
    } else if (char === ';') {
      push();
      i++;
    } else {
      current += char;
      i++;
    }
  }
  push();

  return statements;
}
