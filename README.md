<div align="center">

<img src="src-tauri/icons/icon.png" width="140" alt="Personal Aierbaer" />

# Personal Aierbaer

**A local-first macOS app that turns your ClickUp support inbox into an AI-assisted, self-improving solution desk.**

</div>

---

Personal Aierbaer watches your ClickUp support inbox. For each ticket, a local
[**pi**](https://github.com/earendil-works) agent reads it, looks at your repo
and past solutions, and drafts a structured **solution report**. You review it,
record which option actually fixed it, and those resolutions become a memory the
agent reuses on similar tickets later.

Everything runs on your Mac, on your GitHub Copilot subscription. A local HTTP
API and deep links let other agents or your own dashboard build on top of it.

## Highlights

- 🐻 **Native macOS app** (Tauri v2 + React) — real window, dock icon, deep links.
- 🤖 **Auto-solve** — new tickets get analyzed hands-free; reports appear on their own.
- 📝 **Structured reports** rendered as a form (Problem, Root cause, Options, Verdict).
- ✅ **Resolutions** — record the real fix; resolved tickets go green and feed the agent's memory.
- ⌨️ **Keyboard-driven** — Vim-style navigation, context-aware shortcut legend.
- 🔌 **Local HTTP API** — drive the inbox/reports/resolutions from any tool.
- 🧩 **pi skills** — `clickup-aierbaer-solve` (the analyzer) and `aierbaer-api` (so other agents can talk to the app).
- 🔗 **Deep links** — `aierbaer://open/<id>` and `aierbaer://solve/<id>`.
- 🌗 **Dark / light theme.**

## Getting started

Requirements: macOS, [pi](https://github.com/earendil-works) CLI, a GitHub
Copilot subscription, Rust + Node.

```bash
make dev      # run in development
make deploy   # build .app → /Applications, register the aierbaer:// scheme
```

On first launch the onboarding wizard walks you through: pi agent → skills →
GitHub Copilot login → model + test → repository → ClickUp.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `j` / `k` / ↑ / ↓ | navigate tickets (or report sections when focused) |
| `Enter` | focus the report |
| `s` | solve / re-solve |
| `r` | set the resolution |
| `d` | delete the resolution |
| `⌘C` | copy the selected ticket ID |
| `⌘F` | search · `⌘U` hide resolved · `⌘R` refresh · `⌘,` settings |

In the resolution form: `1` / `2` / `3` pick the option, `i` edit notes,
`⌘Enter` save, `Esc` cancel.

## Local API

While the app is open it serves `http://127.0.0.1:<port>` (default `4849`),
localhost only, guarded by a personal token (Settings → Local API).

```bash
curl -s -H "X-Aierbaer-Token: $AIERBAER_TOKEN" http://127.0.0.1:4849/api/inbox | jq
```

Endpoints: `/api/health`, `/api/inbox`, `/api/report/:id`,
`/api/resolution/:id` (GET/POST/DELETE), `/api/solve/:id`. Full docs in
**[API.md](API.md)**. Any coding agent can use the bundled **aierbaer-api** skill
to talk to the app for you.

## Versioning

Semantic versioning. Release notes live in the app (Settings → Release notes),
in **[CHANGELOG.md](CHANGELOG.md)**, and `src/lib/releaseNotes.ts`. Bump with:

```bash
make new-version V=x.y.z
```

## More docs

- **[AGENTS.md](AGENTS.md)** — architecture & conventions (start here to contribute).
- **[API.md](API.md)** — HTTP API reference.
- **[ROADMAP.md](ROADMAP.md)** — what's next.
- **[CHANGELOG.md](CHANGELOG.md)** — release history.

---

<div align="center">
<sub>Local-first. Your tickets, your repo, your Copilot — nothing leaves your Mac except the ClickUp calls you already make.</sub>
</div>
