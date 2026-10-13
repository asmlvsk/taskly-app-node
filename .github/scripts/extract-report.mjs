// Extracts the agent's structured report from `claude -p --output-format json` output.
// Usage: node extract-report.mjs <agent-output.json> <report.json>
// Prefers `structured_output`; otherwise parses the JSON object in the free-text result
// (code fences tolerated) and normalizes common key variations so the renderer always
// gets the shape of .github/agent/report.schema.json. Finally falls back to a minimal
// "no report" object so later steps always have something to render.
import { readFileSync, writeFileSync } from 'node:fs'

const [input, output] = process.argv.slice(2)
let raw = ''
try {
  raw = readFileSync(input, 'utf8')
} catch {}

const pick = (obj, ...keys) => {
  for (const key of keys) if (obj && obj[key] !== undefined) return obj[key]
  return undefined
}
const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v])
const asNumber = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined)

function normalizePackage(p) {
  if (!p || typeof p !== 'object') return { ran: false }
  const ran = pick(p, 'ran', 'executed', 'touched')
  const out = { ran: ran === undefined ? Boolean(pick(p, 'passed', 'tests')) : Boolean(ran) }
  const passed = asNumber(pick(p, 'passed', 'testsPassed', 'numPassed'))
  const failed = asNumber(pick(p, 'failed', 'testsFailed', 'numFailed'))
  const before = asNumber(pick(p, 'coverageLinesBefore', 'linesBefore', 'coverageBefore'))
  const after = asNumber(pick(p, 'coverageLinesAfter', 'linesAfter', 'coverageAfter', 'coverageLines'))
  if (passed !== undefined) out.passed = passed
  if (failed !== undefined) out.failed = failed
  if (before !== undefined) out.coverageLinesBefore = before
  if (after !== undefined) out.coverageLinesAfter = after
  return out
}

function normalize(r) {
  const results = pick(r, 'results') ?? { backend: r.backend, frontend: r.frontend }
  const actionOf = (d) => {
    const a = String(pick(d, 'action', 'decision', 'type') ?? '').toLowerCase()
    if (['create', 'created', 'add', 'added', 'new'].includes(a)) return 'create'
    if (['update', 'updated', 'extend', 'extended', 'modify', 'modified'].includes(a)) return 'update'
    if (['delete', 'deleted', 'remove', 'removed'].includes(a)) return 'delete'
    if (['skip', 'skipped', 'none', 'ignore'].includes(a)) return 'skip'
    return a || 'skip'
  }
  return {
    summary: String(pick(r, 'summary', 'status', 'message') ?? ''),
    decisions: asArray(pick(r, 'decisions')).map((d) => ({
      path: String(pick(d, 'path', 'file', 'source', 'sourceFile') ?? ''),
      action: actionOf(d),
      testFile: pick(d, 'testFile', 'test', 'tests', 'test_file') == null ? undefined : String(pick(d, 'testFile', 'test', 'tests', 'test_file')),
      reason: String(pick(d, 'reason', 'why', 'rationale') ?? ''),
    })),
    skillsUsed: asArray(pick(r, 'skillsUsed', 'skills', 'skills_used')).map(String),
    filesChanged: asArray(pick(r, 'filesChanged', 'files', 'files_changed', 'changedFiles')).map(String),
    results: { backend: normalizePackage(results?.backend), frontend: normalizePackage(results?.frontend) },
    notes: asArray(pick(r, 'notes', 'remarks', 'warnings')).map(String),
  }
}

let report = null
let meta = {}
try {
  const parsed = JSON.parse(raw)
  const message = Array.isArray(parsed) ? parsed.find((m) => m.type === 'result') ?? parsed.at(-1) : parsed
  meta = {
    subtype: message?.subtype,
    isError: message?.is_error ?? false,
    numTurns: message?.num_turns,
    durationMs: message?.duration_ms,
    costUsd: message?.total_cost_usd,
    permissionDenials: message?.permission_denials?.length ?? 0,
    source: 'structured_output',
  }
  let candidate = message?.structured_output ?? null
  if (!candidate && typeof message?.result === 'string') {
    const text = message.result.replace(/```(?:json)?/g, '')
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end > start) {
      candidate = JSON.parse(text.slice(start, end + 1))
      meta.source = 'result-text'
    }
  }
  if (candidate && typeof candidate === 'object') report = normalize(candidate)
} catch (error) {
  meta.parseError = String(error)
}

if (!report) {
  report = {
    summary: 'The agent did not return a structured report.',
    decisions: [],
    skillsUsed: [],
    filesChanged: [],
    results: { backend: { ran: false }, frontend: { ran: false } },
    notes: [meta.parseError ? `Could not parse agent output: ${meta.parseError}` : `Agent run ended with ${meta.subtype ?? 'unknown status'}.`],
  }
}
report.meta = meta
writeFileSync(output, JSON.stringify(report, null, 2))
console.log(JSON.stringify(meta))
