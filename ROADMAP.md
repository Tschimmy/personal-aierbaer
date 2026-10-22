# Personal Aierbaer — Roadmap

Local-first Mac app (Tauri v2 + React). ClickUp ticket inbox powered by Claude
Code running locally with each engineer's own Claude subscription. Self-feeding
markdown memory of solutions.

## Done
- **P0** — Tauri scaffold, native window + bear icon, Rust `spawn pi`
  (`clickup-solve` skill), ClickUp fetch ported to Rust, React inbox, deep-link
  `aierbaer://solve/<id>`.

## Next phases (deferred — pick up later)

### P1 — Report view + memory loop UI
- Parse report md into sections: Agent Suggestion / Real Reason / Status.
- Report view: read suggestion, edit "Real Reason", **Mark Solved**.
- ClickUp writeback: post comment + set status on mark-solved.

### P2 — Onboarding doctor (partly started in wizard)
- Wizard steps: Claude Code installed + signed in → skill version → ClickUp connect.
- Store ClickUp token in OS keychain (not localStorage).
- Skill version check: compare `~/.claude/skills/clickup-solve` frontmatter
  `version:` vs bundled canonical copy; offer update/copy.

### P3 — Shared memory (git repo)
- Clone shared reports repo on onboarding.
- File-per-ticket (`YYYY-MM-DD-clickup-<id>.md`) → near-zero rebase conflicts.
- Flow: pull --rebase before analyze; on mark-solved commit + pull-rebase-push
  (3x retry loop for races). Auto-writeback decision still open.
- Claude reads whole repo → cross-team pattern detection.

### P4 — Triggers + distribution
- Deep-link OS registration (Info.plist url scheme) — v1 trigger.
- Slash command via minimal poll relay (Cloudflare Worker), ids only, no ticket
  data on relay. Deferred behind deep-link.
- `tauri-plugin-updater` auto-update, code-sign + notarize `.dmg`.

## Decisions locked
- Shell: **Tauri v2** (speed/size over Electron).
- Model: **local-first, Claude Code subscription** (default alias `opus`; was pi + Copilot before 0.8.0).
- Skill dir: `~/.claude/skills`.
- v1 trigger: **deep link only** (slash command → P4).
- UI: React + Vite. Name: **Personal Aierbaer**, id `com.aierbaer.personal`.
