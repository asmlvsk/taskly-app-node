import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { readJson, runScript, tempDir, write } from './helpers.mjs'

function extract(t, output) {
  const dir = tempDir(t)
  if (output !== undefined) write(dir, { 'out.json': typeof output === 'string' ? output : JSON.stringify(output) })
  const { code } = runScript(dir, 'extract-report.mjs', ['out.json', 'report.json'])
  assert.equal(code, 0)
  return readJson(join(dir, 'report.json'))
}

const cliResult = (extra) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  num_turns: 22,
  duration_ms: 66592,
  total_cost_usd: 0.28,
  permission_denials: [{ tool_name: 'Bash' }],
  ...extra,
})

const report = {
  summary: 'Added tests.',
  decisions: [{ path: 'backend/src/a.ts', action: 'create', testFile: 'backend/tests/a.test.ts', reason: 'new' }],
  skillsUsed: ['analyze-changes'],
  filesChanged: ['backend/tests/a.test.ts'],
  results: { backend: { ran: true, passed: 3, failed: 0 }, frontend: { ran: false } },
  notes: [],
}

test('uses structured_output when the CLI provides it', (t) => {
  const result = extract(t, cliResult({ structured_output: report, result: 'ignored' }))
  assert.equal(result.summary, 'Added tests.')
  assert.deepEqual(result.decisions, report.decisions)
  assert.deepEqual(result.meta, {
    subtype: 'success',
    isError: false,
    numTurns: 22,
    durationMs: 66592,
    costUsd: 0.28,
    permissionDenials: 1,
    source: 'structured_output',
  })
})

test('parses a JSON report from free text wrapped in a code fence', (t) => {
  const result = extract(t, cliResult({ result: 'Here it is:\n```json\n' + JSON.stringify(report) + '\n```\nThanks.' }))
  assert.equal(result.meta.source, 'result-text')
  assert.deepEqual(result.filesChanged, ['backend/tests/a.test.ts'])
})

test('normalizes the key variations models produce', (t) => {
  const variant = {
    status: 'success',
    decisions: [
      { file: 'a.ts', decision: 'updated', tests: 'a.test.ts', why: 'changed' },
      { source: 'b.ts', type: 'removed', rationale: 'module deleted' },
      { path: 'c.ts', action: 'skipped' },
    ],
    skills: ['verify-tests'],
    files: ['a.test.ts'],
    backend: { executed: true, testsPassed: '12', numFailed: 0, linesAfter: 90.5 },
    remarks: 'one note',
  }
  const result = extract(t, cliResult({ result: JSON.stringify(variant) }))
  assert.equal(result.summary, 'success')
  assert.deepEqual(result.decisions, [
    { path: 'a.ts', action: 'update', testFile: 'a.test.ts', reason: 'changed' },
    { path: 'b.ts', action: 'delete', reason: 'module deleted' },
    { path: 'c.ts', action: 'skip', reason: '' },
  ])
  assert.deepEqual(result.skillsUsed, ['verify-tests'])
  assert.deepEqual(result.results, {
    backend: { ran: true, passed: 12, failed: 0, coverageLinesAfter: 90.5 },
    frontend: { ran: false },
  })
  assert.deepEqual(result.notes, ['one note'])
})

test('reads the result message from stream-json style arrays', (t) => {
  const result = extract(t, [{ type: 'system' }, cliResult({ structured_output: report })])
  assert.equal(result.summary, 'Added tests.')
})

test('writes a fallback report when the output is empty or not JSON', (t) => {
  for (const output of [undefined, '', 'Error: --json-schema is not valid']) {
    const result = extract(t, output)
    assert.equal(result.summary, 'The agent did not return a structured report.')
    assert.deepEqual(result.results, { backend: { ran: false }, frontend: { ran: false } })
    assert.match(result.notes[0], /Could not parse agent output/)
  }
})

test('writes a fallback report when the run ended without any JSON', (t) => {
  const result = extract(t, cliResult({ subtype: 'error_max_turns', result: 'I ran out of turns.' }))
  assert.equal(result.summary, 'The agent did not return a structured report.')
  assert.deepEqual(result.notes, ['Agent run ended with error_max_turns.'])
})
