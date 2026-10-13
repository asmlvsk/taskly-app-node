#!/usr/bin/env bash
# Creates or updates the single "sticky" test-agent comment on a pull request.
# Usage: post-comment.sh <pr-number> <markdown-file>   (requires GH_TOKEN and GITHUB_REPOSITORY)
set -euo pipefail

pr="$1"
file="$2"
marker='<!-- taskly-test-agent -->'
repo="${GITHUB_REPOSITORY:?}"

existing=$(gh api "repos/$repo/issues/$pr/comments" --paginate --jq \
  ".[] | select(.user.type == \"Bot\" and (.body | startswith(\"$marker\"))) | .id" | head -n 1 || true)

if [ -n "$existing" ]; then
  gh api -X PATCH "repos/$repo/issues/comments/$existing" -F body=@"$file" > /dev/null
  echo "Updated comment $existing"
else
  gh api -X POST "repos/$repo/issues/$pr/comments" -F body=@"$file" > /dev/null
  echo "Created comment"
fi
