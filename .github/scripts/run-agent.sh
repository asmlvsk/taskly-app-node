#!/usr/bin/env bash
# Runs the custom `test-engineer` agent headlessly on a list of source files.
# Inputs (env): BASE_SHA, HEAD_SHA, ANTHROPIC_API_KEY, AGENT_MODEL, AGENT_MAX_TURNS, AGENT_MAX_BUDGET_USD,
#   PROMPT_TEMPLATE (default .github/agent/prompt.md; use backfill-prompt.md for a local coverage run),
#   OUTPUT_PREFIX (default "agent"; names the files below).
# Reads .agent/changed-files.txt and .agent/baseline-verify.json.
# Writes .agent/<prefix>-output.json (raw CLI output), .agent/<prefix>-stderr.log and .agent/report.json.
# Locally, without ANTHROPIC_API_KEY, the CLI falls back to the logged-in Claude account.
set -uo pipefail

mkdir -p .agent
: "${BASE_SHA:?}" "${HEAD_SHA:?}"
: "${AGENT_MODEL:=claude-sonnet-5-5}" "${AGENT_MAX_TURNS:=120}" "${AGENT_MAX_BUDGET_USD:=5}"
: "${PROMPT_TEMPLATE:=.github/agent/prompt.md}" "${OUTPUT_PREFIX:=agent}"

if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -n "${GITHUB_ACTIONS:-}" ]; then
  echo "::error::ANTHROPIC_API_KEY secret is not set; the agent cannot run."
  exit 1
fi

baseline_status="unknown"
if [ -f .agent/baseline-verify.json ]; then
  baseline_status=$(node -e "const b=require('./.agent/baseline-verify.json');console.log(['backend','frontend'].map(p=>p+': '+(b[p].tests&&b[p].typecheck?'green':'RED')+' ('+b[p].passed+' passed, '+b[p].failed+' failed)').join('; '))")
fi

changed=$(sed 's/^/- /' .agent/changed-files.txt)
prompt=$(sed -e "s|{{BASE_SHA}}|$BASE_SHA|g" -e "s|{{HEAD_SHA}}|$HEAD_SHA|g" -e "s|{{BASELINE_STATUS}}|$baseline_status|g" "$PROMPT_TEMPLATE")
prompt="${prompt//\{\{CHANGED_FILES\}\}/$changed}"
printf '%s\n' "$prompt" > ".agent/$OUTPUT_PREFIX-prompt.txt"

# Skills and the report contract are appended to the agent's system prompt explicitly.
# `claude -p --agent` runs the agent as the main thread; in that mode the `skills:`
# preload of the agent file and `--json-schema` are not applied (verified with
# Claude Code 2.1.296), so the run must not depend on them.
{
  echo "# Preloaded skills"
  echo
  echo "The following skills are part of your instructions. Follow them in the order given by the agent definition: analyze-changes, write-backend-tests / write-frontend-tests, verify-tests, report-results."
  for skill in analyze-changes write-backend-tests write-frontend-tests verify-tests report-results; do
    echo
    echo "---"
    echo
    echo "## Skill: $skill"
    echo
    sed '1{/^---$/,/^---$/d}' ".claude/skills/$skill/SKILL.md" | sed '/^---$/,/^---$/d'
  done
  echo
  echo "---"
  echo
  echo "# Report contract"
  echo
  echo "Your final message must be exactly one JSON object and nothing else (no prose, no code fence), using exactly these top-level keys: summary, decisions, skillsUsed, filesChanged, results, notes. Each decision has the keys path, action (create|update|skip), testFile, reason. results has backend and frontend, each with ran and, when ran is true, passed, failed, coverageLinesBefore, coverageLinesAfter. JSON Schema:"
  echo
  cat .github/agent/report.schema.json
} > ".agent/$OUTPUT_PREFIX-system-append.md"

# Allow list: read-only exploration, edits restricted to test paths, and the exact
# commands the skills use. Deny rules in .claude/settings.json still apply on top.
allowed=(
  "Read" "Grep" "Glob"
  "Edit(backend/tests/**)"
  "Edit(frontend/src/**/*.test.ts)" "Edit(frontend/src/**/*.test.tsx)"
  "Edit(frontend/src/test/**)" "Edit(frontend/src/design-system/mocks.tsx)"
  "Bash(git diff*)" "Bash(git log*)" "Bash(git status*)" "Bash(git show*)" "Bash(ls*)"
  # No `cd`: the headless shell keeps its working directory between calls and compound
  # commands are permission-checked per segment. Every package command runs from the
  # repository root through `npm --prefix <pkg>`.
  "Bash(npm --prefix backend run typecheck)" "Bash(npm --prefix backend run test*)"
  "Bash(npm --prefix frontend run typecheck)" "Bash(npm --prefix frontend run test*)"
  "Bash(npm --prefix frontend exec -- prettier --check*)"
)

set +e
claude -p "$prompt" \
  --agent test-engineer \
  --model "$AGENT_MODEL" \
  --permission-mode dontAsk \
  --allowedTools "${allowed[@]}" \
  --max-turns "$AGENT_MAX_TURNS" \
  --max-budget-usd "$AGENT_MAX_BUDGET_USD" \
  --output-format json \
  --json-schema "$(cat .github/agent/report.schema.json)" \
  --append-system-prompt-file ".agent/$OUTPUT_PREFIX-system-append.md" \
  --no-session-persistence \
  > ".agent/$OUTPUT_PREFIX-output.json" 2> ".agent/$OUTPUT_PREFIX-stderr.log"
code=$?
set -e

echo "claude exit code: $code"
tail -n 20 ".agent/$OUTPUT_PREFIX-stderr.log" || true
node .github/scripts/extract-report.mjs ".agent/$OUTPUT_PREFIX-output.json" .agent/report.json
exit $code
