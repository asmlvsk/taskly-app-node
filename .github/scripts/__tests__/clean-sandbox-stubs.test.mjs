import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { runScript, tempRepo, write } from './helpers.mjs'

const EXCLUDE_HEAD = '# git ls-files --others --exclude-from=.git/info/exclude\n# *~\n'

test('removes empty stubs and the exclude block, but keeps real and tracked files', (t) => {
  const dir = tempRepo(t, { 'tracked-empty.txt': '', 'src/a.ts': 'a\n' })
  write(dir, {
    'package.json': '{ "private": true }\n', // real file that happens to be on the list
    '.npmrc': '',
    '.env': '',
    'bunfig.toml': '',
  })
  writeFileSync(
    join(dir, '.git/info/exclude'),
    EXCLUDE_HEAD + '\n# claude-code scrub-mode stubs\n/package.json\n/.npmrc\n/.env\n/bunfig.toml\n/tracked-empty.txt\n/missing.lock\n',
  )

  const { code, stdout } = runScript(dir, 'clean-sandbox-stubs.sh')
  assert.equal(code, 0)
  assert.match(stdout, /Removed 3 sandbox stub file\(s\)/)
  assert.equal(existsSync(join(dir, '.npmrc')), false)
  assert.equal(existsSync(join(dir, '.env')), false)
  assert.equal(existsSync(join(dir, 'bunfig.toml')), false)
  assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), '{ "private": true }\n')
  assert.equal(existsSync(join(dir, 'tracked-empty.txt')), true)
  assert.equal(readFileSync(join(dir, '.git/info/exclude'), 'utf8'), EXCLUDE_HEAD)
})

test('leaves the exclude file alone and prints nothing when there is nothing to clean', (t) => {
  const dir = tempRepo(t, { 'a.txt': 'a\n', '.npmrc': 'registry=x\n' })
  writeFileSync(join(dir, '.git/info/exclude'), EXCLUDE_HEAD)
  const { code, stdout } = runScript(dir, 'clean-sandbox-stubs.sh')
  assert.equal(code, 0)
  assert.equal(stdout, '')
  assert.equal(readFileSync(join(dir, '.npmrc'), 'utf8'), 'registry=x\n')
  assert.equal(readFileSync(join(dir, '.git/info/exclude'), 'utf8'), EXCLUDE_HEAD)
})

test('removes known stubs even without an exclude block (git worktrees)', (t) => {
  const dir = tempRepo(t, { 'a.txt': 'a\n' })
  write(dir, { '.env.local': '', '.yarnrc.yml': '', 'package.json': '{}\n', 'notes.md': '' })
  const { code, stdout } = runScript(dir, 'clean-sandbox-stubs.sh')
  assert.equal(code, 0)
  assert.match(stdout, /Removed 2 sandbox stub file\(s\)/)
  assert.equal(existsSync(join(dir, '.env.local')), false)
  assert.equal(existsSync(join(dir, 'package.json')), true)
  assert.equal(existsSync(join(dir, 'notes.md')), true, 'empty files that are not known stubs stay')
})
