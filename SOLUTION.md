# Solution: unit-test agent and PR workflow

This repository extends the Taskly App Node sample with a **custom test-writing agent**, five **reusable skills**, and a **GitHub Actions workflow** that runs the agent on every pull request, verifies what it produced, commits the verified tests to the PR branch and reports back in the PR.

Agent environment: **Claude Code** (CLI, headless `claude -p`), chosen because its agent and skill formats are plain Markdown files kept in the repository, it runs the same way locally and in CI, and its permission system can restrict an agent to specific paths and commands.

## 1. Main technical decisions

| Decision | Rationale |
| --- | --- |
| **Agent and skills live in the repo** (`.claude/agents`, `.claude/skills`) | Reviewable, versioned with the code they test, and identical locally and in CI. The agent preloads the skills via its `skills:` frontmatter, so every run uses the same conventions. |
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

Execution path in CI: `run-agent.sh` → `claude -p --agent test-engineer` (skills injected at start) → agent follows `analyze-changes` → `write-*-tests` → `verify-tests` → `report-results` → structured output → `extract-report.mjs` → guard, verify, commit → `render-comment.mjs` → `post-comment.sh`.

## 4. Example runs

<!-- EXAMPLE_RUNS -->

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
