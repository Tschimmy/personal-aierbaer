# Reports and resolutions are plain markdown files, not a database

Each solve writes one file `<reportsDir>/YYYY-MM-DD-clickup-<taskId>.md`, and the resolution is a `## Resolution` section appended to that same file (`**Chosen:**`, `**Resolved:**`, notes). There is no index or database: the app derives inbox state (resolved, chosen option) by scanning filenames and parsing the newest file per ticket (`reports.rs`). We chose files so the Claude Code agent can search prior solutions with its normal file tools, a human can read and edit them, and the folder can later become a shared git repo with one file per ticket (ROADMAP P3) without merge conflicts.

## Consequences

- The filename pattern and the `## Resolution` / `**Chosen:**` markers are a contract between the solve skill, the Rust parser and the UI parser. Changing any of them breaks resolution detection for existing reports.
- `## Resolution` must stay the last section; upsert and remove cut the file at it.
