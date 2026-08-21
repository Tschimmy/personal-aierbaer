import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  fetchTeams,
  fetchOwnerOptions,
  loadRepo,
  saveRepo,
  loadReportsDir,
  saveReportsDir,
  checkSkill,
  installSkill,
  getApiSettings,
  setApiPort,
  regenerateApiToken,
  DEFAULT_OWNER_FIELD_ID,
  type ClickUpConfig,
  type Team,
  type OwnerOption,
  type SkillStatus,
  type ApiSettings,
} from "../lib/api";
import { StatusBar } from "../components/StatusBar";
import { RELEASES, APP_VERSION, type Release } from "../lib/releaseNotes";

interface Props {
  initial: ClickUpConfig | null;
  onSave: (cfg: ClickUpConfig) => void;
  onCancel?: () => void;
}

type Section = "clickup" | "solving" | "skill" | "api" | "about";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "clickup", label: "ClickUp" },
  { id: "solving", label: "Repository & Reports" },
  { id: "skill", label: "Skills" },
  { id: "api", label: "Local API" },
  { id: "about", label: "Release notes" },
];

export function Settings({ initial, onSave, onCancel }: Props) {
  const [section, setSection] = useState<Section>("clickup");
  const [token, setToken] = useState(initial?.token ?? "");
  const [teamId, setTeamId] = useState(initial?.team_id ?? "");
  const [fieldId] = useState(initial?.owner_field_id || DEFAULT_OWNER_FIELD_ID);
  const [ownerValue, setOwnerValue] = useState(String(initial?.owner_value ?? 0));
  const [teams, setTeams] = useState<Team[]>([]);
  const [owners, setOwners] = useState<OwnerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repo, setRepo] = useState<string>(loadRepo());
  const [reportsDir, setReportsDir] = useState<string>(loadReportsDir());
  const [skill, setSkill] = useState<SkillStatus | null>(null);
  const [skillBusy, setSkillBusy] = useState(false);
  const [apiSettings, setApiSettings] = useState<ApiSettings | null>(null);
  const [portInput, setPortInput] = useState("");
  const [copied, setCopied] = useState("");

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      /* ignore */
    }
  };

  const refreshSkill = () => checkSkill().then(setSkill);
  useEffect(() => {
    if (token) loadTeams();
    refreshSkill();
    getApiSettings().then((s) => {
      setApiSettings(s);
      setPortInput(String(s.port));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadTeams = () => {
    setLoading(true);
    setError(null);
    fetchTeams(token)
      .then(async (t) => {
        setTeams(t);
        const tid = t.length === 1 ? t[0].id : teamId || (t[0]?.id ?? "");
        if (tid) {
          setTeamId(tid);
          setOwners(await fetchOwnerOptions(token, tid, fieldId));
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  const chooseRepo = async () => {
    const p = await openDialog({ directory: true, multiple: false, title: "Select the Eversports repository" });
    if (typeof p === "string") { setRepo(p); saveRepo(p); }
  };
  const chooseReports = async () => {
    const p = await openDialog({ directory: true, multiple: false, title: "Where to store solution reports" });
    if (typeof p === "string") { setReportsDir(p); saveReportsDir(p); }
  };
  const updateSkill = async () => {
    setSkillBusy(true);
    try { await installSkill(); await refreshSkill(); } finally { setSkillBusy(false); }
  };
  const applyPort = async () => {
    const p = Number(portInput);
    if (!p || p < 1024 || p > 65535) return;
    setApiSettings(await setApiPort(p));
  };
  const regenToken = async () => setApiSettings(await regenerateApiToken());

  const valid = token && teamId && fieldId;
  const doSave = () => {
    if (!valid) return;
    onSave({ token, team_id: teamId, owner_field_id: fieldId, owner_value: Number(ownerValue) });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && (e.key === "s" || e.key === "S")) { e.preventDefault(); doSave(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  return (
    <div className="prefs-backdrop">
      <div className="prefs-panel">
        <header className="prefs-head" data-tauri-drag-region>
          <span className="prefs-title">Settings</span>
          {onCancel && <button className="prefs-close" onClick={onCancel}>✕</button>}
        </header>

        <div className="prefs-body">
          <nav className="prefs-nav">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={section === s.id ? "active" : ""}
                onClick={() => setSection(s.id)}
              >
                {s.label}
              </button>
            ))}
          </nav>

          <div className="prefs-content">
            {section === "clickup" && (
              <>
                <h2>ClickUp</h2>
                <p className="prefs-lead">Connect to your Eversports workspace. Your token stays on this Mac.</p>
                <label>
                  API token
                  <div className="token-row">
                    <input type="password" value={token} onChange={(e) => setToken(e.target.value)} />
                    <button className="fix" disabled={!token || loading} onClick={loadTeams}>
                      {loading ? "…" : "Connect"}
                    </button>
                  </div>
                </label>
                {error && <div className="wiz-status missing">{error}</div>}
                {teams.length === 1 && <div className="wiz-status ok">✓ Connected — {teams[0].name}</div>}
                {teams.length > 1 && (
                  <label>
                    Workspace
                    <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                      {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </label>
                )}
                {owners.length > 0 && (
                  <label>
                    Your owner team
                    <select value={ownerValue} onChange={(e) => setOwnerValue(e.target.value)}>
                      {owners.map((o) => <option key={o.value} value={String(o.value)}>{o.name}</option>)}
                    </select>
                  </label>
                )}
                <div className="prefs-actions">
                  <button className="primary" disabled={!valid} onClick={doSave}>Save</button>
                </div>
              </>
            )}

            {section === "solving" && (
              <>
                <h2>Repository & Reports</h2>
                <p className="prefs-lead">The pi agent runs inside the repo; reports are stored in the reports folder.</p>
                <label>
                  Eversports repository
                  <button className="wiz-btn" onClick={chooseRepo}>{repo ? "Change folder…" : "Choose folder…"}</button>
                </label>
                {repo && (
                  <div className="wiz-status ok path-status">
                    <span className="path-icon">✓</span><code className="path-text">{repo}</code>
                  </div>
                )}
                <label>
                  Reports folder
                  <button className="wiz-btn" onClick={chooseReports}>{reportsDir ? "Change folder…" : "Choose folder…"}</button>
                </label>
                <div className="wiz-status ok path-status">
                  <span className="path-icon">✓</span>
                  <code className="path-text">{reportsDir || "~/Documents/Personal Aierbaer/Reports (default)"}</code>
                </div>
              </>
            )}

            {section === "skill" && (
              <>
                <h2>Skills</h2>
                <p className="prefs-lead">The clickup-aierbaer-solve and aierbaer-api skills the pi agent uses.</p>
                {skill && skill.installed && skill.up_to_date && (
                  <div className="wiz-status ok">✓ Up to date — v{skill.version}</div>
                )}
                {skill && skill.installed && !skill.up_to_date && (
                  <div className="wiz-status missing">
                    <div>Update available — installed v{skill.version ?? "?"}, bundled v{skill.bundled ?? "?"}.</div>
                    <button className="fix" disabled={skillBusy} onClick={updateSkill}>{skillBusy ? "Updating…" : "Update"}</button>
                  </div>
                )}
                {skill && !skill.installed && (
                  <div className="wiz-status missing">
                    <div>Not installed.</div>
                    <button className="fix" disabled={skillBusy} onClick={updateSkill}>{skillBusy ? "Installing…" : "Install"}</button>
                  </div>
                )}
              </>
            )}

            {section === "api" && apiSettings && (
              <>
                <h2>Local API</h2>
                <p className="prefs-lead">Lets an external dashboard or coding agent drive Aierbaer over HTTP.</p>
                <div className="api-row">
                  <span className="api-sub">Port</span>
                  <input type="number" value={portInput} onChange={(e) => setPortInput(e.target.value)} />
                  <button className="fix" disabled={portInput === String(apiSettings.port)} onClick={applyPort}>Apply</button>
                </div>
                <div className="api-row">
                  <span className="api-sub">Token</span>
                  <input type="text" readOnly value={apiSettings.token} />
                  <button className="fix" onClick={() => copy(apiSettings.token, "token")}>
                    {copied === "token" ? "Copied" : "Copy"}
                  </button>
                  <button className="fix" onClick={regenToken}>Regenerate</button>
                </div>

                <label>Environment variables</label>
                <p className="prefs-lead">Copy the line for your shell so agents pick up the token automatically.</p>
                {(() => {
                  const posix = `export AIERBAER_PORT=${apiSettings.port} AIERBAER_TOKEN=${apiSettings.token}`;
                  const fish = `set -gx AIERBAER_PORT ${apiSettings.port}; set -gx AIERBAER_TOKEN ${apiSettings.token}`;
                  return (
                    <>
                      <div className="env-row">
                        <span className="env-shell">bash / zsh / sh</span>
                        <code className="env-cmd">{posix}</code>
                        <button className="fix" onClick={() => copy(posix, "posix")}>
                          {copied === "posix" ? "Copied" : "Copy"}
                        </button>
                      </div>
                      <div className="env-row">
                        <span className="env-shell">fish</span>
                        <code className="env-cmd">{fish}</code>
                        <button className="fix" onClick={() => copy(fish, "fish")}>
                          {copied === "fish" ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </>
                  );
                })()}
                <div className="api-hint">Or send <code>X-Aierbaer-Token: &lt;token&gt;</code> manually with API requests.</div>
              </>
            )}

            {section === "about" && (
              <>
                <h2>Release notes</h2>
                <p className="prefs-lead">Personal Aierbaer v{APP_VERSION}</p>
                <div className="release-notes">
                  {RELEASES.map((r: Release) => (
                    <div className="release" key={r.version}>
                      <div className="release-head">
                        <span className="release-ver">v{r.version}</span>
                        <span className="release-date">{r.date}</span>
                      </div>
                      {r.sections.map((s) => (
                        <div className="release-sec" key={s.heading}>
                          <div className="release-sec-head">{s.heading}</div>
                          <ul>
                            {s.items.map((it: string, i: number) => <li key={i}>{it}</li>)}
                          </ul>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <StatusBar
          hints={[{ keys: ["esc"], label: "close" }, { keys: ["⌘", "S"], label: "save" }]}
        />
      </div>
    </div>
  );
}
