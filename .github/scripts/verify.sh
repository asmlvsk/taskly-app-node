#!/usr/bin/env bash
# Runs typecheck + Vitest with coverage for both packages, independently of the agent.
# Usage: verify.sh <baseline|after>
# Writes .agent/<phase>-verify.json and, for `baseline`, copies coverage summaries
# to .agent/baseline/. Sets the `ok` step output. Never fails the step itself;
# the workflow decides what to do with `ok`.
set -uo pipefail

# Step outputs go to $GITHUB_OUTPUT in Actions and to stdout elsewhere. (Redirecting to
# /dev/stdout fails with ENXIO when stdout is a socket, e.g. under Node's child_process.)
emit_outputs() { if [ -n "${GITHUB_OUTPUT:-}" ]; then cat >> "$GITHUB_OUTPUT"; else cat; fi; }

phase="${1:-after}"
root="$(pwd)"
mkdir -p .agent/baseline

status_json="{"
all_ok=true

for pkg in backend frontend; do
  echo "::group::$phase: $pkg"
  tc_log=".agent/$phase-$pkg-typecheck.log"
  test_log=".agent/$phase-$pkg-test.log"
  json_out="$root/.agent/$phase-$pkg-vitest.json"

  (cd "$pkg" && npm run typecheck) > "$tc_log" 2>&1
  tc_ok=$?

  (cd "$pkg" && npx vitest run --coverage --reporter=default --reporter=json --outputFile="$json_out") > "$test_log" 2>&1
  test_ok=$?

  if [ "$phase" = "baseline" ] && [ -f "$pkg/coverage/coverage-summary.json" ]; then
    cp "$pkg/coverage/coverage-summary.json" ".agent/baseline/$pkg-coverage-summary.json"
  fi

  tail -n 40 "$test_log"
  [ $tc_ok -eq 0 ] || { echo "Typecheck failed:"; tail -n 40 "$tc_log"; }
  echo "::endgroup::"

  [ $tc_ok -eq 0 ] && [ $test_ok -eq 0 ] || all_ok=false
  status_json+="\"$pkg\":{\"typecheck\":$([ $tc_ok -eq 0 ] && echo true || echo false),\"tests\":$([ $test_ok -eq 0 ] && echo true || echo false)},"
done

status_json="${status_json%,}}"
node - "$phase" "$status_json" <<'EOF'
const fs = require('node:fs');
const [phase, statusJson] = process.argv.slice(2);
const status = JSON.parse(statusJson);
const out = {};
for (const pkg of ['backend', 'frontend']) {
  const entry = { ...status[pkg], passed: null, failed: null, coverage: null };
  try {
    const run = JSON.parse(fs.readFileSync(`.agent/${phase}-${pkg}-vitest.json`, 'utf8'));
    entry.passed = run.numPassedTests;
    entry.failed = run.numFailedTests;
    entry.testFiles = run.numTotalTestSuites;
  } catch {}
  try {
    const summary = JSON.parse(fs.readFileSync(`${pkg}/coverage/coverage-summary.json`, 'utf8')).total;
    entry.coverage = { lines: summary.lines.pct, branches: summary.branches.pct, functions: summary.functions.pct, statements: summary.statements.pct };
  } catch {}
  out[pkg] = entry;
}
fs.writeFileSync(`.agent/${phase}-verify.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out));
EOF

echo "ok=$all_ok" | emit_outputs
echo "$phase verification ok: $all_ok"
exit 0
