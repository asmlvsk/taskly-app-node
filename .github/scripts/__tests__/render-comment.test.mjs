import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runScript, tempDir, write } from './helpers.mjs'

const green = (lines) => ({
  backend: { typecheck: true, tests: true, passed: 91, failed: 0, coverage: { lines, branches: 97.9 } },
  frontend: { typecheck: true, tests: true, passed: 105, failed: 0, coverage: { lines: 99.4, branches: 98.6 } },
})
const report = {
  summary: 'Added tests for the clear-completed feature.',
  decisions: [
    { path: 'backend/src/features/todos/router.ts', action: 'update', testFile: 'backend/tests/router.test.ts', reason: 'new | route' },
    { path: 'backend/src/old.ts', action: 'delete', testFile: 'backend/tests/old.test.ts', reason: 'module removed' },
  ],
  skillsUsed: ['analyze-changes', 'verify-tests'],
  filesChanged: [],
  results: {},
  notes: ['Line one\nline two'],
  meta: { numTurns: 22, durationMs: 66592, costUsd: 0.2837, permissionDenials: 1 },
}

function render(t, files, env = {}, args = []) {
  const dir = tempDir(t)
  write(dir, files)
  const { code, stdout } = runScript(dir, 'render-comment.mjs', args, {
    GITHUB_REPOSITORY: 'owner/repo',
    GITHUB_SERVER_URL: 'https://github.com',
    RUN_URL: 'https://github.com/owner/repo/actions/runs/1',
    ...env,
  })
  assert.equal(code, 0)
  assert.ok(stdout.startsWith('<!-- taskly-test-agent -->'), 'the sticky-comment marker must come first')
  return stdout
}

test('renders a committed run with decisions, verification, ratchet, files and metadata', (t) => {
  const out = render(
    t,
    {
      '.agent/report.json': report,
      '.agent/baseline-verify.json': green(95.53),
      '.agent/after-verify.json': green(97.32),
      '.agent/guard.json': { violations: [], kept: ['backend/tests/router.test.ts', 'backend/tests/old.test.ts'], deleted: ['backend/tests/old.test.ts'] },
      '.agent/coverage-check.json': {
        tolerance: 0.1,
        ok: true,
        packages: {
          backend: { checked: true, ok: true, lines: { base: 97.24, after: 97.32 }, branches: { base: 97.91, after: 97.91 } },
          frontend: { checked: false },
        },
      },
    },
    { COMMIT_SHA: '3bfc877ce1238b3592c370e4f79992f073f1a63f', AGENT_OUTCOME: 'success' },
  )
  assert.match(out, /\*\*✅ Tests generated, verified and committed\*\*/)
  assert.match(out, /Committed as \[`3bfc877`\]\(https:\/\/github\.com\/owner\/repo\/commit\/3bfc877ce1238b3592c370e4f79992f073f1a63f\)/)
  assert.match(out, /\| `backend\/src\/features\/todos\/router\.ts` \| update \| `backend\/tests\/router\.test\.ts` \| new \\\| route \|/)
  assert.match(out, /\| backend \| ✅ \| ✅ \| 91 \| 0 \| 97\.3% \(\+1\.8\) \| 97\.9% \(±0\) \|/)
  assert.match(out, /Coverage vs base branch \(ratchet, tolerance 0\.1 pts\)/)
  assert.match(out, /\| backend \| 97\.2% → 97\.3% \(\+0\.1\) \| 97\.9% → 97\.9% \(±0\) \| ✅ \|/)
  assert.doesNotMatch(out, /\| frontend \| .* → /, 'unchecked packages are not listed in the ratchet table')
  assert.match(out, /- `backend\/tests\/old\.test\.ts` \(deleted: stale test\)/)
  assert.match(out, /\*\*Agent run:\*\* 22 turns, 67s, \$0\.28, 1 denied tool call\(s\) \(success\)/)
  assert.match(out, /- Line one line two/)
})

