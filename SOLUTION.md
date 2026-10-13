# Solution: unit-test agent and PR workflow

This repository extends the Taskly App Node sample with a **custom test-writing agent**, five **reusable skills**, and a **GitHub Actions workflow** that runs the agent on every pull request, verifies what it produced, commits the verified tests to the PR branch and reports back in the PR.

Agent environment: **Claude Code** (CLI, headless `claude -p`), chosen because its agent and skill formats are plain Markdown files kept in the repository, it runs the same way locally and in CI, and its permission system can restrict an agent to specific paths and commands.

## 1. Main technical decisions

| Decision | Rationale |
| --- | --- |
| **Agent and skills live in the repo** (`.claude/agents`, `.claude/skills`) | Reviewable, versioned with the code they test, and identical locally and in CI. Interactively, Claude Code loads the skills on demand (or via `/skill-name`) and the agent's `skills:` frontmatter preloads them for subagent use. |
| **Skills are injected explicitly in headless runs** | `claude -p --agent` runs the agent as the main thread; in that mode (verified on 2.1.296) neither the `skills:` preload nor `--json-schema` is applied. `run-agent.sh` therefore appends the five `SKILL.md` bodies and the report schema to the system prompt with `--append-system-prompt-file`, so the run never depends on auto-loading, and `extract-report.mjs` normalizes the JSON it gets back. This was found by an agent run that reported "I could not see the skill files"; see run 4. |
| **Skills encode the project's own testing conventions**, learned from the existing tests | The sample already had a clear style (supertest routers, Prisma delegate spies, mocked design system, mocked hooks). Codifying it makes generated tests look like the hand-written ones instead of generic boilerplate. |
| **Five skills, one per phase**: analyze → write (backend / frontend) → verify → report | Each skill is small, testable in isolation, and reusable outside this workflow (for example, `/write-frontend-tests` in an interactive session). The agent's system prompt only orders them. |
| **The agent decides, the workflow enforces** | The agent is asked to touch only test files, but the workflow does not trust that: a guard step reverts any change outside an allow list, verification runs in plain shell after the agent, and only a green suite is committed. |
| **Headless CLI instead of the hosted GitHub app** | The CLI gives explicit control over the model, tool allow list, turn and dollar budgets, structured JSON output (`--json-schema`), and runs with a single secret. No GitHub App installation is needed. |
| **Structured report, rendered by a script** | The agent returns a JSON report validated against `.github/agent/report.schema.json`; `render-comment.mjs` turns it, plus the workflow's own verification numbers, into one sticky PR comment and the job summary. The numbers a reviewer sees come from the workflow, not from the agent's self-report. |
| **`pull_request`, never `pull_request_target`** | PR code is executed (npm scripts, tests), so it must never run with a privileged token or with secrets from a fork. Fork PRs and drafts are skipped entirely. |
| **Commits via `GITHUB_TOKEN`** | Such pushes do not trigger new workflow runs, which rules out agent → push → agent loops by construction. A `[test-agent]` marker in the commit message is a second guard. An independent `CI` run is then dispatched explicitly with `gh workflow run`. |
| **Unit tests never need PostgreSQL** | Kept from the sample: repository tests spy on the real Prisma delegate without connecting. This keeps the workflow to `npm ci` + `vitest`, with no services and no secrets other than the API key. |

## 2. Running the PR workflow

### Prerequisites

1. A GitHub repository with Actions enabled and the default `GITHUB_TOKEN` allowed to **write** (Settings → Actions → General → Workflow permissions: "Read and write"). The workflow also declares `permissions:` explicitly.
2. Repository secret **`ANTHROPIC_API_KEY`** (Anthropic Console key). It is the only secret the workflow uses.
3. Optional repository variables: `TEST_AGENT_MODEL` (default `claude-sonnet-5-5`), `TEST_AGENT_MAX_TURNS` (default `120`), `TEST_AGENT_MAX_BUDGET_USD` (default `5`).

### What happens on a pull request

`.github/workflows/test-agent.yml` runs on `opened`, `synchronize`, `reopened` and `ready_for_review` for PRs whose head branch is in this repository and that are not drafts:

