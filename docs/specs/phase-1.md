# Grocery Management — Phase 1 Spec

## 1. Overview

A system for recording grocery purchases. A **Shopping List** is a purchase *intention*; it may or may not become a **Purchase**, which is the purchase actually made.

This spec covers **Phase 1 only**: database migrations, GitHub CI, and the complete backend application (CRUD organized as vertical slices).

Source documents: `.tmp/preset.md`, `.tmp/future-releases.md`, `docs/mermaid/mermaid-erd.md`. Any other spec or document is out of scope and must be disregarded.

## 2. Goals and Non-Goals

### Goals (Phase 1)
- SQLite schema derived from `docs/mermaid/mermaid-erd.md`, applied through plain SQL migration scripts.
- A REST API (Hono) exposing full CRUD for every entity, deployed on Azion Edge.
- Automatic inventory tracking driven by purchases.
- A GitHub Actions pipeline covering lint, typecheck, tests with coverage, migration validation, and deploy.

### Non-Goals (Phase 1)
- Any UI. A static TS/VueJS UI for the edge function comes in Phase 2.
- Authentication. The API is open and single-user in Phase 1.
- Everything in §13 (Future Phases).

## 3. Tech Stack

| Concern | Choice |
|---|---|
| Language | TypeScript (strict mode) |
| HTTP framework | Hono |
| Runtime / hosting | Azion Edge (Edge Functions) |
| Production database | Azion Edge SQL (SQLite dialect), via `azion/sql` |
| Dev/test database | `better-sqlite3` (in-memory for tests, file for local dev) |
| Validation | Zod + `@hono/zod-validator` |
| Tests | Vitest (+ `@vitest/coverage-v8`) |
| Lint / format | Biome |
| Package manager | pnpm |
| Migrations | Plain `.sql` files + a TypeScript runner script |
| Architecture | Ports and Adapters (hexagonal) + vertical slices |

## 4. Domain Model

The ERD in `docs/mermaid/mermaid-erd.md` is the source of truth for the schema.

### 4.1 Conventions
- **Primary keys:** `INTEGER PRIMARY KEY AUTOINCREMENT`.
- **Money:** `INTEGER` in cents (e.g. `1299` = 12.99). The API accepts and returns cents, with no currency conversion.
- **Timestamps:** `TEXT` in ISO-8601 UTC (`2026-09-28T10:00:00.000Z`). The server generates `created_at`, `updated_at` and `completed_at`.
- **Booleans:** `INTEGER` 0/1 in the database, JSON `true`/`false` in the API.
- **Quantities:** `REAL`, expressed in the product's unit of measure.
- **Foreign keys:** `PRAGMA foreign_keys = ON` on every connection. The default is `ON DELETE RESTRICT`; the only exception is aggregate items (§4.3).
- **Text uniqueness:** unique text columns use `COLLATE NOCASE`.

### 4.2 Entities

| Entity | Notes |
|---|---|
| `ProductCategory` | `name` is unique. |
| `UnitOfMeasure` | `name` and `symbol` are unique. |
| `Market` | `address` is optional. |
| `Product` | Belongs to one category and one UoM. `brand` is optional. `is_active` defaults to 1. `updated_at` is refreshed on every update. |
| `Inventory` | At most one per product (`product_id` is `UNIQUE`). `estimated_quantity` defaults to 0 and `minimum_quantity` defaults to 0. |
| `ShoppingList` | Aggregate root; owns its `ShoppingListItem`s. Status follows the state machine in §5.1. |
| `ShoppingListItem` | `suggested_quantity > 0`. A product appears at most once per list (`UNIQUE(shopping_list_id, product_id)`). |
| `Purchase` | Aggregate root; owns its `PurchaseItem`s. May optionally reference one shopping list (`shopping_list_id`, nullable, `UNIQUE`). |
| `PurchaseItem` | `quantity > 0`, `unit_price >= 0`, and `total_price` is computed. The same product may appear more than once in a purchase (e.g. at different prices). |

### 4.3 Aggregates
- **ShoppingList → ShoppingListItem** and **Purchase → PurchaseItem** are aggregates. Items are created, replaced and deleted only through their root, and deleting the root cascades to its items (`ON DELETE CASCADE` on `*_item.<root>_id`).
- Every aggregate write, together with its inventory side-effects, runs atomically (§7.3).

