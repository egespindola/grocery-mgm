import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BetterSqliteDatabase } from '../better-sqlite.adapter';
import { ConstraintViolationError } from '../sqlite-errors';
import { createMigratedDatabase } from '../testing/migrated-database';
import { loadMigrations } from './load-migrations';
import { migrate } from './migrator';

const EXPECTED_COLUMNS: Record<string, string[]> = {
  product_category: ['id', 'name'],
  unit_of_measure: ['id', 'name', 'symbol'],
  market: ['id', 'name', 'address', 'created_at'],
  product: [
    'id',
    'name',
    'category_id',
    'uom_id',
    'brand',
    'is_active',
    'created_at',
    'updated_at',
  ],
  inventory: ['id', 'product_id', 'estimated_quantity', 'minimum_quantity'],
  shopping_list: ['id', 'name', 'status', 'created_at', 'completed_at'],
  shopping_list_item: ['id', 'shopping_list_id', 'product_id', 'suggested_quantity'],
  purchase: ['id', 'purchased_at', 'market_id', 'shopping_list_id', 'total_amount', 'notes'],
  purchase_item: ['id', 'purchase_id', 'product_id', 'quantity', 'unit_price', 'total_price'],
  schema_migrations: ['version', 'applied_at'],
};

const NOW = '2026-10-13T12:00:00.000Z';