1. **Loop guard**: skip if the head commit was made by this workflow.
2. **Collect changed files** (`changed-files.sh`): source files under `backend/src` and `frontend/src`, minus types, barrels, generated code, stories, tests and config. No files → a short "nothing to test" comment and exit.
3. **Baseline** (`verify.sh baseline`): typecheck + Vitest with coverage for both packages, saved to `.agent/baseline/`. The agent is told whether the suite was already red.
4. **Agent** (`run-agent.sh`): `claude -p --agent test-engineer` with `--permission-mode dontAsk`, an explicit `--allowedTools` list (read tools, `Edit` on test paths only, the exact `npm`/`vitest`/`prettier --check`/`git diff` commands the skills use), `--max-turns`, `--max-budget-usd`, and `--json-schema` for the report. The prompt contains only commit SHAs and the file list, never the PR title or body.
5. **Guard** (`guard-paths.sh`): any change outside `backend/tests/**`, `frontend/src/**/*.test.ts(x)`, `frontend/src/test/**`, `frontend/src/design-system/mocks.tsx` is reverted and listed in the report. Deleting a tracked file is never allowed.
6. **Format** generated frontend tests with Prettier (the CI job enforces `format:check`).
7. **Verify** (`verify.sh after`): the same typecheck + Vitest + coverage as the baseline, run by the workflow.
8. **Commit and push** only if the guard kept at least one file and verification is green; then dispatch `ci.yml` on the branch for an independent check.
9. **Report**: one sticky comment (`<!-- taskly-test-agent -->`) with status, decision table, verification table with coverage deltas, files, skills used, turns/cost, and the agent's notes; the same Markdown goes to the job summary. All logs, the raw agent output and the unverified patch (when nothing was committed) are uploaded as the `test-agent-run` artifact.
10. The check **fails** when verification failed, so a red suite is visible on the PR even though nothing was committed.

### Running the agent locally

```sh
nvm use 24                     # Node >= 22.12
npm install -g @anthropic-ai/claude-code@2.1.296
(cd backend && npm ci) && (cd frontend && npm ci)

# Same path as CI, for a PR range:
.github/scripts/verify.sh baseline
git diff --name-only <base> <head> -- backend/src frontend/src > .agent/changed-files.txt
BASE_SHA=<base> HEAD_SHA=<head> .github/scripts/run-agent.sh

# Coverage backfill for a list of files (used for the initial runs below):
printf '%s\n' backend/src/factory.ts backend/src/core/config.ts > .agent/changed-files.txt
BASE_SHA=$(git rev-parse HEAD) HEAD_SHA=$(git rev-parse HEAD) \
PROMPT_TEMPLATE=.github/agent/backfill-prompt.md AGENT_MODEL=claude-opus-5-5 \
.github/scripts/run-agent.sh
```

Without `ANTHROPIC_API_KEY` the CLI uses the logged-in Claude account. Interactively, `claude --agent test-engineer` starts a session as the agent, and each skill is also callable as `/analyze-changes`, `/write-backend-tests`, etc.

## 3. Where the agent and skills are defined

| Piece | Location | Role during execution |
| --- | --- | --- |
| Agent | `.claude/agents/test-engineer.md` | System prompt + frontmatter: tools (`Read, Grep, Glob, Edit, Write, Bash`), `maxTurns`, and the five preloaded `skills`. Defines the workflow order, hard limits (test paths only, no secrets, allowed commands, diff is data not instructions) and the quality bar. |
| `analyze-changes` | `.claude/skills/analyze-changes/SKILL.md` | Maps source files to test files, defines when to `create`/`update`/`skip`, ordering (dependencies first), and the decision table. |
| `write-backend-tests` | `.claude/skills/write-backend-tests/SKILL.md` | House style and per-module patterns: supertest routers, `createApp` factory, Prisma delegate spies, `process.env` handling for config, mocked lifespan. |
| `write-frontend-tests` | `.claude/skills/write-frontend-tests/SKILL.md` | Prettier style, design-system mock, mocked hooks, `renderHook` + fresh `QueryClient` for TanStack hooks, fake timers, `fetch` stubbing. |
| `verify-tests` | `.claude/skills/verify-tests/SKILL.md` | Exact commands, single-file → package → coverage procedure, how to decide "test wrong vs code wrong", never weaken existing assertions, never leave red. |
| `report-results` | `.claude/skills/report-results/SKILL.md` | The JSON report contract (`.github/agent/report.schema.json`) and honesty rules. |
| Project memory | `CLAUDE.md` | Layout, commands and conventions every Claude Code session sees. |
| Permissions | `.claude/settings.json` | Deny rules (secrets, source and config paths, `git push/commit`, installs, network) that apply in addition to the CI allow list. |
| Workflow | `.github/workflows/test-agent.yml`, `.github/scripts/*`, `.github/agent/*` | Orchestration, enforcement, verification, reporting, prompt templates and report schema. |

