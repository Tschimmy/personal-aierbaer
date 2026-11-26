# Solves run through the user's local Claude Code CLI

A solve spawns the user-installed `claude` CLI headless (`claude -p --output-format stream-json`) with the product repository as working directory, an `--allowedTools` whitelist and the bundled `clickup-aierbaer-solve` skill. The app does not call the Anthropic API itself and does not bundle the CLI. This keeps everything local, bills each engineer's own Claude subscription instead of an API key, and lets the agent use Claude Code's file and search tools on the real repo.

## Considered Options

- Before 0.8.0 the app spawned `pi` with GitHub Copilot models; it was replaced by Claude Code. Legacy `github-copilot/…` model ids are still migrated to `opus`.

## Consequences

- Onboarding must install the CLI, sign in and install the skills; skill versions are checked against the bundled copies.
