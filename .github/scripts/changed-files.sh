#!/usr/bin/env bash
# Lists source files changed between two commits that the test agent should look at.
# Usage: changed-files.sh <base-sha> <head-sha>
# Writes .agent/changed-files.txt and sets the `count` and `files` step outputs.
set -euo pipefail

base="$1"
head="$2"
mkdir -p .agent

git diff --name-only --diff-filter=ACMR "$base" "$head" -- backend/src frontend/src \
  | grep -Ev '(^|/)(generated)/' \
  | grep -Ev '\.(test|stories)\.(ts|tsx)$' \
  | grep -Ev '(^|/)(types|index|queryKeys|queryClient|main)\.(ts|tsx)$' \
  | grep -Ev '\.types\.ts$' \
  | grep -Ev '^frontend/src/(test|design-system)/' \
  > .agent/changed-files.txt || true

count=$(grep -c . .agent/changed-files.txt || true)
echo "Changed source files considered for testing: $count"
cat .agent/changed-files.txt

{
  echo "count=$count"
  echo "files<<EOF"
  cat .agent/changed-files.txt
  echo "EOF"
} >> "${GITHUB_OUTPUT:-/dev/stdout}"