test('reports a red verification and a failed ratchet without claiming success', (t) => {
  const red = green(97)
  red.frontend.tests = false
  red.frontend.failed = 2
  const out = render(t, {
    '.agent/report.json': report,
    '.agent/after-verify.json': red,
    '.agent/guard.json': { violations: ['backend/src/main.ts'], kept: [] },
  })
  assert.match(out, /\*\*❌ Verification failed; nothing was committed\*\*/)
  assert.match(out, /\| frontend \| ✅ \| ❌ \| 105 \| 2 \|/)
  assert.match(out, /Reverted changes outside the test allow list:\n> - `backend\/src\/main\.ts`/)

  const dropped = render(t, {
    '.agent/after-verify.json': green(90),
    '.agent/guard.json': { violations: [], kept: ['backend/tests/a.test.ts'] },
    '.agent/coverage-check.json': {
      tolerance: 0.1,
      ok: false,
      packages: { backend: { checked: true, ok: false, lines: { base: 97, after: 90 }, branches: { base: 97, after: 97 } } },
    },
  })
  assert.match(dropped, /\*\*❌ Tests are green, but coverage is below the base branch\*\*/)
  assert.match(dropped, /❌ dropped/)
})

test('distinguishes "no changes needed" from "verification did not run"', (t) => {
  const none = render(t, { '.agent/after-verify.json': green(97), '.agent/guard.json': { violations: [], kept: [] } })
  assert.match(none, /\*\*ℹ️ No test changes were needed\*\*/)
  assert.match(none, /_The agent did not report any decisions\._/)
  assert.match(none, /_No test files were changed\._/)

  const missing = render(t, {})
  assert.match(missing, /\*\*⚠️ Verification did not run\*\*/)
})

test('names an agent failure as the cause instead of blaming coverage', (t) => {
  // The CLI returned an error (bad key, no credits) after one turn: nothing was written,
  // so verification is green and the ratchet drops, but the headline must be the failure.
  const failed = {
    summary: 'The agent did not return a structured report.',
    decisions: [],
    skillsUsed: [],
    filesChanged: [],
    results: { backend: { ran: false }, frontend: { ran: false } },
    notes: ['Agent error: Invalid API key · Please run /login'],
    meta: { subtype: 'success', isError: true, numTurns: 1, durationMs: 284, costUsd: 0, permissionDenials: 0, errorMessage: 'Invalid API key · Please run /login' },
  }
  const out = render(
    t,
    {
      '.agent/report.json': failed,
      '.agent/after-verify.json': green(95.5),
      '.agent/guard.json': { violations: [], kept: [] },
      '.agent/coverage-check.json': {
        tolerance: 0.1,
        ok: false,
        packages: { backend: { checked: true, ok: false, lines: { base: 97.2, after: 95.5 }, branches: { base: 97.9, after: 97.9 } } },
      },
    },
    { AGENT_OUTCOME: 'failure' },
  )
  assert.match(out, /\*\*❌ The agent run failed before it could write any test\*\*/)
  assert.match(out, /- Agent error: Invalid API key · Please run \/login/)
  assert.match(out, /\*\*Agent run:\*\* 1 turns, 0s, \$0\.00 \(failure\)/)
  assert.match(out, /❌ dropped/, 'the ratchet table is still shown')
})

test('warns when the suite was already red before the agent ran', (t) => {
  const before = green(97)
  before.backend.tests = false
  const out = render(t, { '.agent/baseline-verify.json': before, '.agent/after-verify.json': green(97) })
  assert.match(out, /The suite was already failing before the agent ran \(backend\)/)
})

test('renders the short "nothing to test" comment', (t) => {
  const out = render(t, {}, {}, ['--nothing-to-test'])
  assert.match(out, /No source files under `backend\/src` or `frontend\/src` changed/)
  assert.match(out, /\[Workflow run\]\(https:\/\/github\.com\/owner\/repo\/actions\/runs\/1\)/)
})
