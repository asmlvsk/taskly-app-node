---
name: write-backend-tests
description: Conventions and templates for writing or updating Vitest unit tests for the Express + Prisma backend in backend/tests. Use when a test decision targets a file under backend/src.
---

# Write backend tests

Backend tests live in `backend/tests/*.test.ts`, run with Vitest in a `node` environment, and never touch PostgreSQL. Read one existing test (`backend/tests/router.test.ts` or `repository.test.ts`) before writing, and match its style exactly.

## House style

- Flat `it(...)` at module level; `describe` only when a file covers several units. Use `it.each([...])('… %s', …)` for input tables.
- Imports from source use the `.ts` extension: `import { createApp } from '../src/factory.ts'`.
- Shared fixtures come from `./fixture.ts` (`record` = Prisma row, `todo` = JSON shape). Extend the fixture with spread, do not duplicate it.
- Single quotes, semicolons, 2-space indent, compact one-line expectations. Test names describe behaviour ("rejects invalid id"), not implementation.
- `afterEach(() => vi.restoreAllMocks())` whenever `vi.spyOn` is used.
- Assert on observable results and on how the collaborator was called (`toHaveBeenCalledWith`), not on internals.
- Every test must run in isolation: no shared mutable state, no `process.env` leakage (restore it in `afterEach`), no real network or sockets.

## Patterns by module

**Routers (`router.ts`, `health.ts`)**: mount the router on a bare `express()` app with `express.json()` and drive it with `supertest`. The repository is a plain object of `vi.fn()` mocks typed as `TodoStore`. Cover: success status and body, 404 when the store returns `null`/`false`, 422 for invalid body and invalid `:id` (`0`, `-1`, `abc`) and that the store was **not** called on validation failure.

```ts
function setup() {
  const repository = { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() };
  const app = express();
  app.use(express.json());
  app.use('/api/todos', createTodosRouter(repository));
  return { app, repository };
}
```

**App factory (`factory.ts`)**: call `createApp(database)` with a `Pick<Database, 'todo'>`-shaped mock cast via `as unknown as Database`. Cover `/openapi.json`, `/docs` (302 or 200), the JSON 404 (`{ detail: 'Not Found' }`), malformed JSON → 422, oversized body → 413, and a thrown repository error → 500 with `console.error` spied and silenced.

**Repository (`repository.ts`)**: construct the real Prisma client with `createDatabase('postgresql://test:test@localhost:5432/test')` and `vi.spyOn(database.todo, 'findMany')`. No connection is opened. Assert the exact query arguments.

**Config (`config.ts`)**: snapshot `process.env` in `beforeEach`, set only the variables under test, restore in `afterEach`. Cover explicit `DATABASE_URL`, the `postgresql+psycopg:` rewrite, each missing variable error, and URL-encoding of special characters in user, password and database name.

**Lifespan (`lifespan.ts`)**: mock `../src/core/database.ts` with `vi.mock` (`createDatabase` returning `{ $connect, $disconnect, $executeRaw }` mocks) and `../src/factory.ts` (`createApp` returning an object whose `listen` resolves a fake server). Cover: connects, initializes, listens on `API_PORT`, disconnects and rethrows when connect fails. Do not bind a real port; if a real server is unavoidable, listen on port `0` and close it in `afterEach`.

**Validators / mappers**: pure functions, table-driven `it.each`, both accept and reject rows. Keep these two files at 100% coverage; `vitest.config.ts` enforces it.

## Do not

- Do not add new dependencies, change `vitest.config.ts`, or edit anything under `backend/src`.
- Do not write tests that need a database, `.env`, or network.
- Do not use `any` to silence types; use `as unknown as T` with the narrowest `T`.
- Do not assert on error message text from third-party libraries (Zod issue wording) beyond the status code and a stable field.

## After writing

Run the `verify-tests` skill for the backend before moving to the next file.
