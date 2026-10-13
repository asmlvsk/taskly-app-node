// Prints a coverage-summary.json as a small Markdown table for the job summary.
// Usage: node coverage-to-summary.mjs <coverage-summary.json> <label>
import { readFileSync } from 'node:fs'

const [file, label] = process.argv.slice(2)
try {
  const total = JSON.parse(readFileSync(file, 'utf8')).total
  console.log(`### Coverage: ${label}\n`)
  console.log('| Lines | Branches | Functions | Statements |\n| --- | --- | --- | --- |')
  console.log(`| ${total.lines.pct}% | ${total.branches.pct}% | ${total.functions.pct}% | ${total.statements.pct}% |`)
} catch {
  console.log(`### Coverage: ${label}\n\n_No coverage summary found._`)
}
