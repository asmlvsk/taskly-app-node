---
name: verify-tests
description: Run typecheck, formatting check, the test suite and coverage for the backend and/or frontend, compare with the baseline, and fix or remove failing generated tests. Use after writing or updating any test, and once more before reporting.
---

# Verify tests

Nothing is "done" until it has been executed. Verification is per package; run it for each package you touched, then once for both at the end.

## Commands (run from the repository root)

| Step | Backend | Frontend |
| --- | --- | --- |
| Type check | `cd backend && npm run typecheck` | `cd frontend && npm run typecheck` |
| Format | n/a | `cd frontend && npx prettier --check <changed test files>` |
| Single file | `cd backend && npx vitest run tests/<name>.test.ts` | `cd frontend && npx vitest run src/<path>/<Name>.test.tsx` |
| Full suite + coverage | `cd backend && npm run test:coverage` | `cd frontend && npm run test:coverage` |

Coverage summaries are written to `<package>/coverage/coverage-summary.json`. When a baseline exists at `.agent/baseline/<package>-coverage-summary.json` (the PR workflow creates it before you start), compare `total.lines.pct` and `total.branches.pct` with the new numbers and report both.

## Procedure

1. After each new or changed test file: run that single file. Fix failures immediately.
2. A failing test means one of two things. Decide which before touching anything:
   - **The test is wrong** (wrong selector, wrong mock shape, wrong expectation about behaviour you misread): fix the test.
   - **The code is wrong** (a genuine bug exposed by the diff): do **not** change source code. Keep the test only if you are certain the expectation is the documented behaviour; otherwise remove it and record the suspected bug in the report under `notes` so a human can decide.
3. Never weaken a pre-existing assertion to make it pass. If an existing test fails because of the PR's intentional behaviour change, update it to describe the new behaviour and say so in the report.
4. When the package compiles and the single files pass, run `npm run typecheck` and `npm run test:coverage` for the whole package. Backend coverage thresholds (100% for validators and mappers) must still hold.
5. Frontend: run `npx prettier --check` on every test file you touched; fix by editing until it passes.
6. If after two fix attempts a generated test still fails, delete that test case (not the whole file, unless it is empty) and report it as `skipped` with the failure reason. A red suite must never be left behind.
7. Record the final numbers for the report: files, tests passed/failed, coverage before and after.

## Red flags to check before finishing

- `act(...)` warnings or "not wrapped in act" output: fix with `await waitFor`/`findBy*`.
- Open handles or "worker exited" messages: a test opened a port, timer or connection and did not close it.
- Tests that pass only in a specific order or depend on `Date.now()` without `vi.setSystemTime`.
- Type errors in test files are failures; `tsc` includes `tests/**` on the backend and `src` on the frontend.
