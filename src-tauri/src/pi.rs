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

use std::collections::HashSet;
use std::sync::{Arc, Mutex, OnceLock};

/// Registry of live pi child PIDs so we can kill leftovers when the app quits.
/// Without this, a solve in flight when the app closes is reparented to launchd
/// and leaks (orphaned `pi` processes under `ppid 1`).
static CHILDREN: OnceLock<Arc<Mutex<HashSet<u32>>>> = OnceLock::new();

fn registry() -> &'static Arc<Mutex<HashSet<u32>>> {
    CHILDREN.get_or_init(|| Arc::new(Mutex::new(HashSet::new())))
}

fn register(pid: u32) {
    if let Ok(mut s) = registry().lock() {
        s.insert(pid);
    }
}

fn unregister(pid: u32) {
    if let Ok(mut s) = registry().lock() {
        s.remove(&pid);
    }
}

/// Kill every still-running pi child and its process group. Called on app exit so
/// no solve is left orphaned. Negative pid targets the whole group, taking down
/// the bash/grep helpers pi spawned too.
pub fn kill_all() {
    let pids: Vec<u32> = registry()
        .lock()
        .map(|s| s.iter().copied().collect())
        .unwrap_or_default();
    for pid in pids {
        let _ = std::process::Command::new("kill")
            .arg("-TERM")
            .arg(format!("-{pid}"))
            .status();
    }
}

/// Shorten a string to a single line of at most `max` chars for display.
fn short(s: &str, max: usize) -> String {
    let one = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if one.chars().count() > max {
        format!("{}…", one.chars().take(max).collect::<String>())
    } else {
        one
    }
}

fn basename(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).to_string()
}

/// Turn a running tool call into a human step label from its name + args.
fn tool_label(name: &str, args: &serde_json::Value) -> String {
    let a = |k: &str| args.get(k).and_then(|v| v.as_str()).unwrap_or("");
    match name.to_ascii_lowercase().as_str() {
        "bash" => {
            let cmd = a("command");
            if cmd.is_empty() { "Running a command…".into() } else { format!("Running: {}", short(cmd, 60)) }
        }
        "read" => {
            let p = a("path");
            if p.is_empty() { "Reading a file…".into() } else { format!("Reading {}", basename(p)) }
        }
        "write" => "Writing the report…".into(),
        "edit" => {
            let p = a("path");
            if p.is_empty() { "Editing a file…".into() } else { format!("Editing {}", basename(p)) }
        }
        "grep" | "glob" => {
            let pat = if !a("pattern").is_empty() { a("pattern") } else { a("query") };
            if pat.is_empty() { "Searching the codebase…".into() } else { format!("Searching for \"{}\"", short(pat, 40)) }
        }
        "list" | "ls" => "Listing files…".into(),
        other => format!("Using {other}…"),
    }
}

/// Derive a short progress label from one pi `--mode json` event, or None if the
/// event isn't worth surfacing.
fn progress_label(v: &serde_json::Value) -> Option<String> {
    match v.get("type").and_then(|t| t.as_str()) {
        Some("agent_start") => Some("Starting up…".into()),
        Some("tool_execution_start") => {
            let name = v.get("toolName").and_then(|n| n.as_str()).unwrap_or("tool");
            let args = v.get("args").cloned().unwrap_or(serde_json::Value::Null);
            Some(tool_label(name, &args))
        }
        Some("message_update") => match v
            .get("assistantMessageEvent")
            .and_then(|e| e.get("type"))
            .and_then(|t| t.as_str())
        {
            Some("thinking_start") => Some("Thinking…".into()),
            Some("text_start") => Some("Writing the report…".into()),
            _ => None,
        },
        Some("agent_end") => Some("Finishing up…".into()),
        _ => None,
    }
}

/// Spawn `pi` with the clickup-aierbaer-solve skill. Streams progress steps to the
/// frontend via the `pi-progress` event, writes the report to `report_path`.
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
            "--mode",
            "json",
            "--model",
            model,
            "--skill",
            "clickup-aierbaer-solve",
            &prompt,
        ])
        .env("PATH", augmented_path())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Own process group so kill_all can take down pi + its bash/grep helpers.
        .process_group(0)
        // Kill pi if this future is dropped (e.g. solve cancelled).
        .kill_on_drop(true);
    // Run the agent inside the target repo so its tools see that codebase.
    if let Some(dir) = repo {
        if !dir.is_empty() {
            if !std::path::Path::new(dir).is_dir() {
                return Err(anyhow::anyhow!(
                    "Repository folder not found: {dir}. Set a valid repo path in Settings → Repo & Reports."
                ));
            }
            command.current_dir(dir);
        }
    }
    let mut child = command.spawn()?;
    let pid = child.id();
    if let Some(pid) = pid {
        register(pid);
    }

    let task_id = detail.id.clone();

    // Parse pi's json event stream into human progress steps. Only emit when the
    // label changes, so the UI shows the current step without flicker.
    if let Some(stdout) = child.stdout.take() {
        let mut lines = BufReader::new(stdout).lines();
        let app2 = app.clone();
        let tid = task_id.clone();
        tokio::spawn(async move {
            let mut last = String::new();
            while let Ok(Some(line)) = lines.next_line().await {
                let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
                if let Some(step) = progress_label(&v) {
                    if step != last {
                        last = step.clone();
                        let _ = app2.emit(
                            "pi-progress",
                            serde_json::json!({ "taskId": tid, "step": step }),
                        );
                    }
                }
            }
        });
    }

    // Drain stderr concurrently: without this the pipe buffer can fill and hang
    // pi. Keep the lines for the error message.
    let stderr_buf = Arc::new(Mutex::new(Vec::<String>::new()));
    if let Some(stderr) = child.stderr.take() {
        let mut lines = BufReader::new(stderr).lines();
        let buf = stderr_buf.clone();
        tokio::spawn(async move {
            while let Ok(Some(line)) = lines.next_line().await {
                if let Ok(mut b) = buf.lock() {
                    b.push(line);
                }
            }
        });
    }

    let status = child.wait().await?;
    if let Some(pid) = pid {
        unregister(pid);
    }
    let _ = app.emit(
        "pi-done",
        serde_json::json!({ "taskId": task_id, "ok": status.success(), "report": report_path.to_string_lossy() }),
    );

    if !status.success() {
        let stderr = stderr_buf
            .lock()
            .map(|b| b.join("\n"))
            .unwrap_or_default();
        let detail = stderr.trim();
        if detail.is_empty() {
            return Err(anyhow::anyhow!("pi exited with status {:?}", status.code()));
        }
        return Err(anyhow::anyhow!(
            "pi exited with status {:?}: {}",
            status.code(),
            detail
        ));
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
