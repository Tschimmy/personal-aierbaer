# Personal Aierbaer — Agent Guide

Local-first macOS app that watches a ClickUp support inbox, runs a local **pi**
agent to draft solution reports, records the real resolution per ticket, and
exposes a local HTTP API + deep links so other tools can drive it.

**Name:** Personal Aierbaer (note the spelling: `aierbaer`, not `airbaer`).
Bundle id `com.aierbaer.personal`. URL scheme `aierbaer://`.

## Stack

- **Shell:** Tauri v2 (Rust). Entry `src-tauri/src/lib.rs` (`run()`), `main.rs` calls it.
- **UI:** React 19 + Vite + TypeScript, plain CSS in `src/styles.css` (theme vars, dark default + `[data-theme="light"]`).
- **Model:** local-first, **GitHub Copilot only** for v1 (`github-copilot/claude-opus-4.8` default).
- **pi:** user-installed global CLI, spawned as a child process. Not bundled.
- No test suite yet. Verify with `npm run build` (tsc+vite) and `cargo build`.

## Commands (Makefile)

- `make dev` → `npm run tauri dev`.
- `make fresh` → sandboxed onboarding test (see `test-onboarding.sh`): temp HOME +
  npm prefix so pi/skill/Copilot all read as missing; wipes WebKit localStorage so
  the wizard re-runs. Real setup untouched.
- `make deploy` → build `.app`, copy to `/Applications`, re-register `aierbaer://`
  with LaunchServices. **Deep links only work from the built app**, not `tauri dev`.
- `make new-version V=x.y.z` → bumps version in package.json, Cargo.toml,
  tauri.conf.json. Add the release-notes entry first (see Versioning).

## Layout

```
src/
  App.tsx                 orchestration: config, tasks, auto-solve, deep-link-solve, pushes runtime config to API
  inbox/Inbox.tsx         mail-style split, keyboard shortcuts, search, hide-resolved, footer
  inbox/ReportPane.tsx    report as section-card form, section nav, resolution form
  inbox/Settings.tsx      sectioned Preferences modal (ClickUp / Repo+Reports / Skills / Local API / Release notes)
  onboarding/Wizard.tsx   6 steps: pi, skill, Copilot, model+test, repo, ClickUp
  components/StatusBar.tsx footer legend (Keys renders + between modifier combos), right slot
  lib/api.ts              all invoke() wrappers + localStorage helpers
  lib/releaseNotes.ts     version history; APP_VERSION = RELEASES[0].version
src-tauri/src/
  lib.rs      commands + setup (manages ConfigState, ServerState; deep-link handler)
  clickup.rs  fetch_tasks, fetch_task_detail, fetch_teams, fetch_owner_options
  pi.rs       run_solve (spawns pi in the repo cwd, streams pi-output/pi-done), run_test
  reports.rs  find/list reports, upsert/remove Resolution, list_meta
  doctor.rs   check_pi/skill/copilot, install_pi/install_skill (writes BOTH skills), bundled skill consts
  copilot.rs  in-app GitHub device-code OAuth → writes ~/.pi/agent/auth.json
  api.rs      axum HTTP server (see API), RuntimeConfig, ApiSettings (port+token), ServerState
  assets/clickup-aierbaer-solve/SKILL.md   bundled via include_str!
  assets/aierbaer-api/SKILL.md             bundled via include_str!
```

## Skills

Two bundled skills, installed to `~/.claude/skills/` (respects `$HOME`):
- **clickup-aierbaer-solve** — how pi analyzes a ticket + writes the report;
  searches the reports dir for prior solutions, prefers ones with `## Resolution`.
- **aierbaer-api** — documents the HTTP API for external coding agents. Reads token
  from `$AIERBAER_TOKEN`/`$AIERBAER_PORT` or falls back to the app config file.

`install_skill` writes both. `check_skill` reports `up_to_date` only when BOTH match
their bundled `version:`. Skill updates surface in the wizard, Settings → Skills, and
a top-bar "Update skill" pill. **Bump the skill `version:` when you change a SKILL.md.**
The user's separate `clickup-solve` skill (other project) must stay untouched.

## Solve flow & storage

