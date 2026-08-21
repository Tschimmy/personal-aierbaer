//! Local report storage lookups. Reports are named `YYYY-MM-DD-clickup-<id>.md`.

use std::path::{Path, PathBuf};

fn parse(name: &str) -> Option<(String, String)> {
    // <date:10>-clickup-<id>.md
    let rest = name.strip_suffix(".md")?;
    let idx = rest.find("-clickup-")?;
    let date = rest.get(..idx)?;
    if date.len() != 10 || date.as_bytes().get(4) != Some(&b'-') {
        return None;
    }
    let id = &rest[idx + "-clickup-".len()..];
    if id.is_empty() {
        return None;
    }
    Some((date.to_string(), id.to_string()))
}

/// Newest report file for a task id, if any.
pub async fn find_report(dir: &Path, task_id: &str) -> Option<PathBuf> {
    let mut rd = tokio::fs::read_dir(dir).await.ok()?;
    let mut best: Option<(String, PathBuf)> = None;
    while let Ok(Some(e)) = rd.next_entry().await {
        let name = e.file_name().to_string_lossy().to_string();
        if let Some((date, id)) = parse(&name) {
            if id == task_id {
                let replace = best.as_ref().map(|(d, _)| date > *d).unwrap_or(true);
                if replace {
                    best = Some((date, e.path()));
                }
            }
        }
    }
    best.map(|(_, p)| p)
}

/// All task ids that currently have a report on disk.
pub async fn list_ids(dir: &Path) -> Vec<String> {
    let mut ids = Vec::new();
    if let Ok(mut rd) = tokio::fs::read_dir(dir).await {
        while let Ok(Some(e)) = rd.next_entry().await {
            let name = e.file_name().to_string_lossy().to_string();
            if let Some((_, id)) = parse(&name) {
                if !ids.contains(&id) {
                    ids.push(id);
                }
            }
        }
    }
    ids
}

/// Insert or replace a `## Resolution` section at the end of a report file.
pub async fn upsert_resolution(
    path: &Path,
    choice: &str,
    text: &str,
    date: &str,
) -> std::io::Result<()> {
    let content = tokio::fs::read_to_string(path).await?;
    // Drop any existing Resolution section (kept last by convention).
    let base = match content.find("\n## Resolution") {
        Some(i) => content[..i].trim_end().to_string(),
        None => content.trim_end().to_string(),
    };
    let body = text.trim();
    let section = format!(
        "\n\n## Resolution\n\n**Chosen:** {choice}\n**Resolved:** {date}\n\n{body}\n",
    );
    tokio::fs::write(path, format!("{base}{section}")).await
}

#[derive(serde::Serialize)]
pub struct ReportMeta {
    pub id: String,
    pub resolved: bool,
    pub choice: Option<String>,
}

/// Per-task report metadata (newest report each): resolved flag + chosen option.
pub async fn list_meta(dir: &Path) -> Vec<ReportMeta> {
    // newest file per id
    let mut best: std::collections::HashMap<String, (String, PathBuf)> = std::collections::HashMap::new();
    if let Ok(mut rd) = tokio::fs::read_dir(dir).await {
        while let Ok(Some(e)) = rd.next_entry().await {
            let name = e.file_name().to_string_lossy().to_string();
            if let Some((date, id)) = parse(&name) {
                let replace = best.get(&id).map(|(d, _)| date > *d).unwrap_or(true);
                if replace {
                    best.insert(id, (date, e.path()));
                }
            }
        }
    }
    let mut out = Vec::new();
    for (id, (_, path)) in best {
        let content = tokio::fs::read_to_string(&path).await.unwrap_or_default();
        let resolved = content.contains("\n## Resolution");
        let choice = content
            .lines()
            .find_map(|l| l.trim().strip_prefix("**Chosen:**").map(|s| s.trim().to_string()));
        out.push(ReportMeta { id, resolved, choice });
    }
    out
}

/// Remove the `## Resolution` section from a report file (if present).
pub async fn remove_resolution(path: &Path) -> std::io::Result<()> {
    let content = tokio::fs::read_to_string(path).await?;
    let base = match content.find("\n## Resolution") {
        Some(i) => format!("{}\n", content[..i].trim_end()),
        None => content,
    };
    tokio::fs::write(path, base).await
}
