#!/usr/bin/env bash
# Lists the source files of a pull request that the test agent should look at.
# Usage: changed-files.sh <base-sha> <head-sha>
#
# Writes:
#   .agent/changed-files.txt  added, modified, copied or renamed (new path) source files
#   .agent/deleted-files.txt  deleted source files and the old paths of renames, whose
#                             tests may now be stale
# Sets the step outputs `count` (both lists together), `changed` and `deleted`.
set -euo pipefail

# Step outputs go to $GITHUB_OUTPUT in Actions and to stdout elsewhere. (Redirecting to
# /dev/stdout fails with ENXIO when stdout is a socket, e.g. under Node's child_process.)
emit_outputs() { if [ -n "${GITHUB_OUTPUT:-}" ]; then cat >> "$GITHUB_OUTPUT"; else cat; fi; }

base="$1"
head="$2"
mkdir -p .agent

# Keep only files the agent can meaningfully test (same exclusions as coverage).
filter() {
  grep -Ev '(^|/)generated/' \
    | grep -Ev '\.(test|stories)\.(ts|tsx)$' \
    | grep -Ev '(^|/)(types|index|queryKeys|queryClient|main)\.(ts|tsx)$' \
    | grep -Ev '\.types\.ts$' \
    | grep -Ev '^frontend/src/(test|design-system)/' \
    | grep -E '\.(ts|tsx)$' || true
}

status=$(git diff --name-status -M "$base" "$head" -- backend/src frontend/src)

# Columns: A|M|C|T <path>, D <path>, R<score> <old> <new>
echo "$status" | awk -F'\t' '$1 ~ /^[AMCT]/ {print $2} $1 ~ /^R/ {print $3}' | filter > .agent/changed-files.txt
echo "$status" | awk -F'\t' '$1 ~ /^D/ {print $2} $1 ~ /^R/ {print $2}' | filter > .agent/deleted-files.txt

changed=$(grep -c . .agent/changed-files.txt || true)
deleted=$(grep -c . .agent/deleted-files.txt || true)
echo "Changed source files: $changed"
sed 's/^/  /' .agent/changed-files.txt
echo "Deleted or renamed-away source files: $deleted"
sed 's/^/  /' .agent/deleted-files.txt

{
  echo "count=$((changed + deleted))"
  echo "changed=$changed"
  echo "deleted=$deleted"
} | emit_outputs
