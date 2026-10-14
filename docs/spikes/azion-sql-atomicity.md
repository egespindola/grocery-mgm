# Spike: Azion Edge SQL atomicity

**Card:** MYPRS-4 · **Blocks:** MYPRS-11 (Purchases) · **Spec:** §7.3

## Question

Does Azion Edge SQL run a multi-statement execution atomically? If not, how does the production
`Database` adapter guarantee that `batch(statements[])` is all-or-nothing?

## Findings from reading `azion/sql` (v3.1.5, `packages/sql/dist/index.mjs`)

`useQuery` / `useExecute` choose one of two paths:

| Path | When | How statements run | Atomic? |
|---|---|---|---|
| Runtime | inside an edge function (`globalThis.Azion.Sql` exists) | `Database.open(name)`, then `Promise.all(statements.map((s) => conn.query(s)))` | **No.** Statements are sent concurrently with no transaction and no ordering guarantee, so even `BEGIN`/`COMMIT` in the array is unreliable. |
| REST | outside the runtime, or `external: true` | one `POST /v4/workspace/sql/databases/{id}/query` with `{ statements }` | **Unknown.** Depends on the server; to be confirmed live (below). |

Other constraints of the package:

- The public API takes `string[]` only, so there are **no bound parameters**. Values would have to be
  escaped and inlined by hand.
- `useExecute` rejects arrays that contain no `INSERT`/`UPDATE`/`DELETE`, and needs `force: true`
  for DDL.
- The runtime path of `useExecute` maps results through `query` and returns no `changes` or
  `last_insert_rowid`.

## Decision

The production adapter (`src/shared/db/azion-sql.adapter.ts`) does **not** use `azion/sql`. It calls
the runtime API `globalThis.Azion.Sql.Database.open(name)` directly and:

- opens one connection per isolate and runs `PRAGMA foreign_keys = ON` on it;
- binds parameters through `conn.query(sql, params)` / `conn.execute(sql, params)`;
- serializes every operation on the shared connection, so concurrent requests cannot interleave
  with a transaction;
- implements `batch` as `BEGIN`, then each statement **in order**, then `COMMIT`, with `ROLLBACK` on
  the first failure;
- reads `changes()` and `last_insert_rowid()` on the same connection after `execute`.

`azion/sql` remains the client for the migration runner (MYPRS-5), which runs outside the edge
over REST.

This design is verified against a fake runtime backed by better-sqlite3
(`src/shared/db/database.contract.test.ts`). It relies on assumptions about the real runtime that
only a live run can confirm:

1. `conn.query` / `conn.execute` accept a positional `params` array.
2. Statements on one connection run sequentially and share one SQLite session, so
   `BEGIN … COMMIT/ROLLBACK`, `PRAGMA foreign_keys` and `changes()` apply across calls.
3. SQLite error messages (`UNIQUE constraint failed`, `FOREIGN KEY constraint failed`) reach the
   caller unchanged.

## Live verification

Use a **disposable** Edge SQL database. Both spikes create and drop their own `spike_*` tables.

### A. Runtime path (decides the adapter design)

`scripts/spikes/azion-sql-runtime-spike.ts` is an edge function that runs the real adapter through
every check above. Deploy it temporarily as a throwaway edge application with the Azion CLI, call
`GET /?db=<test database>`, and paste the JSON report below. Every check must report
`"pass": true`. Remove the deployment afterwards, because the endpoint writes to whichever database
it is given.

### B. REST path (informs the migration runner)

```sh
AZION_TOKEN=... AZION_DB_NAME=<test database> pnpm exec tsx scripts/spikes/azion-sql-rest-spike.ts
```

`atomic: true` means a failing statement rolled back the earlier ones in the same request.

## Results

> **Pending:** fill in after the live run, with date, runtime report (A) and REST report (B).
> Until then, assumptions 1–3 are unconfirmed and MYPRS-11 stays blocked.

### Attempt on stage (2026-10-01): inconclusive

Neither check could run, because of problems in the stage environment rather than in the spike:

- **Database never became ready.** A new Edge SQL database stayed in `creating` for hours. Every
  query returned `14003 Database Is Not Ready`.
- **Stage CLI could not deploy.** Azion CLI `4.24.0-dev.12` (stage build) validated the token
  against SSO, but every API call (`deploy`, `list application`) returned
  `401 Authentication Failed`. The same token worked against `stage-api.azion.com/v4` when called
  directly. Request IDs: `335ebd1ca3b0114c7e5dff6be80afe31`, `1be8d5eb97e2f0f7afafbfbeb268f0d1`.

The temporary resources were deleted. Next attempt: a production account with the public CLI
release and a disposable database.
