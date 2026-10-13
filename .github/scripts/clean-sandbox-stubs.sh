#!/usr/bin/env bash
# Removes the placeholder files Claude Code creates in scrub mode.
#
# With CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1 the CLI runs Bash inside a sandbox and, to stop
# sandboxed processes from planting config files (package.json, .npmrc, .env, ...), it
# creates empty stubs for the missing ones in the launch directory and lists them under
# "# claude-code scrub-mode stubs" in .git/info/exclude. They are left behind after exit.
# This script deletes only empty, untracked files from that list, then drops the block,
# so a real file (for example the root package.json) is never touched or hidden from git.
set -euo pipefail

exclude=.git/info/exclude
marker='# claude-code scrub-mode stubs'
[ -f "$exclude" ] && grep -qxF "$marker" "$exclude" || exit 0

removed=0
while IFS= read -r entry; do
  path="${entry#/}"
  [ -n "$path" ] || continue
  if [ -f "$path" ] && [ ! -s "$path" ] && ! git ls-files --error-unmatch -- "$path" >/dev/null 2>&1; then
    rm -f -- "$path"
    removed=$((removed + 1))
  fi
done < <(sed -n "/^${marker}\$/,\$p" "$exclude" | grep '^/' || true)

# Drop the marker and everything after it, then trailing blank lines.
sed -i "/^${marker}\$/,\$d" "$exclude"
sed -i -e :a -e '/^\n*$/{$d;N;ba' -e '}' "$exclude"

# Empty directories the CLI creates for its own bookkeeping.
for dir in .claude/commands .claude/.cc-writes .git/glab-cli; do
  rmdir "$dir" 2>/dev/null || true
done

echo "Removed $removed sandbox stub file(s)."
