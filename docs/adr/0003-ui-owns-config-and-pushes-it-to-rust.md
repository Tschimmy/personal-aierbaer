# The UI owns configuration and pushes it into the Rust core

ClickUp credentials, owner, model, repository and reports directory are stored in the webview's localStorage (`aierbaer.*` keys), not by Rust. On startup and on every change the UI pushes them into Rust as `RuntimeConfig` (`set_runtime_config`), so the local HTTP API and deep links can solve and read reports without credentials in the request. Only the API's own port and token are persisted by Rust (`api.json`).

## Consequences

- Until the UI has started and pushed its config, the HTTP API cannot fetch tickets or solve.
- Changing the bundle id or the localStorage keys resets all configuration and re-runs onboarding.