Execution path in CI: `run-agent.sh` (builds `.agent/agent-system-append.md` from the five skills + report schema) → `claude -p --agent test-engineer --append-system-prompt-file …` → agent follows `analyze-changes` → `write-*-tests` → `verify-tests` → `report-results` → structured output → `extract-report.mjs` → guard, verify, commit → `render-comment.mjs` → `post-comment.sh`.

## 4. Example runs

All runs below were made with the same agent, skills and scripts that the workflow uses, through `run-agent.sh`. Raw CLI output, prompts and reports are kept in the `test-agent-run` artifact in CI; for the local runs the reports are reproduced here.

### Run 1: backend coverage backfill (local, `backfill-prompt.md`)

Scope: `factory.ts`, `api/health.ts`, `core/config.ts`, `core/database.ts`, `core/lifespan.ts`, `features/todos/router.ts`. Model `claude-opus-5-5`, 39 turns, 118 s, $0.64, 1 denied tool call (the agent tried `python3` to read a coverage summary; the allow list refused it and the agent used the Read tool instead).

Agent decisions (from the structured report):

| Source file | Action | Test file | Reason (abridged) |
| --- | --- | --- | --- |
| `core/config.ts` | create | `tests/config.test.ts` | 0% covered: override, `DATABASE_URL`, `postgresql+psycopg` rewrite, missing-variable and URL-encoding branches |
| `core/database.ts` | create | `tests/database.test.ts` | `initialize()` never run; `createDatabase` already exercised by repository tests |
| `api/health.ts` | create | `tests/health.test.ts` | no test; must not report ok when the database probe fails |
| `features/todos/router.ts` | update | `tests/router.test.ts` | only list/create covered (17% branches); added GET/PATCH/DELETE by id, 404s, invalid id and patch → 422 with the store not called |
| `factory.ts` | create | `tests/factory.test.ts` | 0%: router mounting, `/openapi.json`, `/docs`, JSON 404, malformed JSON → 422, oversized body → 413, generic 500 with `console.error` silenced |
| `core/lifespan.ts` | create | `tests/lifespan.test.ts` | 0%: connect/initialize/listen, default port, disconnect + rethrow on failures, SIGTERM/SIGINT shutdown, forced exit after 10 s; no real port or signal handlers |

Skills used: `analyze-changes`, `write-backend-tests`, `verify-tests`, `report-results`.

Independent verification by `verify.sh after` (what the workflow would commit on):

| Package | Typecheck | Tests | Lines | Branches |
| --- | --- | --- | --- | --- |
| backend | ✅ | 89 passed, 0 failed | 33.0% → **97.2%** | 33.3% → **97.9%** |
| frontend | ✅ | 18 passed (untouched) | 47.7% | 43.8% |

Notes the agent reported: one remaining uncovered branch (`factory.ts`, error after headers were sent) deliberately left because it would need a contrived route; `main.ts` out of scope by rule; `config.ts` tests snapshot and restore `process.env` so a local `.env` can never influence them; existing assertions untouched; no embedded instructions found. Guard: 0 violations. Committed as `test(backend): … [test-agent]`.

