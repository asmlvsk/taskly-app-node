// Shared helpers for the workflow script tests (node:test, no dependencies).
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'test-agent-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

export function write(root, files) {
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content))
  }
}

export const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

export function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

// A throwaway git repository with an initial commit of `files`.
export function tempRepo(t, files) {
  const dir = tempDir(t)
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'test')
  git(dir, 'config', 'commit.gpgsign', 'false')
  write(dir, files)
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'initial')
  return dir
}

export function commit(dir, message = 'change') {
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', message)
  return git(dir, 'rev-parse', 'HEAD')
}

// Runs a script from .github/scripts with `cwd` as the repository root.
export function runScript(cwd, script, args = [], env = {}) {
  const path = join(SCRIPTS, script)
  const command = script.endsWith('.mjs') ? process.execPath : 'bash'
  const result = spawnSync(command, [path, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_OUTPUT: '', ...env },
  })
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

// Parses `key=value` lines (the GITHUB_OUTPUT fallback the scripts print to stdout).
export function outputs(stdout) {
  return Object.fromEntries(
    stdout
      .split('\n')
      .map((line) => line.match(/^([a-z_]+)=(.*)$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  )
}
