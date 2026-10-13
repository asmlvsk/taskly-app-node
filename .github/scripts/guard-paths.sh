#!/usr/bin/env bash
# Hard enforcement of the "tests only" policy, independent of the agent's own rules.
#
# Every change in the working tree and the index is checked against an allow list:
#   backend/tests/*.ts, frontend/src/**/*.test.ts(x), frontend/src/test/**,
#   frontend/src/design-system/mocks.tsx
# Anything else is restored from HEAD (tracked) or removed (untracked) and recorded.
#
# Deleting a tracked file is allowed only for a *stale test*: a test file on the allow
# list whose source module no longer exists (the PR deleted or renamed it). Shared
# helpers (fixture.ts, frontend/src/test/**, mocks.tsx) can never be deleted.
#
# Writes .agent/guard.json ({ violations, kept, deleted }) and sets the step outputs
# `changed` and `violations`.
#
# WARNING: this restores *every* uncommitted change outside the allow list. Run it only
# on a clean checkout (as the workflow does), never on a working tree with your own
# uncommitted work.
set -euo pipefail

# Step outputs go to $GITHUB_OUTPUT in Actions and to stdout elsewhere. (Redirecting to
# /dev/stdout fails with ENXIO when stdout is a socket, e.g. under Node's child_process.)
emit_outputs() { if [ -n "${GITHUB_OUTPUT:-}" ]; then cat >> "$GITHUB_OUTPUT"; else cat; fi; }

mkdir -p .agent
allow='^(backend/tests/[^/]+\.ts|frontend/src/.+\.test\.tsx?|frontend/src/test/.+|frontend/src/design-system/mocks\.tsx)$'

violations=()
kept=()
deleted=()

restore() {
  local path="$1"
  if git cat-file -e "HEAD:$path" 2>/dev/null; then
    git restore --source=HEAD --staged --worktree -- "$path"
  else
    git rm -q --cached --ignore-unmatch -- "$path" >/dev/null 2>&1 || true
    rm -rf -- "$path"
  fi
}

# A test is stale when the module it tests is gone.
is_stale_test() {
  local path="$1" name dir
  case "$path" in
    backend/tests/*.test.ts)
      name=$(basename "$path" .test.ts)
      [ -z "$(find backend/src -path backend/src/generated -prune -o -name "$name.ts" -print -quit 2>/dev/null)" ]
      ;;
    frontend/src/test/*) return 1 ;;
    frontend/src/*.test.ts | frontend/src/*.test.tsx)
      dir=$(dirname "$path")
      name=$(basename "$path")
      name=${name%.test.tsx}
      name=${name%.test.ts}
      [ ! -e "$dir/$name.ts" ] && [ ! -e "$dir/$name.tsx" ]
      ;;
    *) return 1 ;;
  esac
}

check_deletion() {
  local path="$1"
  if [[ "$path" =~ $allow ]] && is_stale_test "$path"; then
    deleted+=("$path")
    kept+=("$path")
  else
    violations+=("$path (deleted)")
    restore "$path"
  fi
}

check_change() {
  local path="$1"
  if [[ "$path" =~ $allow ]]; then
    kept+=("$path")
  else
    violations+=("$path")
    restore "$path"
  fi
}

# -z output: "XY path\0", renames/copies are "XY new\0old\0".
entries=()
while IFS= read -r -d '' entry; do entries+=("$entry"); done < <(git status --porcelain=v1 -z --untracked-files=all)

i=0
while [ $i -lt ${#entries[@]} ]; do
  entry="${entries[$i]}"
  code="${entry:0:2}"
  path="${entry:3}"
  i=$((i + 1))
  case "$path" in .agent/* | */coverage/*) continue ;; esac

  if [[ "$code" == R* || "$code" == C* ]]; then
    old="${entries[$i]}"
    i=$((i + 1))
    [[ "$code" == R* ]] && check_deletion "$old"
    check_change "$path"
  elif [[ "$code" == *D* ]]; then
    check_deletion "$path"
  else
    check_change "$path"
  fi
done

printf '%s\n' "${violations[@]:+${violations[@]}}" > .agent/guard-violations.txt
printf '%s\n' "${kept[@]:+${kept[@]}}" > .agent/guard-kept.txt
printf '%s\n' "${deleted[@]:+${deleted[@]}}" > .agent/guard-deleted.txt
node - <<'EOF'
const fs = require('node:fs');
const lines = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
const result = {
  violations: lines('.agent/guard-violations.txt'),
  kept: lines('.agent/guard-kept.txt'),
  deleted: lines('.agent/guard-deleted.txt'),
};
fs.writeFileSync('.agent/guard.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
EOF

{
  echo "changed=$([ ${#kept[@]} -gt 0 ] && echo true || echo false)"
  echo "violations=${#violations[@]}"
} | emit_outputs

if [ ${#violations[@]} -gt 0 ]; then
  echo "::warning::Reverted ${#violations[@]} change(s) outside the test allow list: ${violations[*]}"
fi
