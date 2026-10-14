CREATE TABLE product_category (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE unit_of_measure (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  symbol TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE market (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE product (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES product_category (id) ON DELETE RESTRICT,
  uom_id INTEGER NOT NULL REFERENCES unit_of_measure (id) ON DELETE RESTRICT,
  brand TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_product_category_id ON product (category_id);
CREATE INDEX idx_product_uom_id ON product (uom_id);

CREATE TABLE inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL UNIQUE REFERENCES product (id) ON DELETE RESTRICT,
  estimated_quantity REAL NOT NULL DEFAULT 0 CHECK (estimated_quantity >= 0),
  minimum_quantity REAL NOT NULL DEFAULT 0 CHECK (minimum_quantity >= 0)
);

CREATE TABLE shopping_list (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'open', 'completed', 'cancelled')),
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX idx_shopping_list_status ON shopping_list (status);

CREATE TABLE shopping_list_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shopping_list_id INTEGER NOT NULL REFERENCES shopping_list (id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES product (id) ON DELETE RESTRICT,
  suggested_quantity REAL NOT NULL CHECK (suggested_quantity > 0),
  UNIQUE (shopping_list_id, product_id)
);

CREATE INDEX idx_shopping_list_item_product_id ON shopping_list_item (product_id);

CREATE TABLE purchase (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchased_at TEXT NOT NULL,
  market_id INTEGER NOT NULL REFERENCES market (id) ON DELETE RESTRICT,
  shopping_list_id INTEGER UNIQUE REFERENCES shopping_list (id) ON DELETE RESTRICT,
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  notes TEXT
);

CREATE INDEX idx_purchase_market_id ON purchase (market_id);
CREATE INDEX idx_purchase_purchased_at ON purchase (purchased_at);

CREATE TABLE purchase_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchase (id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES product (id) ON DELETE RESTRICT,
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  total_price INTEGER NOT NULL CHECK (total_price >= 0)
);

CREATE INDEX idx_purchase_item_purchase_id ON purchase_item (purchase_id);
CREATE INDEX idx_purchase_item_product_id ON purchase_item (product_id);
