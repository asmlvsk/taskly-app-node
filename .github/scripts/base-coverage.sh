#!/usr/bin/env bash
# Measures line/branch coverage of the base branch, for the coverage ratchet.
# Usage: base-coverage.sh <base-sha>
#
# Checks the base commit out into a temporary git worktree and runs both suites with
# coverage there. Dependencies are reused from the PR checkout when the lock file is
# identical (the common case), otherwise installed with `npm ci`. The Prisma client is
# generated code outside node_modules, so it is copied or regenerated the same way.
# The base commit is trusted code (it is already on the target branch).
#
# Writes .agent/base/<pkg>-coverage-summary.json. Never fails the step: a missing
# summary just means the ratchet is skipped for that package.
set -uo pipefail

base="$1"
root="$(pwd)"
tree="$root/.agent/base-tree"
out="$root/.agent/base"
mkdir -p "$out"

git worktree remove --force "$tree" >/dev/null 2>&1 || true
rm -rf "$tree"
git worktree add --detach "$tree" "$base" >/dev/null || { echo "::warning::Cannot check out $base"; exit 0; }
trap 'git -C "$root" worktree remove --force "$tree" >/dev/null 2>&1 || rm -rf "$tree"; git -C "$root" worktree prune' EXIT

for pkg in backend frontend; do
  echo "::group::base coverage: $pkg"
  if [ ! -f "$tree/$pkg/package.json" ]; then echo "No $pkg in base"; echo "::endgroup::"; continue; fi

  if cmp -s "$root/$pkg/package-lock.json" "$tree/$pkg/package-lock.json" && [ -d "$root/$pkg/node_modules" ]; then
    ln -s "$root/$pkg/node_modules" "$tree/$pkg/node_modules"
  else
    (cd "$tree/$pkg" && npm ci --no-audit --no-fund >/dev/null 2>&1) || { echo "::warning::npm ci failed for base $pkg"; echo "::endgroup::"; continue; }
  fi

  if [ "$pkg" = backend ]; then
    if cmp -s "$root/backend/prisma/schema.prisma" "$tree/backend/prisma/schema.prisma" && [ -d "$root/backend/src/generated" ]; then
      cp -R "$root/backend/src/generated" "$tree/backend/src/generated"
    else
      (cd "$tree/backend" && ./node_modules/.bin/prisma generate >/dev/null 2>&1) || true
    fi
  fi

  (cd "$tree/$pkg" && npx vitest run --coverage --coverage.reporter=json-summary --coverage.reportsDirectory=coverage-base >/dev/null 2>&1)
  if [ -f "$tree/$pkg/coverage-base/coverage-summary.json" ]; then
    cp "$tree/$pkg/coverage-base/coverage-summary.json" "$out/$pkg-coverage-summary.json"
    node -e "const t=require('$out/$pkg-coverage-summary.json').total;console.log('$pkg base: lines',t.lines.pct,'branches',t.branches.pct)"
  else
    echo "::warning::No base coverage for $pkg (the base suite may be failing)"
  fi
  echo "::endgroup::"
done
exit 0