## 5. Business Rules

### 5.1 Shopping List status machine

```
draft ──► open ──► completed
  │         │
  └────┬────┘
       ▼
   cancelled
```

- New lists are created as `draft`, unless `status: "open"` is sent on create.
- Allowed transitions: `draft→open`, `open→completed`, `draft→cancelled` and `open→cancelled`. Any other transition returns **409**.
- `completed` and `cancelled` are **final**. A list in a final state cannot be updated at all (name, items or status), and such a request returns **409**.
- Moving to `completed` sets `completed_at`.
- A list can be completed in two ways: manually through an update, or automatically when a purchase is linked to it (§5.2).

### 5.2 Purchase ↔ Shopping List
- `shopping_list_id` is optional on purchase creation.
- When it is provided, the list must exist (**404** otherwise) and be `open` (**409** otherwise). The list must not already be linked to another purchase; this is guaranteed by the unique constraint and returns **409**.
- When a purchase is created with a list, the same transaction sets the list to `completed` and fills in `completed_at`.
- `shopping_list_id` cannot be changed after creation; attempting it returns **422**.
- Deleting a linked purchase leaves the list `completed`, because final states are immutable.

### 5.3 Totals
- The server always computes `total_price = round(quantity × unit_price)` and `total_amount = Σ total_price`.
- Clients never send totals. If they do, the totals are ignored (stripped by the schema).

### 5.4 Inventory side-effects
All inventory changes happen in the same transaction as the purchase write.

| Purchase operation | Inventory effect |
|---|---|
| Create | For each product in the items: **upsert** the inventory row (create it with `minimum_quantity = 0` if missing) and add the summed quantity to `estimated_quantity`. |
| Update (items replaced) | For each product, apply the delta `new_qty − old_qty`. |
| Delete | For each product, subtract the purchased quantity. |

- `estimated_quantity` is clamped at a minimum of `0`.
- The inventory endpoints also allow manual adjustment (§6.9).

### 5.5 Deletion policy
- **Product:** soft delete. `DELETE` sets `is_active = 0` and the row is kept.
  - Inactive products cannot be added to new or updated shopping lists or purchases (**422**).
  - Inactive products are hidden from `GET /products` by default.
  - A product can be reactivated with `PATCH { "is_active": true }`.
- **Every other entity:** hard delete with FK `RESTRICT`. The delete returns **409** if the row is still referenced, for example:
  - a market that has purchases;
  - a category or UoM that has products;
  - a shopping list that is linked to a purchase.
- **Inventory** has no DELETE endpoint.

### 5.6 Validation (common)
- Text fields are trimmed and must be non-empty; `name` is at most 120 characters, `address` and `notes` at most 500.
- IDs must be positive integers, and referenced IDs must exist (**422**, naming the offending field).
- Purchases require at least 1 item. A shopping list may have 0 items.
- `purchased_at` must be a valid ISO-8601 datetime. It defaults to now if omitted.

## 6. API

- **Base path:** `/api/v1`.
- **Style:** JSON, with `snake_case` fields and resource names in plural kebab-case.
- **Errors:** RFC 9457 `application/problem+json` (§6.11).

### 6.1 Common conventions
- **Status codes:**
  - `201 Created` with a `Location` header on create;
  - `200 OK` on read and update;
  - `204 No Content` on delete.
- **Updates:** use `PATCH` for partial updates. For aggregates, sending `items` **replaces** the entire item set.
- **Collection pagination:** `?limit=20&offset=0`. The default `limit` is 20 and the maximum is 100; `limit > 100` returns **422**.
- **Collection response shape:**
  ```json
  { "data": [ ... ], "meta": { "limit": 20, "offset": 0, "total": 57 } }
  ```
- **Item sub-collections** (`/.../items`) are not paginated. They return `{ "data": [ ... ] }`.

### 6.2 Product Categories
| Method | Path | Description |
|---|---|---|
| POST | `/categories` | Create category |
| GET | `/categories` | List categories (paginated, ordered by `name`) |
| GET | `/categories/:id` | Get category by id |
| PATCH | `/categories/:id` | Update `name` |
| DELETE | `/categories/:id` | Delete (409 if it has products) |

