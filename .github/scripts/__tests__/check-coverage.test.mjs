import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { compare } from '../check-coverage.mjs'
import { outputs, readJson, runScript, tempDir, write } from './helpers.mjs'

const after = (backend, frontend) => ({
  backend: { coverage: backend },
  frontend: { coverage: frontend },
})

test('passes when coverage stays equal or rises', () => {
  const result = compare(
    { backend: { lines: 90, branches: 80 }, frontend: { lines: 70, branches: 60 } },
    after({ lines: 90, branches: 81 }, { lines: 75, branches: 60 }),
    0.1,
  )
  assert.equal(result.ok, true)
  assert.deepEqual(result.packages.frontend.lines, { base: 70, after: 75, delta: 5, ok: true })
})

test('fails a package when lines or branches drop beyond the tolerance', () => {
  const result = compare(
    { backend: { lines: 97.24, branches: 97.91 }, frontend: { lines: 99.33, branches: 98.54 } },
    after({ lines: 95.53, branches: 97.91 }, { lines: 99.3, branches: 98.5 }),
    0.1,
  )
  assert.equal(result.ok, false)
  assert.equal(result.packages.backend.ok, false)
  assert.equal(result.packages.backend.lines.delta, -1.71)
  assert.equal(result.packages.frontend.ok, true, 'a 0.03-0.04 point drop is within the tolerance')
})

test('skips packages without a base or after measurement', () => {
  const result = compare({ backend: { lines: 50, branches: 50 } }, { backend: { coverage: null } }, 0.1)
  assert.equal(result.ok, true)
  assert.deepEqual(result.packages, { backend: { checked: false }, frontend: { checked: false } })
})

test('CLI reads the workflow files, writes the result and prints the step output', (t) => {
  const dir = tempDir(t)
  const summary = (lines, branches) => ({ total: { lines: { pct: lines }, branches: { pct: branches } } })
  write(dir, {
    '.agent/base/backend-coverage-summary.json': summary(90, 90),
    '.agent/base/frontend-coverage-summary.json': summary(80, 80),
    '.agent/after-verify.json': after({ lines: 85, branches: 90 }, { lines: 80, branches: 80 }),
  })
  const { code, stdout } = runScript(dir, 'check-coverage.mjs', [], { COVERAGE_TOLERANCE: '0.5' })
  assert.equal(code, 0)
  assert.equal(outputs(stdout).ok, 'false')
  assert.match(stdout, /backend: lines 90 -> 85 \(-5\).*DROPPED/)
  const written = readJson(join(dir, '.agent/coverage-check.json'))
  assert.equal(written.tolerance, 0.5)
  assert.equal(written.packages.frontend.ok, true)
})