- Solve spawns `pi --print --model <m> --skill clickup-aierbaer-solve` with cwd =
  the Eversports repo. Prompt includes the context file, the reports dir, and the
  output path. Streams `pi-output` (per line) / `pi-done` events.
- Reports: `<reportsDir>/YYYY-MM-DD-clickup-<taskId>.md`. Default reports dir
  `~/Documents/Personal Aierbaer/Reports`; configurable in Settings.
- New unsolved tickets **auto-solve** once (App gates on report metadata; `attempted`
  ref prevents loops).

## Resolutions (the memory loop)

- `## Resolution` section appended to a report: `**Chosen:** <option>`,
  `**Resolved:** <date>`, notes. Set/edit/remove from the report or inbox.
- Resolved tickets show a green marker + `✓ Option X`; the skill reuses resolutions
  on future solves.

## Config & storage

- **Frontend localStorage** (`aierbaer.*`): clickup config, model, repo, reportsDir,
  theme, hideResolved, onboarded.
- App **pushes** a `RuntimeConfig` into Rust (`set_runtime_config`) on startup and
  whenever config changes, so the HTTP API can act without credentials in requests.
- **API settings** persisted by Rust at `~/Library/Application Support/com.aierbaer.personal/api.json`
  (`{port, token}`); token auto-generated, Regenerate in Settings.

## Local HTTP API (`api.rs`)

`http://127.0.0.1:<port>` (default 4849), localhost only, permissive CORS. Auth:
`X-Aierbaer-Token` (or `Authorization: Bearer`) on all routes except `/api/health`.
Routes: `GET /api/health|/api/inbox`, `GET /api/report/:id`,
`GET|POST|DELETE /api/resolution/:id`, `POST /api/solve/:id`. Changing port/token
restarts the server (ServerState). Footer shows a green dot + `API :<port>` when
healthy. Full docs in `API.md`.

## Deep links

`aierbaer://open/<taskId>` (focus + select ticket) and `aierbaer://solve/<taskId>`
(focus + start solve). Handled in `lib.rs::handle_deep_link` → emits
`deep-link-open`/`deep-link-solve`. **macOS registers the scheme only from the
bundled app** — run `make deploy`, not `tauri dev`. Runtime `register_all()` helps
Linux/Windows only. Known limitation: `open/<id>` only selects tickets already in
the fetched inbox (no on-demand single-ticket fetch yet).

## Keyboard model (Inbox)

Global: `⌘R` refresh, `⌘F` search, `⌘U` hide/show resolved, `⌘,` settings,
`⌘Space` solve. List: `j/k`/arrows navigate, `s` solve, `r` set solution,
`d` delete resolution, `Enter` focus report. Report focused: `j/k` step sections,
`g/G` first/last, `s`, `r`, `d`, `Esc` back. Resolution form: `1/2/3` pick option
(3 = Other → focuses textbox), `i` edit, `⌘Enter` save, `Esc` blur/cancel.
Footer legend is context-aware (`StatusBar` + `Keys`; combos joined with `+`).

## Versioning & release notes

- Current: **0.2.0** (0.1.0 was scaffold; 0.2.0 = first feature release).
- Edit `src/lib/releaseNotes.ts` (newest first) AND `CHANGELOG.md`, then
  `make new-version V=x.y.z`. In-app: Settings → Release notes; footer shows `v<version>`.
- Semver: pre-1.0 → features = minor bump, fixes = patch.

## Gotchas

- Deep links + scheme registration need the built app (`make deploy`).
- Renames: changing bundle id / localStorage keys resets config + re-runs onboarding.
- `data-tauri-drag-region` needs `core:window:allow-start-dragging` (in capabilities).
- macOS WKWebView localStorage lives under `~/Library/WebKit/personal-aierbaer`,
  NOT the sandbox `$HOME` — `test-onboarding.sh` wipes it to force the wizard.
- Copilot auth is replicated in `copilot.rs` (client id, token exchange). If pi
  changes its flow, this may need updating.

## Deferred / next ideas

- Shared team memory repo (git) instead of local reports (see ROADMAP.md P3).
- Slash-command trigger via a relay (ROADMAP P4).
- On-demand single-ticket fetch for `aierbaer://open` of tickets not in the inbox.
- Keychain for the API token instead of plaintext json.
- Auto "What's new" popup on version change.