### 6.3 Units of Measure
| Method | Path | Description |
|---|---|---|
| POST | `/units-of-measure` | Create UoM (`name`, `symbol`) |
| GET | `/units-of-measure` | List (paginated, ordered by `name`) |
| GET | `/units-of-measure/:id` | Get by id |
| PATCH | `/units-of-measure/:id` | Update |
| DELETE | `/units-of-measure/:id` | Delete (409 if it has products) |

### 6.4 Markets
| Method | Path | Description |
|---|---|---|
| POST | `/markets` | Create market |
| GET | `/markets` | List (paginated, ordered by `name`) |
| GET | `/markets/:id` | Get market by id |
| PATCH | `/markets/:id` | Update |
| DELETE | `/markets/:id` | Delete (409 if it has purchases) |

### 6.5 Products
| Method | Path | Description |
|---|---|---|
| POST | `/products` | Create product |
| GET | `/products` | List products |
| GET | `/products/:id` | Get product by id (returned even if inactive) |
| PATCH | `/products/:id` | Update (including `is_active`) |
| DELETE | `/products/:id` | Soft delete (`is_active = 0`) |

`GET /products` supports:
- **Filters:**
  - `category_id`;
  - `q`, a case-insensitive substring match on `name`;
  - `include_inactive`, a boolean that defaults to `false`.
- **Pagination:** `limit` and `offset`.
- **Order:** by `name`.

Create body:
```json
{ "name": "Milk", "category_id": 1, "uom_id": 2, "brand": "Acme" }
```

### 6.6 Shopping Lists
| Method | Path | Description |
|---|---|---|
| POST | `/shopping-lists` | Create list with items (atomic) |
| GET | `/shopping-lists` | List shopping lists |
| GET | `/shopping-lists/:id` | Get list header by id |
| GET | `/shopping-lists/:id/items` | List the items of a shopping list |
| PATCH | `/shopping-lists/:id` | Update `name`, `status`, and/or replace `items` |
| DELETE | `/shopping-lists/:id` | Delete (cascades to items; 409 if linked to a purchase) |

`GET /shopping-lists` supports a `status` filter plus `limit` and `offset`, ordered by `created_at DESC`.

Create body:
```json
{
  "name": "Weekly groceries",
  "status": "draft",
  "items": [ { "product_id": 1, "suggested_quantity": 2 } ]
}
```

Create response (201): the list header with `items` embedded.

### 6.7 Purchases
| Method | Path | Description |
|---|---|---|
| POST | `/purchases` | Register purchase with items (atomic; updates inventory; may complete a list) |
| GET | `/purchases` | List purchases |
| GET | `/purchases/:id` | Get purchase header by id |
| GET | `/purchases/:id/items` | List the items of a purchase |
| PATCH | `/purchases/:id` | Update `purchased_at`, `market_id`, `notes`, and/or replace `items` (inventory adjusted by delta) |
| DELETE | `/purchases/:id` | Delete (cascades to items; inventory reverted) |

`GET /purchases` supports:
- **Filters:** `market_id`, `from` and `to` (ISO-8601 bounds on `purchased_at`, inclusive);
- **Pagination:** `limit` and `offset`;
- **Order:** by `purchased_at DESC`.

Create body:
```json
{
  "purchased_at": "2026-09-28T14:30:00.000Z",
  "market_id": 1,
  "shopping_list_id": 3,
  "notes": "Paid with card",
  "items": [
    { "product_id": 1, "quantity": 2, "unit_price": 599 },
    { "product_id": 4, "quantity": 1.25, "unit_price": 3490 }
  ]
}
```

Create response (201): the purchase header, with the computed `total_amount` and `items` embedded (each item with its `total_price`).

### 6.8 Use-case coverage (from preset)
| Preset use case | Endpoint |
|---|---|
| Create product | `POST /products` |
| Create shopping list | `POST /shopping-lists` |
| Register purchase | `POST /purchases` |
| Create market | `POST /markets` |
| Create unit of measure | `POST /units-of-measure` |
| Get product by id | `GET /products/:id` |
| Get market by id | `GET /markets/:id` |
| List shopping lists | `GET /shopping-lists` |
| Get shopping list by id | `GET /shopping-lists/:id` |
| List shopping list items | `GET /shopping-lists/:id/items` |
| List purchases | `GET /purchases` |
| Get purchase by id | `GET /purchases/:id` |
| List purchase items | `GET /purchases/:id/items` |
| List products | `GET /products` |
| *(added)* Create category and full CRUD for all entities | §6.2–§6.7, §6.9 |

