# Taskly App Node

Full-stack todo app used to demonstrate an agentic unit-test workflow. See `SOLUTION.md` for the design.

## Layout

- `backend/` — Node 22+, Express 5, Zod 4, Prisma 7 (PostgreSQL, engine-less `@prisma/adapter-pg`). Source in `src/`, tests in `tests/`, Vitest `node` environment.
- `frontend/` — React 19, TypeScript, Vite, TanStack Query 5, styled-components. Tests colocated as `*.test.tsx`, Vitest `jsdom`, Prettier enforced (no semicolons, single quotes).
- `.claude/agents/test-engineer.md` — the custom test agent; `.claude/skills/*` — its reusable skills.
- `.github/workflows/test-agent.yml` — runs the agent on pull requests; `.github/scripts/` — guard, verify and comment helpers.

## Commands

Run inside `backend/` or `frontend/` (both need Node >= 22.12; `nvm use 24` locally):

```sh
npm ci
npm run typecheck
npm test                 # vitest run
npm run test:coverage    # writes coverage/coverage-summary.json
```

Unit tests never need PostgreSQL or `.env`; repository tests spy on the Prisma delegate.

## Conventions that matter for tests

- Backend tests import sources with the `.ts` extension and use `backend/tests/fixture.ts`.
- Frontend component tests mock the design system: `vi.mock('<rel>/design-system', () => import('<rel>/design-system/mocks'))`.
- Hooks are mocked per module with `vi.mock(path, () => ({ hook: vi.fn() }))`.
- Never edit `backend/src/**` or non-test files under `frontend/src/**` when the task is "write tests".
