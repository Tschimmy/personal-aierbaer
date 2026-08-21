---
name: aierbaer-api
version: 1.1.0
description: "Interact with the Personal Aierbaer desktop app over its local HTTP API: list the ClickUp support inbox, read solution reports, read/set/remove a ticket's resolution, and trigger a solve. Use when the user asks to check the Aierbaer inbox, get a ticket's report or solution, mark a ticket solved with an option, or kick off solving a ClickUp ticket from a coding agent or their own dashboard."
allowed-tools: Bash(curl:*), Bash(jq:*)
user-invocable: true
---

# Personal Aierbaer API Skill

Personal Aierbaer is a local-first macOS app that watches a ClickUp support inbox,
runs a local pi agent to draft solution reports, and records the actual
resolution per ticket. While the app is open it exposes a local HTTP API so you
can drive it from any coding agent or dashboard.

- **Base URL:** `http://127.0.0.1:4849` (port configurable in the app's Settings)
- **Auth:** every request except `/api/health` needs header
  `X-Aierbaer-Token: <token>`.
- **Credentials:** the app already holds the ClickUp token; you never send it.

## Getting the token + port

Prefer the **`AIERBAER_TOKEN`** environment variable (and optional
`AIERBAER_PORT`). If they aren't set, fall back to the app's config file. Resolve
both once at the start of a session:

```bash
CFG="$HOME/Library/Application Support/com.aierbaer.personal/api.json"
PORT="${AIERBAER_PORT:-$(jq -r '.port' "$CFG" 2>/dev/null || echo 4849)}"
TOKEN="${AIERBAER_TOKEN:-$(jq -r '.token' "$CFG" 2>/dev/null)}"
BASE="http://127.0.0.1:$PORT"
AUTH=(-H "X-Aierbaer-Token: $TOKEN")
```

The token is also shown (with a Regenerate button) in the app under
Settings → Local API. If the user regenerated it, re-read the file.

Always check health first; if it fails, the app isn't running:

```bash
curl -s "$BASE/api/health"
```

All other calls include the token header:

```bash
curl -s "${AUTH[@]}" "$BASE/api/inbox" | jq
```

## Endpoints

### List the inbox
```bash
curl -s "${AUTH[@]}" "$BASE/api/inbox" | jq
```
Each item: `id`, `name`, `status`, `statusColor`, `url`, `list`, `tags`,
`dateUpdated`, `hasReport`, `resolved`, `choice` (the chosen resolution option,
or null).

Filter examples:
```bash
# Unresolved tickets only
curl -s "${AUTH[@]}" "$BASE/api/inbox" | jq '.items[] | select(.resolved==false)'
# Resolved tickets with their chosen option
curl -s "${AUTH[@]}" "$BASE/api/inbox" | jq '.items[] | select(.resolved) | {name, choice}'
```

### Read a ticket's report (markdown)
```bash
curl -s "${AUTH[@]}" "$BASE/api/report/<TASK_ID>" | jq -r '.markdown'
```
`markdown` is `null` when no report exists yet.

### Read a ticket's resolution
```bash
curl -s "${AUTH[@]}" "$BASE/api/resolution/<TASK_ID>" | jq
```
Returns `{ resolved, choice, notes }`.

### Trigger a solve (background)
```bash
curl -s "${AUTH[@]}" -X POST "$BASE/api/solve/<TASK_ID>"
```
Returns `202 Accepted` and runs the pi agent in the background. Poll the report
endpoint until `markdown` is populated:
```bash
until curl -s "${AUTH[@]}" "$BASE/api/report/<TASK_ID>" | jq -e '.markdown != null' >/dev/null; do sleep 3; done
```

### Set a resolution
Record which option actually fixed it so future solves reuse it.
```bash
curl -s "${AUTH[@]}" -X POST "$BASE/api/resolution/<TASK_ID>" \
  -H 'content-type: application/json' \
  -d '{"choice":"Option A","text":"Issued a fresh signup secret and sent the URL"}'
```
`choice` is usually one of the report's `### Option A/B ...` headings, or `Other`.
`text` is the free-text description of the real fix.

### Remove a resolution
```bash
curl -s "${AUTH[@]}" -X DELETE "$BASE/api/resolution/<TASK_ID>"
```

## Deep links

Open the app from a dashboard/browser:

- `aierbaer://open/<TASK_ID>` — focus Aierbaer on that ticket (selects it, shows the report).
- `aierbaer://solve/<TASK_ID>` — focus Aierbaer and start a solve for that ticket.

```bash
open "aierbaer://open/<TASK_ID>"
```

## Notes

- A `400` from `/api/inbox` or `/api/solve` means the app isn't configured yet
  (no ClickUp token) — tell the user to finish onboarding.
- Reports are markdown with fixed sections: Problem, Type, Root Cause / Analysis,
  Proposed Solutions (Option A/B), Open Questions, Verdict, and — once set — a
  `## Resolution` section.
- Prefer resolved tickets' `## Resolution` as the source of truth when advising.
