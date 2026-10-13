import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { redact } from '../redact.mjs'
import { runScript, tempDir, write } from './helpers.mjs'

test('masks literal secret values passed by the workflow', () => {
  const { text, count } = redact('token=abc123SECRETxyz and again abc123SECRETxyz', ['abc123SECRETxyz'])
  assert.equal(text, 'token=[REDACTED] and again [REDACTED]')
  assert.equal(count, 2)
})

test('ignores empty or very short literal values so it cannot mask everything', () => {
  const { text, count } = redact('a b c', ['', 'a'])
  assert.equal(text, 'a b c')
  assert.equal(count, 0)
})

test('masks well-known token formats even when the value is unknown', () => {
  const input = [
    'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA',
    'ghs_' + 'a'.repeat(36),
    'github_pat_' + 'b'.repeat(60),
    'AKIA' + 'C'.repeat(16),
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
  ].join('\n')
  const { text, count } = redact(input)
  assert.equal(count, 5)
  assert.equal(text, Array(5).fill('[REDACTED]').join('\n'))
})

test('leaves ordinary test output untouched', () => {
  const log = ' ✓ tests/router.test.ts (21 tests) 54ms\n Tests  89 passed (89)\n sha 3bfc877ce1238b3592c370e4f79992f073f1a63f'
  assert.deepEqual(redact(log), { text: log, count: 0 })
})

test('CLI rewrites text files in place and skips binary files', (t) => {
  const dir = tempDir(t)
  write(dir, { '.agent/a.log': 'key=topsecretvalue1\n', '.agent/nested/b.json': '{"k":"sk-ant-oat01-ZZZZZZZZZZZZZZZZZZZZ"}' })
  writeFileSync(join(dir, '.agent/bin.dat'), Buffer.from([0, 1, 2, 0x73, 0x6b]))
  const { code, stdout } = runScript(dir, 'redact.mjs', ['.agent', 'missing-dir'], { REDACT_VALUES: 'topsecretvalue1\n\n' })
  assert.equal(code, 0)
  assert.match(stdout, /Redacted 2 secret occurrence\(s\) in 2 file\(s\)/)
  assert.equal(readFileSync(join(dir, '.agent/a.log'), 'utf8'), 'key=[REDACTED]\n')
  assert.equal(readFileSync(join(dir, '.agent/nested/b.json'), 'utf8'), '{"k":"[REDACTED]"}')
  assert.deepEqual([...readFileSync(join(dir, '.agent/bin.dat'))], [0, 1, 2, 0x73, 0x6b])
})