Two earlier attempts of this same run are worth recording because they show the fail-safe behaviour:
- Attempt 1 failed before the agent started: the report schema used JSON Schema 2020-12 keywords the CLI validator rejects. The pipeline still produced a report ("the agent did not return a structured report") and would have posted it.
- Attempt 2 ran, but every `cd backend && npm …` command was denied (Claude Code checks compound commands per segment, and the headless shell keeps its working directory between calls). The agent wrote one test file, **could not run it, reverted it on its own, and reported honestly**: "No tests were added … I reverted my one unverified edit". The allow list and skills were then changed to `npm --prefix <pkg> run …` forms.

### Run 2: frontend backfill, part A (local, `backfill-prompt.md`)

Scope: `lib/http.ts`, `utils/todos.ts`, `hooks/useNotice.ts`, `app/AppProviders.tsx`, `api/todos.ts` and the six todo hooks. Model `claude-opus-5-5`, 57 turns, 198 s, $0.95, 1 denied tool call (a `cd … && cat` loop; the agent switched to the Read tool).

Decisions: 7 `create` (`http`, `AppProviders`, `useTodosQuery`, `useTodosBusy`, `useTodoFilters`, `useCreateTodoMutation`, `useUpdateTodoMutation`, `useDeleteTodoMutation`) and 3 `update` (`utils/todos`, `useNotice`, `api/todos`, each keeping the original cases and adding the uncovered branches). The agent also added one shared helper, `src/test/queryWrapper.tsx` (fresh `QueryClient` per test, retries off), which the `write-frontend-tests` skill allows under `src/test/**`.

Skills used: `analyze-changes`, `write-frontend-tests`, `verify-tests`, `report-results`.

| Package | Typecheck | Tests | Lines | Branches |
| --- | --- | --- | --- | --- |
| frontend | ✅ | 65 passed, 0 failed | 47.7% → **82.8%** | 43.8% → **72.3%** |
| backend | ✅ | 89 passed (untouched) | 97.2% | 97.9% |

Notes the agent reported: Prettier fails on the pre-existing `ApplicationHeader.test.tsx`, which it deliberately did not touch (fixed afterwards by hand in a separate `chore` commit, together with `index.html`); no source bugs found; no existing expectations weakened; remaining gaps listed for a follow-up run. Guard: 0 violations; Prettier check on all generated files: clean.

### Run 3: frontend backfill, part B (local, `backfill-prompt.md`)

Scope: `TodosPage.tsx` and the six components (`DeleteTodoDialog`, `TodoEditor`, `TodoEmptyState`, `TodoForm`, `TodoItem`, `TodoList`). Model `claude-opus-5-5`, 56 turns, 253 s, $1.27, 2 denied tool calls (`python3`, and a `… | grep | tail` pipeline whose extra segments are not on the allow list; the agent re-ran the plain command).

Decisions: 1 `create` (`TodoEmptyState`) and 6 `update`. In three existing files (`TodoList`, `TodoEditor`, `TodosPage` tests) the agent changed only the child-component mocks so they can trigger callbacks, and reported that explicitly; existing assertions are unchanged.

| Package | Typecheck | Tests | Lines | Branches |
| --- | --- | --- | --- | --- |
| frontend | ✅ | 95 passed, 0 failed | 82.8% → **99.3%** | 72.3% → **98.5%** |
| backend | ✅ | 89 passed (untouched) | 97.2% | 97.9% |

