use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};

const CLICKUP_API: &str = "https://api.clickup.com/api/v2";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClickUpTask {
    pub id: String,
    pub name: String,
    pub status: String,
    pub status_color: String,
    pub url: String,
    pub date_created: String,
    pub date_updated: String,
    pub list: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClickUpTaskDetail {
    pub id: String,
    pub name: String,
    pub status: String,
    pub priority: Option<String>,
    pub url: String,
    pub description: String,
    pub space: String,
    pub folder: String,
    pub list: String,
    pub tags: Vec<String>,
    pub comments: Vec<Comment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Comment {
    pub user: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Team {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OwnerOption {
    pub name: String,
    /// orderindex — the value the tasks filter matches on.
    pub value: i64,
}

/// The selectable values of the "Owner" drop-down custom field. Workspace-level
/// fields aren't returned by the team field endpoint, so we read the options
/// from a task's field definition (present regardless of the task's own value).
pub async fn fetch_owner_options(
    token: &str,
    team_id: &str,
    field_id: &str,
) -> Result<Vec<OwnerOption>> {
    let client = reqwest::Client::new();
    let res = client
        .get(format!("{CLICKUP_API}/team/{team_id}/task"))
        .header("Authorization", token)
        .header("Content-Type", "application/json")
        .query(&[("page", "0"), ("include_closed", "true")])
        .send()
        .await?;
    if !res.status().is_success() {
        return Err(anyhow!("ClickUp task error: {}", res.status()));
    }
    let data: serde_json::Value = res.json().await?;
    for task in data["tasks"].as_array().cloned().unwrap_or_default() {
        for f in task["custom_fields"].as_array().cloned().unwrap_or_default() {
            if f["id"].as_str() == Some(field_id) {
                let opts = f["type_config"]["options"].as_array().cloned().unwrap_or_default();
                let mut out = Vec::new();
                for (i, o) in opts.iter().enumerate() {
                    let value = o["orderindex"].as_i64().unwrap_or(i as i64);
                    let name = o["name"].as_str().unwrap_or_default().to_string();
                    if !name.is_empty() {
                        out.push(OwnerOption { name, value });
                    }
                }
                return Ok(out);
            }
        }
    }
    Ok(Vec::new())
}

/// List the workspaces (teams) the token can access — for the onboarding dropdown.
pub async fn fetch_teams(token: &str) -> Result<Vec<Team>> {
    let client = reqwest::Client::new();
    let res = client
        .get(format!("{CLICKUP_API}/team"))
        .header("Authorization", token)
        .header("Content-Type", "application/json")
        .send()
        .await?;
    if !res.status().is_success() {
        return Err(anyhow!("ClickUp team list error: {}", res.status()));
    }
    let data: serde_json::Value = res.json().await?;
    Ok(data["teams"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|t| Team {
                    id: t["id"].as_str().unwrap_or_default().to_string(),
                    name: t["name"].as_str().unwrap_or_default().to_string(),
                })
                .collect()
        })
        .unwrap_or_default())
}

/// Config the frontend passes in (later: load from keychain / settings file).
#[derive(Debug, Clone, Deserialize)]
pub struct ClickUpConfig {
    pub token: String,
    pub team_id: String,
    pub owner_field_id: String,
    pub owner_value: i64,
}

fn status_order(status: &str) -> f32 {
    match status.to_lowercase().trim() {
        "open" | "to do" => 0.0,
        "in progress" => 1.0,
        "to clarify" => 2.0,
        _ => 1.5,
    }
}

/// Fetch open tasks filtered by the Owner custom field, sorted by status.
pub async fn fetch_tasks(cfg: &ClickUpConfig) -> Result<Vec<ClickUpTask>> {
    let client = reqwest::Client::new();
    let custom_fields = serde_json::to_string(&serde_json::json!([{
        "field_id": cfg.owner_field_id,
        "operator": "=",
        "value": cfg.owner_value
    }]))?;

    let mut all: Vec<ClickUpTask> = Vec::new();
    let mut page = 0;

    loop {
        let url = format!("{CLICKUP_API}/team/{}/task", cfg.team_id);
        let res = client
            .get(&url)
            .header("Authorization", &cfg.token)
            .header("Content-Type", "application/json")
            .query(&[
                ("page", page.to_string()),
                ("include_closed", "false".into()),
                ("custom_fields", custom_fields.clone()),
                ("order_by", "updated".into()),
            ])
            .send()
            .await?;

        if !res.status().is_success() {
            return Err(anyhow!("ClickUp API error: {}", res.status()));
        }

        let data: serde_json::Value = res.json().await?;
        let tasks = data["tasks"].as_array().cloned().unwrap_or_default();
        let count = tasks.len();

        for t in tasks {
            all.push(ClickUpTask {
                id: t["id"].as_str().unwrap_or_default().to_string(),
                name: t["name"].as_str().unwrap_or_default().to_string(),
                status: t["status"]["status"].as_str().unwrap_or_default().to_string(),
                status_color: t["status"]["color"].as_str().unwrap_or_default().to_string(),
                url: t["url"].as_str().unwrap_or_default().to_string(),
                date_created: t["date_created"].as_str().unwrap_or_default().to_string(),
                date_updated: t["date_updated"].as_str().unwrap_or_default().to_string(),
                list: t["list"]["name"].as_str().unwrap_or_default().to_string(),
                tags: t["tags"]
                    .as_array()
                    .map(|a| a.iter().filter_map(|x| x["name"].as_str().map(String::from)).collect())
                    .unwrap_or_default(),
            });
        }

        let last_page = data["last_page"].as_bool().unwrap_or(true);
        page += 1;
        if last_page || count == 0 || page > 10 {
            break;
        }
    }

    all.sort_by(|a, b| {
        status_order(&a.status)
            .partial_cmp(&status_order(&b.status))
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    Ok(all
        .into_iter()
        .filter(|t| {
            let s = t.status.to_lowercase();
            s != "done" && s != "closed" && s != "complete"
        })
        .collect())
}

/// Fetch full detail (description + comments) for one task.
pub async fn fetch_task_detail(token: &str, task_id: &str) -> Result<ClickUpTaskDetail> {
    let client = reqwest::Client::new();

    let url = format!("{CLICKUP_API}/task/{task_id}");
    let res = client
        .get(&url)
        .header("Authorization", token)
        .header("Content-Type", "application/json")
        .query(&[("include_markdown_description", "true")])
        .send()
        .await?;

    if !res.status().is_success() {
        return Err(anyhow!("ClickUp task detail error: {}", res.status()));
    }
    let t: serde_json::Value = res.json().await?;

    let mut comments = Vec::new();
    if let Ok(cres) = client
        .get(format!("{CLICKUP_API}/task/{task_id}/comment"))
        .header("Authorization", token)
        .header("Content-Type", "application/json")
        .send()
        .await
    {
        if cres.status().is_success() {
            if let Ok(cdata) = cres.json::<serde_json::Value>().await {
                if let Some(arr) = cdata["comments"].as_array() {
                    comments = arr
                        .iter()
                        .map(|c| Comment {
                            user: c["user"]["username"].as_str().unwrap_or("unknown").to_string(),
                            text: c["comment_text"].as_str().unwrap_or_default().to_string(),
                        })
                        .collect();
                }
            }
        }
    }

    let description = t["markdown_description"]
        .as_str()
        .or_else(|| t["description"].as_str())
        .or_else(|| t["text_content"].as_str())
        .unwrap_or_default()
        .to_string();

    Ok(ClickUpTaskDetail {
        id: t["id"].as_str().unwrap_or_default().to_string(),
        name: t["name"].as_str().unwrap_or_default().to_string(),
        status: t["status"]["status"].as_str().unwrap_or_default().to_string(),
        priority: t["priority"]["priority"].as_str().map(String::from),
        url: t["url"].as_str().unwrap_or_default().to_string(),
        description,
        space: t["space"]["name"].as_str().unwrap_or_default().to_string(),
        folder: t["folder"]["name"].as_str().unwrap_or_default().to_string(),
        list: t["list"]["name"].as_str().unwrap_or_default().to_string(),
        tags: t["tags"]
            .as_array()
            .map(|a| a.iter().filter_map(|x| x["name"].as_str().map(String::from)).collect())
            .unwrap_or_default(),
        comments,
    })
}
