#!/usr/bin/env bash
# Have a pi agent write the release notes for a version, based on the changes
# since the last release tag, editing src/lib/releaseNotes.ts + CHANGELOG.md.
# No-op if an entry for the version already exists.
set -euo pipefail

VER="${1:?usage: release-notes.sh x.y.z}"

if grep -q "version: \"$VER\"" src/lib/releaseNotes.ts 2>/dev/null; then
  echo "release notes for v$VER already present"
  exit 0
fi

last=$(git describe --tags --match 'v*' --abbrev=0 2>/dev/null || echo "")
range=${last:+$last..HEAD}
today=$(date +%Y-%m-%d)
log=$(git log ${range:-} --oneline 2>/dev/null || true)
stat=$(git diff ${range:-} --stat 2>/dev/null | tail -60 || true)

echo "Generating release notes for v$VER with pi..."

prompt=$(cat <<EOF
Write user-facing release notes for version $VER (date $today) of this app and
edit two files directly:

1. src/lib/releaseNotes.ts — insert a NEW entry as the FIRST element of the
   RELEASES array, matching the existing object shape exactly:
     { version: "$VER", date: "$today", sections: [ { heading: "...", items: ["...", "..."] }, ... ] }
   Keep valid TypeScript. Group the changes into 1-3 headings with concise,
   user-facing bullet items (what changed for the user, not commit messages).

2. CHANGELOG.md — add a matching section '## [$VER] — $today' immediately after
   the intro paragraph, using '### Heading' + bullet lists with the same content.

Base the notes ONLY on these changes since ${last:-the start}:

Commits:
$log

Changed files:
$stat

Do not modify anything else. Do not bump version numbers. Keep it concise.
EOF
)

pi --print --model github-copilot/claude-opus-4.8 "$prompt" >/dev/null 2>&1 || true

if ! grep -q "version: \"$VER\"" src/lib/releaseNotes.ts 2>/dev/null; then
  echo "pi did not add a v$VER entry to src/lib/releaseNotes.ts" >&2
  exit 1
fi
echo "release notes for v$VER written"