Notes worth keeping from the report: two remaining uncovered lines are unreachable through the UI (a double guard in `DeleteTodoDialog`) or covered elsewhere (the header's create button, tested through `TodoList`); and a **skill correction**: the `write-frontend-tests` skill claimed `Drawer` was not mocked while `mocks.tsx` does mock it. The skill was fixed after this run. That is the intended feedback loop: the agent reports, a human curates the skills.

### Overall effect of runs 1–3

| Package | Tests before | Tests after | Lines before | Lines after | Branches before | Branches after |
| --- | --- | --- | --- | --- | --- | --- |
| backend | 48 | 89 | 33.0% | 97.2% | 33.3% | 97.9% |
| frontend | 18 | 95 | 47.7% | 99.3% | 43.8% | 98.5% |

Total agent cost for the backfill: about $2.90 and 10 minutes of wall time. No application source file was modified by the agent in any run.

### Run 4: the PR workflow on the demo feature branch (`prompt.md`, CI defaults)

Branch `feat/clear-completed` adds a "clear all completed tasks" feature across the stack (`DELETE /api/todos/completed`, `TodoRepository.deleteCompleted`, `todosApi.clearCompleted`, `useClearCompletedMutation`, a button in `TodosHeader`, wiring in `TodosPage`) and deliberately ships without behaviour tests. The workflow steps were executed with the same scripts the GitHub job runs, in order: `changed-files.sh` (6 source files selected; `types.ts`, `queryKeys.ts`, `openapi.json` and the PR's own test adjustments filtered out) → `verify.sh baseline` (green, but coverage dropped to 95.5% / 92.2% because of the untested code) → `run-agent.sh` with the CI defaults (`claude-sonnet-5-5`, 120 turns, $5 cap) → `guard-paths.sh` → Prettier → `verify.sh after` → commit → `render-comment.mjs`.

Agent run: 22 turns, 67 s, $0.28, 1 denied tool call (the agent tried to rewrite a test with a `python3` heredoc; denied, it used the Edit tool instead). Six decisions (5 `update`, 1 `create`), all six files verified, committed as `test: add and update unit tests for PR feat/clear-completed [test-agent]`.

The comment the workflow posts on the pull request, exactly as rendered by `render-comment.mjs`:

<details>
<summary>Rendered PR comment</summary>

#### 🧪 Test agent report

**✅ Tests generated, verified and committed**

Added tests for the new 'clear completed tasks' feature on the backend and frontend. Both full suites pass: backend 91 tests, frontend 105. Typecheck and Prettier checks are clean.

Committed as [`3bfc877`](https://github.com/asmlvsk/taskly-app-node/commit/3bfc877ce1238b3592c370e4f79992f073f1a63f).

##### Decisions

| Source file | Action | Test file | Reason |
| --- | --- | --- | --- |
| `backend/src/features/todos/repository.ts` | update | `backend/tests/repository.test.ts` | New deleteCompleted() needs a test for its deleteMany filter and returned count. |
| `backend/src/features/todos/router.ts` | update | `backend/tests/router.test.ts` | New DELETE /completed route needs a test for its 200 {deleted} response and that 'completed' is not parsed as an id. |
| `frontend/src/features/todos/TodosPage.tsx` | update | `frontend/src/features/todos/TodosPage.test.tsx` | New clear flow with singular/plural notices, no-op guards (nothing completed, busy) and error alert. The mocked header and mockPage were extended. |
| `frontend/src/features/todos/api/todos.ts` | update | `frontend/src/features/todos/api/todos.test.ts` | New clearCompleted endpoint call needs a test. |
| `frontend/src/features/todos/components/TodosHeader.tsx` | update | `frontend/src/features/todos/components/TodosHeader.test.tsx` | Clear button is shown only when completedCount > 0, and is blocked when disabled. |
| `frontend/src/features/todos/hooks/useClearCompletedMutation.ts` | create | `frontend/src/features/todos/hooks/useClearCompletedMutation.test.ts` | New hook with cache filtering on success; needs tests for the empty cache and failure cases. |

##### Verification (run by the workflow, not by the agent)

| Package | Typecheck | Tests | Passed | Failed | Lines | Branches |
| --- | --- | --- | --- | --- | --- | --- |
| backend | ✅ | ✅ | 91 | 0 | 97.3% (+1.8) | 97.9% (±0) |
| frontend | ✅ | ✅ | 105 | 0 | 99.4% (+7.2) | 98.6% (+4.8) |

##### Files

- `backend/tests/repository.test.ts`
- `backend/tests/router.test.ts`
- `frontend/src/features/todos/TodosPage.test.tsx`
- `frontend/src/features/todos/api/todos.test.ts`
- `frontend/src/features/todos/components/TodosHeader.test.tsx`
- `frontend/src/features/todos/hooks/useClearCompletedMutation.test.ts`

**Skills used:** `analyze-changes`, `write-backend-tests`, `write-frontend-tests`, `verify-tests`, `report-results`  
**Agent run:** 22 turns, 67s, $0.28, 1 denied tool call(s) (success)

##### Notes from the agent

- The PR's own edit to TodosPage.test.tsx only mocked useClearCompletedMutation in one test. I extended the shared mockPage helper so the other tests also get a return value for the hook. I also changed the TodosHeader mock so it exposes the clear button, which let me test the page's clear() logic.
- No instructions aimed at the agent were found in the diff.

<sub>Agent: `.claude/agents/test-engineer.md` · Skills: `.claude/skills/*` · Workflow: `.github/workflows/test-agent.yml` · [Run](https://github.com/asmlvsk/taskly-app-node/actions)</sub>

</details>

An earlier attempt of this run (before the skill-injection fix) produced equally green tests but reported "I could not see the skill files" and returned the report with different key names; that attempt is what led to the explicit `--append-system-prompt-file` injection and the key normalization in `extract-report.mjs`. The live run of this workflow on GitHub is attached to the pull request of the `feat/clear-completed` branch in this repository.


## 5. Assumptions

- Pull requests come from branches of this repository (the normal flow for a team). Fork PRs are deliberately not served.
- A single `ANTHROPIC_API_KEY` secret is acceptable for the automation; billing limits are enforced per run with `--max-budget-usd` and `--max-turns`.
- Unit tests must not need infrastructure; the sample's conventions (mocked Prisma delegate, mocked `fetch`) make that possible and the skills keep it so.
- Committing tests directly to the PR branch is wanted. The author keeps full control: the commit is separate, visibly made by `github-actions[bot]`, and can be reverted.
- The design system (`frontend/src/design-system/**`) stays covered by Storybook and excluded from unit coverage, as in the base repository.

## 6. Limitations

- **Prompt injection surface.** The agent reads the diff, which is untrusted. Mitigations: the PR title/body are never passed, the agent is told to treat all content as data, tools are allow-listed, paths are guarded, and nothing the agent does can push or change settings. A hostile diff could still waste the budget or produce poor tests; it cannot escape the test paths or exfiltrate secrets (no network tools, `.env` reads denied, the key is only in the `claude` process environment).
- **Verification is the suite itself**, not a review of test quality. A trivial but green test would be committed. Coverage deltas in the comment make that visible; a human still reviews the commit.
- **No retry across runs.** If the agent exceeds the turn or dollar budget, the run reports it and stops; the next push starts over.
- **Generated commits do not trigger `pull_request` workflows**, by GitHub design when using `GITHUB_TOKEN`. The workflow dispatches `ci.yml` explicitly to get an independent check, but third-party checks that listen to `pull_request` will not re-run for that commit.
- **One agent run per PR event** with `cancel-in-progress`; quick successive pushes cancel earlier runs.
- **Runtime and cost** scale with the diff; large refactors should be split, or the budgets raised through repository variables.

## 7. For a production version

- Run the agent as a **GitHub App** with a short-lived installation token instead of `GITHUB_TOKEN`, so its commits trigger normal PR checks, and sign the commits.
- Add a **review agent** (or a second pass of the same agent in review mode) that scores the generated tests for meaningfulness (mutation testing with Stryker, assertion density) before they are committed; fail below a threshold.
- Gate the run on a **label or path filter** and support `@test-agent` comment triggers for re-runs, plus a "do not touch" marker for files the team wants to test by hand.
- Store baselines per base branch and enforce **coverage ratchets** (no decrease per package) as a required check.
- Use **OIDC** to a cloud provider (Bedrock/Vertex) instead of a static API key, and rotate it; pin the Claude Code version and actions by SHA with Dependabot updates.
- Add **E2E tests** (Playwright against `docker compose`) as a separate, non-agent job; the agent would stay scoped to unit tests.
- Track **telemetry**: decisions per PR, acceptance rate of generated tests (kept vs removed by humans), cost per PR, to tune the skills.