### 6.9 Inventory
| Method | Path | Description |
|---|---|---|
| GET | `/inventory` | List inventory rows |
| GET | `/products/:productId/inventory` | Get the inventory of a product (404 if none) |
| PUT | `/products/:productId/inventory` | Upsert `estimated_quantity` and/or `minimum_quantity` (both ≥ 0) |

`GET /inventory` supports:
- **Filters:** `below_minimum`, a boolean; when `true`, it returns only rows with `estimated_quantity < minimum_quantity`.
- **Pagination:** `limit` and `offset`.

### 6.10 Health
`GET /health` returns `200 { "status": "ok" }`. This endpoint does not use the database.

### 6.11 Error format (RFC 9457)
```json
{
  "type": "https://grocery-mgm/errors/validation",
  "title": "Validation failed",
  "status": 422,
  "detail": "Request body is invalid",
  "instance": "/api/v1/purchases",
  "errors": [ { "field": "items[0].quantity", "message": "Must be greater than 0" } ]
}
```

| Status | When |
|---|---|
| 400 | Malformed JSON |
| 404 | Resource not found |
| 409 | Unique conflict, FK restrict on delete, invalid status transition, final-state list, list already linked |
| 422 | Schema/validation failure, unknown referenced id in body, inactive product in items, limit > 100 |
| 500 | Unexpected error (no internals leaked) |

## 7. Architecture

### 7.1 Ports and Adapters + vertical slices
Each feature module is split into three layers:
- **Domain:** entities, value objects, rules and errors. Pure TypeScript with no framework imports.
- **Application:** one folder per use case (a vertical slice). Each use case depends only on **ports** (interfaces).
- **Adapters:**
  - inbound: HTTP (Hono routes, Zod schemas);
  - outbound: SQLite repositories implementing the ports.

The composition root wires adapters to ports.

```
src/
  index.ts                     # Azion edge entry (fetch handler)
  app.ts                       # buildApp(deps): Hono app, composition root
  shared/
    db/
      database.port.ts         # Database port: query, execute, batch (atomic)
      azion-sql.adapter.ts     # Production adapter (azion/sql)
      better-sqlite.adapter.ts # Dev/test adapter
    http/
      problem.ts               # RFC 9457 helpers + global error handler
      pagination.ts
    errors.ts                  # NotFound, Conflict, Validation domain errors
    clock.ts                   # Clock port (testable "now")
  modules/
    categories/
    units-of-measure/
    markets/
    products/
    inventory/
    shopping-lists/
    purchases/
      domain/
        purchase.ts            # aggregate + totals rule
      application/
        ports/
          purchase.repository.ts
        register-purchase/
          register-purchase.use-case.ts
          register-purchase.use-case.test.ts
        get-purchase/
        list-purchases/
        list-purchase-items/
        update-purchase/
        delete-purchase/
      adapters/
        http/
          purchases.routes.ts
          purchases.schemas.ts
          purchases.routes.test.ts
        persistence/
          sqlite-purchase.repository.ts
migrations/
  0001_init.sql
scripts/
  migrate.ts                   # migration runner
```

### 7.2 Dependency rule
- `domain` imports nothing outside itself.
- `application` imports `domain` and ports only.
- `adapters` import `application` and `domain`.
- Cross-module access goes through ports. For example, `purchases` uses an `InventoryWriter` port and a `ShoppingListStatusPort` implemented by the other modules' adapters, never by importing another module's repository directly.

### 7.3 Transactions
- The `Database` port exposes `batch(statements[])`, which must execute atomically: all statements succeed or none apply.
- Aggregate writes and their side-effects (inventory, list completion) are built as a single batch.
- **Implementation risk:** confirm that the Azion Edge SQL multi-statement execution is transactional. If it is not, the Azion adapter must wrap the batch in `BEGIN`/`COMMIT` or use the atomic API offered by `azion/sql`. This must be validated before Purchase is implemented.

## 8. Migrations

- Plain SQL files in `migrations/`, named `NNNN_description.sql` (zero-padded and sequential). Migrations are forward-only.
- `0001_init.sql` creates all tables from the ERD, including the constraints, defaults, `CHECK`s (status values, quantity > 0, price ≥ 0) and indexes:
  - indexes on every FK column;
  - an index on `purchase(purchased_at)`;
  - an index on `shopping_list(status)`.
