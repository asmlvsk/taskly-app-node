// Renders the sticky PR comment / job summary from the files in .agent/.
// Usage: node render-comment.mjs [--nothing-to-test]
// Env: COMMIT_SHA, RUN_URL, AGENT_OUTCOME, GITHUB_SERVER_URL, GITHUB_REPOSITORY
import { readFileSync } from 'node:fs'

const MARKER = '<!-- taskly-test-agent -->'
const read = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}
const runUrl = process.env.RUN_URL ?? ''
const repoUrl = `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY ?? ''}`
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
const pct = (v) => (typeof v === 'number' ? `${v.toFixed(1)}%` : 'n/a')
const delta = (before, after) => {
  if (typeof before !== 'number' || typeof after !== 'number') return ''
  const d = after - before
  return d === 0 ? ' (±0)' : ` (${d > 0 ? '+' : ''}${d.toFixed(1)})`
}

if (process.argv.includes('--nothing-to-test')) {
  console.log(`${MARKER}
## 🧪 Test agent

No source files under \`backend/src\` or \`frontend/src\` changed in this pull request, so the test agent did not run.
${runUrl ? `\n[Workflow run](${runUrl})` : ''}`)
  process.exit(0)
}

const report = read('.agent/report.json') ?? {}
const baseline = read('.agent/baseline-verify.json')
const after = read('.agent/after-verify.json')
const guard = read('.agent/guard.json') ?? { violations: [], kept: [] }
const commitSha = process.env.COMMIT_SHA || ''
const agentOutcome = process.env.AGENT_OUTCOME || 'unknown'

const verifyOk = after && ['backend', 'frontend'].every((p) => after[p]?.typecheck && after[p]?.tests)
const changed = guard.kept.length > 0
let status
if (!after) status = '⚠️ Verification did not run'
else if (verifyOk && commitSha) status = '✅ Tests generated, verified and committed'
else if (verifyOk && !changed) status = 'ℹ️ No test changes were needed'
else if (verifyOk) status = '⚠️ Tests verified but not committed'
else status = '❌ Verification failed; nothing was committed'

const lines = [MARKER, '## 🧪 Test agent report', '', `**${status}**`, '']
if (report.summary) lines.push(report.summary, '')
if (commitSha) lines.push(`Committed as [\`${commitSha.slice(0, 7)}\`](${repoUrl}/commit/${commitSha}).`, '')

lines.push('### Decisions', '')
if (report.decisions?.length) {
  lines.push('| Source file | Action | Test file | Reason |', '| --- | --- | --- | --- |')
  for (const d of report.decisions) lines.push(`| \`${esc(d.path)}\` | ${esc(d.action)} | ${d.testFile ? `\`${esc(d.testFile)}\`` : ''} | ${esc(d.reason)} |`)
} else {
  lines.push('_The agent did not report any decisions._')
}
lines.push('')

lines.push('### Verification (run by the workflow, not by the agent)', '')
lines.push('| Package | Typecheck | Tests | Passed | Failed | Lines | Branches |', '| --- | --- | --- | --- | --- | --- | --- |')
for (const pkg of ['backend', 'frontend']) {
  const a = after?.[pkg]
  const b = baseline?.[pkg]
  if (!a) {
    lines.push(`| ${pkg} | n/a | n/a | | | | |`)
    continue
  }
  lines.push(
    `| ${pkg} | ${a.typecheck ? '✅' : '❌'} | ${a.tests ? '✅' : '❌'} | ${a.passed ?? ''} | ${a.failed ?? ''} | ${pct(a.coverage?.lines)}${delta(b?.coverage?.lines, a.coverage?.lines)} | ${pct(a.coverage?.branches)}${delta(b?.coverage?.branches, a.coverage?.branches)} |`,
  )
}
if (baseline) {
  const red = ['backend', 'frontend'].filter((p) => !(baseline[p]?.typecheck && baseline[p]?.tests))
  if (red.length) lines.push('', `> ⚠️ The suite was already failing before the agent ran (${red.join(', ')}).`)
}
lines.push('')

lines.push('### Files', '')
if (guard.kept.length) for (const f of guard.kept) lines.push(`- \`${f}\``)
else lines.push('_No test files were changed._')
if (guard.violations?.length) {
  lines.push('', '> 🛡️ Reverted changes outside the test allow list:')
  for (const v of guard.violations) lines.push(`> - \`${v}\``)
}
lines.push('')

const details = []
if (report.skillsUsed?.length) details.push(`**Skills used:** ${report.skillsUsed.map((s) => `\`${s}\``).join(', ')}`)
const meta = report.meta ?? {}
const metaBits = []
if (meta.numTurns != null) metaBits.push(`${meta.numTurns} turns`)
if (meta.durationMs != null) metaBits.push(`${Math.round(meta.durationMs / 1000)}s`)
if (meta.costUsd != null) metaBits.push(`$${Number(meta.costUsd).toFixed(2)}`)
if (meta.permissionDenials) metaBits.push(`${meta.permissionDenials} denied tool call(s)`)
if (metaBits.length) details.push(`**Agent run:** ${metaBits.join(', ')} (${agentOutcome})`)
if (details.length) lines.push(details.join('  \n'), '')

if (report.notes?.length) {
  lines.push('### Notes from the agent', '')
  for (const n of report.notes) lines.push(`- ${esc(n)}`)
  lines.push('')
}

lines.push('<sub>Agent: `.claude/agents/test-engineer.md` · Skills: `.claude/skills/*` · Workflow: `.github/workflows/test-agent.yml`' + (runUrl ? ` · [Run](${runUrl})` : '') + '</sub>')
console.log(lines.join('\n'))
