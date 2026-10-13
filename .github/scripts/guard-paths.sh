#!/usr/bin/env bash
# Hard enforcement of the "tests only" policy, independent of the agent's own rules.
# Any modified, added or deleted path outside the allow list is reverted and recorded.
# Deleting a pre-existing (tracked) file is never allowed, even inside the allow list.
# Writes .agent/guard.json and sets the `changed` and `violations` step outputs.
#
# WARNING: this reverts *every* uncommitted change outside the allow list. Run it only
# on a clean checkout (as the workflow does), never on a working tree with your own
# uncommitted work.
set -euo pipefail

mkdir -p .agent
allow='^(backend/tests/[^/]+\.ts|frontend/src/.+\.test\.tsx?|frontend/src/test/.+|frontend/src/design-system/mocks\.tsx)$'

violations=()
kept=()

while IFS= read -r line; do
  [ -z "$line" ] && continue
  code="${line:0:2}"
  path="${line:3}"
  # "R  old -> new" renames: treat both sides.
  if [[ "$path" == *" -> "* ]]; then path="${path##* -> }"; fi
  case "$path" in .agent/*|*/coverage/*) continue ;; esac

  if [[ "$code" == *D* ]]; then
    violations+=("$path (deleted a tracked file)")
    git checkout -- "$path" 2>/dev/null || true
  elif [[ ! "$path" =~ $allow ]]; then
    violations+=("$path")
    if git ls-files --error-unmatch "$path" >/dev/null 2>&1; then
      git checkout -- "$path"
    else
      rm -rf -- "$path"
    fi
  else
    kept+=("$path")
  fi
done < <(git status --porcelain --untracked-files=all)

printf '%s\n' "${violations[@]:+${violations[@]}}" > .agent/guard-violations.txt
printf '%s\n' "${kept[@]:+${kept[@]}}" > .agent/guard-kept.txt
node - <<'EOF'
const fs = require('node:fs');
const lines = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
const violations = lines('.agent/guard-violations.txt');
const kept = lines('.agent/guard-kept.txt');
fs.writeFileSync('.agent/guard.json', JSON.stringify({ violations, kept }, null, 2));
console.log(JSON.stringify({ violations, kept }));
EOF

{
  echo "changed=$([ ${#kept[@]} -gt 0 ] && echo true || echo false)"
  echo "violations=${#violations[@]}"
} >> "${GITHUB_OUTPUT:-/dev/stdout}"

if [ ${#violations[@]} -gt 0 ]; then
  echo "::warning::Reverted ${#violations[@]} change(s) outside the test allow list: ${violations[*]}"
fi
