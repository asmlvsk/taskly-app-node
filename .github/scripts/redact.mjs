// Redacts secrets from every text file under the given directories before they are
// uploaded as workflow artifacts. Artifacts of a public repository can be downloaded by
// any signed-in GitHub user, and these files contain output of code from the PR.
//
// Usage: node redact.mjs <dir> [<dir> ...]
// Env:   REDACT_VALUES - newline-separated literal secret values to remove (optional).
//
// Two layers: exact values passed by the workflow (the API key, the GitHub token), and
// well-known token formats, so a secret that leaked in an encoded or partial form, or one
// the workflow does not know about, is still caught.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{16,}/g, // Anthropic API keys and OAuth tokens
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g, // fine-grained GitHub PATs
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key ids
  /\bey[A-Za-z0-9_-]{10,}\.ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWTs
]
const MASK = '[REDACTED]'
const MAX_BYTES = 20 * 1024 * 1024

export function redact(text, values = []) {
  let out = text
  let count = 0
  for (const value of values) {
    if (!value || value.length < 8) continue
    const parts = out.split(value)
    count += parts.length - 1
    out = parts.join(MASK)
  }
  for (const pattern of PATTERNS) {
    out = out.replace(pattern, () => {
      count += 1
      return MASK
    })
  }
  return { text: out, count }
}

function* walk(dir) {
  let entries = []
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) yield* walk(path)
    else if (stat.isFile() && stat.size <= MAX_BYTES) yield path
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const values = (process.env.REDACT_VALUES ?? '').split('\n').map((v) => v.trim())
  let files = 0
  let total = 0
  for (const dir of process.argv.slice(2)) {
    for (const file of walk(dir)) {
      const buffer = readFileSync(file)
      if (buffer.includes(0)) continue // binary
      const { text, count } = redact(buffer.toString('utf8'), values)
      if (count > 0) {
        writeFileSync(file, text)
        files += 1
        total += count
      }
    }
  }
  console.log(`Redacted ${total} secret occurrence(s) in ${files} file(s).`)
  if (total > 0) console.log('::warning::Secrets were found in agent output and redacted before upload.')
}