- `scripts/migrate.ts`:
  - keeps a `schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT)` table;
  - applies pending files in order, each inside a transaction;
  - is idempotent.
- The runner supports two targets:
  - `local`: better-sqlite3, file path from an env var;
  - `azion`: Edge SQL database name and token from env vars.
- Scripts:
  - `pnpm db:migrate` runs against local;
  - `pnpm db:migrate:azion` runs against remote.
- No seed data is included; categories and UoMs are created through the API.

## 9. Testing

- **Unit tests:** domain rules and use cases, with in-memory fakes for the ports. These cover:
  - totals;
  - the status machine;
  - inventory deltas and clamping;
  - list-completion rules.
- **Integration tests:** HTTP routes against `buildApp()` wired to better-sqlite3 in-memory, with migrations applied per test file. These cover:
  - status codes;
  - problem+json bodies;
  - pagination;
  - FK restrict and soft delete;
  - atomicity (a failing item rolls back the whole purchase, the inventory and the list status).
- **Migration test:** apply all migrations to an empty DB, assert the expected tables and columns exist, and run the migrator a second time to confirm it is a no-op.
- **Coverage:** threshold of **80%** for lines, branches, functions and statements, enforced by Vitest config.

## 10. CI/CD (GitHub Actions)

The workflow lives at `.github/workflows/ci.yml`.

- **Triggers:**
  - `pull_request`: all branches;
  - `push`: `main`.
- **`check` job** (runs on PRs and on main):
  1. Checkout, set up pnpm and Node LTS, and install with `pnpm install --frozen-lockfile`.
  2. `pnpm lint` (Biome check).
  3. `pnpm typecheck` (`tsc --noEmit`).
  4. `pnpm db:validate`: apply all migrations to a clean SQLite database and run them again to confirm idempotency.
  5. `pnpm test:coverage` (Vitest; fails below 80%).
- **`deploy` job** (runs on push to `main` only, `needs: check`):
  1. Install dependencies.
  2. Run `pnpm db:migrate:azion`.
  3. Deploy with the Azion CLI.
  - Secrets: `AZION_TOKEN` and the Edge SQL database name, stored in GitHub Secrets.
  - The job uses a GitHub `production` environment.

## 11. Acceptance Criteria

1. The GitHub CI workflow runs lint, typecheck, migration validation and tests with ≥ 80% coverage on every PR, and deploys to Azion on merge to `main`.
2. The migrations implement the ERD in `docs/mermaid/mermaid-erd.md` for SQLite, and apply cleanly and idempotently to an empty database.
3. Every endpoint in §6 is implemented, with the status codes and error format described.
4. Registering a purchase has the following effects, all atomically:
   - totals are computed on the server;
   - inventory is upserted and incremented;
   - a linked `open` list is marked `completed`.
5. Updating or deleting a purchase adjusts inventory by the delta, clamped at 0.
6. The shopping-list status machine is enforced: invalid transitions and edits to final-state lists return 409.
7. Deletes behave as follows:
   - deleting a product sets `is_active = 0`;
   - deleting a referenced category, UoM, market or linked list returns 409.
8. The code follows the Ports and Adapters layout in §7. The domain and application layers have no Hono, Zod or SQLite imports.

## 12. Assumptions

- Currency is single and implicit, with no currency field.
- Quantities in purchases and shopping lists use the product's UoM, with no unit conversion.
- The ERD fields are kept as-is. Only `Product` has `updated_at`; other entities have no update timestamp in Phase 1.
- Timezone handling is the client's responsibility; the server stores and compares UTC ISO strings.

## 13. Future Phases (out of scope)

- **Phase 2:** a static UI in TS or VueJS served from the edge function.
- **Later phases** (from `.tmp/future-releases.md`):
  - Recurrency inference: estimate each product's purchase interval from its history and predict the next purchase.
  - Shopping list suggestions: based on low inventory (below minimum) or estimated recurrency.
  - Budget: planned, realized and remaining.
  - Product price history.
  - Observability and monitoring: OpenTelemetry, Prometheus, logs and tracing.
  - Alerts:
    - price alerts, via iFood or market integrations;
    - an alert when an item's inventory falls below its minimum.
  - NFC-e import, or integration with a government API.
  - Authentication.
