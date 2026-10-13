// Extracts the agent's structured report from `claude -p --output-format json` output.
// Usage: node extract-report.mjs <agent-output.json> <report.json>
// Falls back to parsing a JSON object from the free-text result, and finally writes
// a minimal "no report" object so later steps always have something to render.
import { readFileSync, writeFileSync } from 'node:fs'

const [input, output] = process.argv.slice(2)
let raw = ''
try {
  raw = readFileSync(input, 'utf8')
} catch {}

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
  }
  report = message?.structured_output ?? null
  if (!report && typeof message?.result === 'string') {
    const match = message.result.match(/\{[\s\S]*\}/)
    if (match) report = JSON.parse(match[0])
  }
} catch (error) {
  meta.parseError = String(error)
}

if (!report || typeof report !== 'object') {
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
