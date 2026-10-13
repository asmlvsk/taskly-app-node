// Coverage ratchet: after the agent, a pull request must not lower line or branch
// coverage of any package compared with the base branch.
//
// Usage: node check-coverage.mjs
// Reads  .agent/after-verify.json and .agent/base/<pkg>-coverage-summary.json
// Env    COVERAGE_TOLERANCE  allowed drop in percentage points (default 0.1, absorbs
//                            rounding when files are added or removed)
// Writes .agent/coverage-check.json and sets the step output `ok`.
// Exits 0 always; the workflow decides whether a failed ratchet fails the check.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const tolerance = Number(process.env.COVERAGE_TOLERANCE ?? '0.1')
const read = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

export function compare(base, after, tol) {
  const result = { ok: true, packages: {} }
  for (const pkg of ['backend', 'frontend']) {
    const b = base[pkg]
    const a = after?.[pkg]?.coverage
    if (!b || !a) {
      result.packages[pkg] = { checked: false }
      continue
    }
    const entry = { checked: true, ok: true }
    for (const metric of ['lines', 'branches']) {
      const before = b[metric]
      const now = a[metric]
      const delta = Math.round((now - before) * 100) / 100
      const metricOk = delta >= -tol
      entry[metric] = { base: before, after: now, delta, ok: metricOk }
      if (!metricOk) entry.ok = false
    }
    if (!entry.ok) result.ok = false
    result.packages[pkg] = entry
  }
  return result
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const after = read('.agent/after-verify.json')
  const base = {}
  for (const pkg of ['backend', 'frontend']) {
    const total = read(`.agent/base/${pkg}-coverage-summary.json`)?.total
    if (total) base[pkg] = { lines: total.lines.pct, branches: total.branches.pct }
  }
  const result = { tolerance, ...compare(base, after, tolerance) }
  writeFileSync('.agent/coverage-check.json', JSON.stringify(result, null, 2))
  for (const [pkg, entry] of Object.entries(result.packages)) {
    if (!entry.checked) console.log(`${pkg}: not checked (no base or after coverage)`)
    else
      console.log(
        `${pkg}: lines ${entry.lines.base} -> ${entry.lines.after} (${entry.lines.delta}), branches ${entry.branches.base} -> ${entry.branches.after} (${entry.branches.delta}) ${entry.ok ? 'ok' : 'DROPPED'}`,
      )
  }
  if (!result.ok) console.log(`::error::Coverage dropped below the base branch by more than ${tolerance} points.`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `ok=${result.ok}\n`)
  else console.log(`ok=${result.ok}`)
}
