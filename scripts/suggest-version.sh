#!/usr/bin/env bash
# Ask a pi agent to pick the next semantic version from the changes since the
# last release tag. Prints ONLY the version (x.y.z) to stdout.
set -euo pipefail

cur=$(node -p "require('./package.json').version")
last=$(git describe --tags --match 'v*' --abbrev=0 2>/dev/null || echo "")
range=${last:+$last..HEAD}

log=$(git log ${range:-} --oneline 2>/dev/null || true)
stat=$(git diff ${range:-} --stat 2>/dev/null | tail -40 || true)

if [ -z "$log" ]; then
  # Nothing since the last tag — suggest a patch bump.
  echo "$cur" | awk -F. '{print $1"."$2"."$3+1}'
  exit 0
fi

prompt=$(cat <<EOF
You are selecting the next semantic version number for a software release.

Current version: $cur
Last release: ${last:-none}

Rules:
- MAJOR: incompatible / breaking changes.
- MINOR: new backward-compatible features.
- PATCH: only fixes, docs, chores.
- While < 1.0.0: features bump MINOR, fixes bump PATCH.

Commits since last release:
$log

Changed files:
$stat

Respond with ONLY the resulting version as x.y.z. No prose, no prefix, no quotes.
EOF
)

out=$(pi --print --model github-copilot/claude-opus-4.8 "$prompt" 2>/dev/null || true)
ver=$(printf '%s' "$out" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)

if [ -z "$ver" ]; then
  echo "could not determine version from pi output" >&2
  exit 1
fi
echo "$ver"