describe('schema (all migrations)', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = await createMigratedDatabase();
  });

  afterEach(() => db.close());

  const insert = (sql: string, params: (string | number | null)[] = []) => db.execute(sql, params);

  const seedProduct = async () => {
    await insert("INSERT INTO product_category (name) VALUES ('Dairy')");
    await insert("INSERT INTO unit_of_measure (name, symbol) VALUES ('Liter', 'L')");
    await insert(
      "INSERT INTO product (name, category_id, uom_id, created_at, updated_at) VALUES ('Milk', 1, 1, ?, ?)",
      [NOW, NOW],
    );
  };

  const rejectsWith = (kind: 'unique' | 'foreign_key') => (error: unknown) =>
    error instanceof ConstraintViolationError && error.kind === kind;

  it('creates exactly the expected tables and columns', async () => {
    const tables = await db.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    );
    expect(tables.map((t) => t.name).sort()).toEqual(Object.keys(EXPECTED_COLUMNS).sort());

    for (const [table, columns] of Object.entries(EXPECTED_COLUMNS)) {
      const info = await db.query<{ name: string }>(`PRAGMA table_info(${table})`);
      expect(
        info.map((c) => c.name),
        table,
      ).toEqual(columns);
    }
  });

  it('indexes every foreign key column and the filtered/sorted columns', async () => {
    const indexed = new Set<string>();
    for (const table of Object.keys(EXPECTED_COLUMNS)) {
      for (const { name } of await db.query<{ name: string }>(`PRAGMA index_list(${table})`)) {
        const [first] = await db.query<{ name: string }>(`PRAGMA index_info(${name})`);
        indexed.add(`${table}.${first?.name}`);
      }
    }

    for (const table of Object.keys(EXPECTED_COLUMNS)) {
      for (const fk of await db.query<{ from: string }>(`PRAGMA foreign_key_list(${table})`)) {
        expect(indexed, `${table}.${fk.from}`).toContain(`${table}.${fk.from}`);
      }
    }
    expect(indexed).toContain('purchase.purchased_at');
    expect(indexed).toContain('shopping_list.status');
  });

  it('applies defaults for product and inventory', async () => {
    await seedProduct();
    await insert('INSERT INTO inventory (product_id) VALUES (1)');

    expect(await db.query('SELECT is_active FROM product')).toEqual([{ is_active: 1 }]);
    expect(await db.query('SELECT estimated_quantity, minimum_quantity FROM inventory')).toEqual([
      { estimated_quantity: 0, minimum_quantity: 0 },
    ]);
  });

  it('enforces case-insensitive uniqueness on category and unit names', async () => {
    await seedProduct();

    await expect(insert("INSERT INTO product_category (name) VALUES ('DAIRY')")).rejects.toSatisfy(
      rejectsWith('unique'),
    );
    await expect(
      insert("INSERT INTO unit_of_measure (name, symbol) VALUES ('liter', 'x')"),
    ).rejects.toSatisfy(rejectsWith('unique'));
    await expect(
      insert("INSERT INTO unit_of_measure (name, symbol) VALUES ('Other', 'l')"),
    ).rejects.toSatisfy(rejectsWith('unique'));
  });

  it('restricts deleting rows that are still referenced', async () => {
    await seedProduct();

    await expect(insert('DELETE FROM product_category WHERE id = 1')).rejects.toSatisfy(
      rejectsWith('foreign_key'),
    );
    await expect(insert('DELETE FROM unit_of_measure WHERE id = 1')).rejects.toSatisfy(
      rejectsWith('foreign_key'),
    );
  });

  it('cascades deleting aggregate roots to their items only', async () => {
    await seedProduct();
    await insert("INSERT INTO market (name, created_at) VALUES ('Market', ?)", [NOW]);
    await insert(
      "INSERT INTO shopping_list (name, status, created_at) VALUES ('Week', 'open', ?)",
      [NOW],
    );
    await insert(
      'INSERT INTO shopping_list_item (shopping_list_id, product_id, suggested_quantity) VALUES (1, 1, 2)',
    );
    await insert(
      'INSERT INTO purchase (purchased_at, market_id, total_amount) VALUES (?, 1, 500)',
      [NOW],
    );
    await insert(
      'INSERT INTO purchase_item (purchase_id, product_id, quantity, unit_price, total_price) VALUES (1, 1, 2, 250, 500)',
    );

    await insert('DELETE FROM shopping_list WHERE id = 1');
    await insert('DELETE FROM purchase WHERE id = 1');

    expect(await db.query('SELECT COUNT(*) AS n FROM shopping_list_item')).toEqual([{ n: 0 }]);
    expect(await db.query('SELECT COUNT(*) AS n FROM purchase_item')).toEqual([{ n: 0 }]);
    expect(await db.query('SELECT COUNT(*) AS n FROM product')).toEqual([{ n: 1 }]);
  });

  it('links a shopping list to at most one purchase and a product once per list', async () => {
    await seedProduct();
    await insert("INSERT INTO market (name, created_at) VALUES ('Market', ?)", [NOW]);
    await insert(
      "INSERT INTO shopping_list (name, status, created_at) VALUES ('Week', 'open', ?)",
      [NOW],
    );
    const purchase =
      'INSERT INTO purchase (purchased_at, market_id, shopping_list_id, total_amount) VALUES (?, 1, ?, 0)';
    await insert(purchase, [NOW, 1]);
    await insert(purchase, [NOW, null]);
    await insert(purchase, [NOW, null]);

    await expect(insert(purchase, [NOW, 1])).rejects.toSatisfy(rejectsWith('unique'));

    const item =
      'INSERT INTO shopping_list_item (shopping_list_id, product_id, suggested_quantity) VALUES (1, 1, 1)';
    await insert(item);
    await expect(insert(item)).rejects.toSatisfy(rejectsWith('unique'));
  });

  it.each([
    ["INSERT INTO shopping_list (name, status, created_at) VALUES ('x', 'archived', '')"],
    [
      'INSERT INTO shopping_list_item (shopping_list_id, product_id, suggested_quantity) VALUES (1, 1, 0)',
    ],
    [
      'INSERT INTO purchase_item (purchase_id, product_id, quantity, unit_price, total_price) VALUES (1, 1, 0, 1, 0)',
    ],
    [
      'INSERT INTO purchase_item (purchase_id, product_id, quantity, unit_price, total_price) VALUES (1, 1, 1, -1, 0)',
    ],
  ])('rejects values outside the CHECK constraints: %s', async (sql) => {
    await seedProduct();
    await insert("INSERT INTO market (name, created_at) VALUES ('Market', ?)", [NOW]);
    await insert(
      "INSERT INTO shopping_list (name, status, created_at) VALUES ('Week', 'open', ?)",
      [NOW],
    );
    await insert('INSERT INTO purchase (purchased_at, market_id, total_amount) VALUES (?, 1, 0)', [
      NOW,
    ]);

    await expect(insert(sql)).rejects.toThrow(/CHECK constraint failed/);
  });

  it('is a no-op when migrated a second time', async () => {
    expect(await migrate(db, await loadMigrations())).toEqual([]);
  });
});
