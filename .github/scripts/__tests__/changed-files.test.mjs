import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { commit, git, outputs, runScript, tempRepo, write } from './helpers.mjs'

const lines = (dir, file) => readFileSync(join(dir, '.agent', file), 'utf8').split('\n').filter(Boolean)

test('selects testable source files and lists deleted and renamed-away ones separately', (t) => {
  const dir = tempRepo(t, {
    'backend/src/features/todos/router.ts': 'a\n',
    'backend/src/features/todos/legacy.ts': 'a\n',
    'frontend/src/lib/old-name.ts': 'export const value = 1\nexport const other = 2\nexport const more = 3\n',
    'README.md': 'x\n',
  })
  const base = git(dir, 'rev-parse', 'HEAD')

  write(dir, {
    'backend/src/features/todos/router.ts': 'b\n',
    'backend/src/features/todos/service.ts': 'new\n',
    'frontend/src/components/Badge.tsx': 'new\n',
    // Excluded: types, barrels, generated code, tests, stories, design system, non-code.
    'backend/src/features/todos/types.ts': 'types\n',
    'frontend/src/features/todos/index.ts': 'barrel\n',
    'backend/src/generated/prisma/client.ts': 'gen\n',
    'frontend/src/components/Badge.test.tsx': 'test\n',
    'frontend/src/components/Badge.stories.tsx': 'story\n',
    'frontend/src/design-system/components/X.tsx': 'ds\n',
    'frontend/src/styles.css': 'css\n',
    'README.md': 'changed\n',
  })
  rmSync(join(dir, 'backend/src/features/todos/legacy.ts'))
  git(dir, 'mv', 'frontend/src/lib/old-name.ts', 'frontend/src/lib/new-name.ts')
  const head = commit(dir)

  const { code, stdout } = runScript(dir, 'changed-files.sh', [base, head])
  assert.equal(code, 0)
  assert.deepEqual(lines(dir, 'changed-files.txt').sort(), [
    'backend/src/features/todos/router.ts',
    'backend/src/features/todos/service.ts',
    'frontend/src/components/Badge.tsx',
    'frontend/src/lib/new-name.ts',
  ])
  assert.deepEqual(lines(dir, 'deleted-files.txt').sort(), ['backend/src/features/todos/legacy.ts', 'frontend/src/lib/old-name.ts'])
  assert.deepEqual(outputs(stdout), { count: '6', changed: '4', deleted: '2' })
})

test('reports zero when only non-source files changed', (t) => {
  const dir = tempRepo(t, { 'README.md': 'a\n', 'backend/src/a.ts': 'a\n' })
  const base = git(dir, 'rev-parse', 'HEAD')
  write(dir, { 'README.md': 'b\n', 'SOLUTION.md': 'new\n' })
  const head = commit(dir)
  const { stdout } = runScript(dir, 'changed-files.sh', [base, head])
  assert.deepEqual(outputs(stdout), { count: '0', changed: '0', deleted: '0' })
  assert.deepEqual(lines(dir, 'changed-files.txt'), [])
})
