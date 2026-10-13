#!/usr/bin/env bash
# Removes the placeholder files Claude Code creates in scrub mode.
#
# With CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1 the CLI runs Bash inside a sandbox and, to stop
# sandboxed processes from planting config files (package.json, .npmrc, .env, ...), it
# creates empty stubs for the missing ones in the launch directory. In a normal clone it
# also lists them under "# claude-code scrub-mode stubs" in info/exclude; in a git worktree
# it does not. They are left behind after exit.
#
# This script deletes only empty, untracked files that are either in that block or in the
# known stub list below, then drops the block. A real file (for example the root
# package.json) or a tracked empty file is never touched.
set -euo pipefail

marker='# claude-code scrub-mode stubs'
known=(
  bunfig.toml package.json .npmrc .yarnrc .yarnrc.yml .gitmodules
  package-lock.json yarn.lock pnpm-lock.yaml
  .env .env.local .env.development .env.development.local
  .env.test .env.test.local .env.production .env.production.local
)

exclude=$(git rev-parse --git-path info/exclude 2>/dev/null || echo .git/info/exclude)
candidates=("${known[@]}")
has_block=false
if [ -f "$exclude" ] && grep -qxF "$marker" "$exclude"; then
  has_block=true
  while IFS= read -r entry; do
    candidates+=("${entry#/}")
  done < <(sed -n "/^${marker}\$/,\$p" "$exclude" | grep '^/' || true)
fi

removed=0
for path in $(printf '%s\n' "${candidates[@]}" | sort -u); do
  if [ -f "$path" ] && [ ! -s "$path" ] && ! git ls-files --error-unmatch -- "$path" >/dev/null 2>&1; then
    rm -f -- "$path"
    removed=$((removed + 1))
  fi
done

if [ "$has_block" = true ]; then
  # Drop the marker and everything after it, then trailing blank lines.
  sed -i "/^${marker}\$/,\$d" "$exclude"
  sed -i -e :a -e '/^\n*$/{$d;N;ba' -e '}' "$exclude"
fi

# Empty directories the CLI creates for its own bookkeeping.
for dir in .claude/commands .claude/.cc-writes; do
  rmdir "$dir" 2>/dev/null || true
done

[ "$removed" -gt 0 ] && echo "Removed $removed sandbox stub file(s)."
exit 0
