use crate::clickup::ClickUpTaskDetail;
use anyhow::Result;
use std::path::PathBuf;
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

/// Render task detail into a self-contained context file for the solver skill.
fn render_context(d: &ClickUpTaskDetail) -> String {
    let tags = if d.tags.is_empty() { "(none)".into() } else { d.tags.join(", ") };
    let comments = if d.comments.is_empty() {
        "(no comments)".to_string()
    } else {
        d.comments
            .iter()
            .map(|c| format!("### {}\n\n{}", c.user, c.text))
            .collect::<Vec<_>>()
            .join("\n\n")
    };
    format!(
        "# ClickUp Task Context\n\n\
- **ID:** {}\n\
- **Name:** {}\n\
- **URL:** {}\n\
- **Status:** {}\n\
- **Priority:** {}\n\
- **Location:** {} / {} / {}\n\
- **Tags:** {}\n\n\
## Description\n\n{}\n\n## Comments\n\n{}\n",
        d.id,
        d.name,
        d.url,
        d.status,
        d.priority.clone().unwrap_or_else(|| "(none)".into()),
        d.space,
        d.folder,
        d.list,
        tags,
        if d.description.is_empty() { "(no description provided)" } else { &d.description },
        comments,
    )
}

/// PATH augmentation so we find a user-installed `pi` (npm global / homebrew /
/// nvm / fnm / volta). Delegates to the shared login-shell resolver.
use crate::env_path::augmented_path;

/// Spawn `pi` with the clickup-aierbaer-solve skill. Streams stdout lines to the frontend
/// via the `pi-output` event, writes the report to `report_path`, returns exit ok.
pub async fn run_solve(
    app: &AppHandle,
    detail: &ClickUpTaskDetail,
    reports_dir: &PathBuf,
    model: &str,
    repo: Option<&str>,
) -> Result<PathBuf> {
    tokio::fs::create_dir_all(reports_dir).await?;

    let context_path = std::env::temp_dir().join(format!("aierbaer-solve-{}.md", detail.id));
    tokio::fs::write(&context_path, render_context(detail)).await?;

    let date = chrono::Local::now().format("%Y-%m-%d").to_string();
    let report_path = reports_dir.join(format!("{date}-clickup-{}.md", detail.id));

    let prompt = format!(
        "Analyze the ClickUp task described in the context file and propose solutions. \
Before analyzing from scratch, search the existing reports directory for prior solutions to \
similar or identical issues and reuse/reference them when they apply — especially reports that \
contain a '## Resolution' section, which records the actual fix that worked. \
Context file: {}. Existing reports directory: {}. Write the report to: {}",
        context_path.display(),
        reports_dir.display(),
        report_path.display()
    );

    let mut command = Command::new("pi");
    command
        .args([
            "--print",
            "--model",
            model,
            "--skill",
            "clickup-aierbaer-solve",
            &prompt,
        ])
        .env("PATH", augmented_path())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Run the agent inside the target repo so its tools see that codebase.
    if let Some(dir) = repo {
        if !dir.is_empty() {
            command.current_dir(dir);
        }
    }
    let mut child = command.spawn()?;

    let task_id = detail.id.clone();

    if let Some(stdout) = child.stdout.take() {
        let mut lines = BufReader::new(stdout).lines();
        let app2 = app.clone();
        let tid = task_id.clone();
        tokio::spawn(async move {
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app2.emit("pi-output", serde_json::json!({ "taskId": tid, "line": line }));
            }
        });
    }

    let status = child.wait().await?;
    let _ = app.emit(
        "pi-done",
        serde_json::json!({ "taskId": task_id, "ok": status.success(), "report": report_path.to_string_lossy() }),
    );

    if !status.success() {
        return Err(anyhow::anyhow!("pi exited with status {:?}", status.code()));
    }
    Ok(report_path)
}

/// Quick smoke test: run pi once with a trivial prompt and return its stdout.
/// Empty/err stdout means the agent didn't respond.
pub async fn run_test(model: &str) -> Result<String, String> {
    let out = Command::new("pi")
        .args([
            "--print",
            "--model",
            model,
            "Reply with exactly: Hello World",
        ])
        .env("PATH", augmented_path())
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}
