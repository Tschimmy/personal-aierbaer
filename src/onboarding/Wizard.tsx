import { useEffect, useState } from "react";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import {
  checkPi,
  checkSkill,
  checkCopilot,
  copilotLogin,
  copilotModels,
  testPi,
  loadModel,
  saveModel,
  loadRepo,
  saveRepo,
  pickDefaultModel,
  installPi,
  installSkill,
  fetchTeams,
  fetchOwnerOptions,
  saveClickupCache,
  clickupTokenUrl,
  saveConfig,
  markOnboarded,
  DEFAULT_OWNER_FIELD_ID,
  DEFAULT_OWNER_VALUE,
  type ClickUpConfig,
  type PiStatus,
  type SkillStatus,
  type CopilotStatus,
  type Team,
  type OwnerOption,
} from "../lib/api";

type StepState = "checking" | "ok" | "missing";

interface Props {
  onDone: (cfg: ClickUpConfig) => void;
}

const STEPS = 6;

/** Freeform-style wizard: pi → skill → Copilot → model+test → repo → ClickUp.
 *  Each step self-checks and offers a fix action when the check fails. */
export function Wizard({ onDone }: Props) {
  const [step, setStep] = useState(0);
  return (
    <div className="wiz-backdrop">
      <div className="wiz-card">
        {step === 0 && <PiStep onNext={() => setStep(1)} />}
        {step === 1 && <SkillStep onBack={() => setStep(0)} onNext={() => setStep(2)} />}
        {step === 2 && <CopilotStep onBack={() => setStep(1)} onNext={() => setStep(3)} />}
        {step === 3 && <ModelStep onBack={() => setStep(2)} onNext={() => setStep(4)} />}
        {step === 4 && <RepoStep onBack={() => setStep(3)} onNext={() => setStep(5)} />}
        {step === 5 && <ClickUpStep onBack={() => setStep(4)} onDone={onDone} />}
        <Dots active={step} total={STEPS} />
      </div>
    </div>
  );
}

function Dots({ active, total }: { active: number; total: number }) {
  return (
    <div className="wiz-dots">
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} className={i === active ? "dot on" : "dot"} />
      ))}
    </div>
  );
}

function Bear() {
  return <img src="/icon.png" className="wiz-icon" alt="Personal Aierbaer" />;
}

function PiStep({ onNext }: { onNext: () => void }) {
  const [state, setState] = useState<StepState>("checking");
  const [pi, setPi] = useState<PiStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setState("checking");
    checkPi().then((s) => {
      setPi(s);
      setState(s.installed ? "ok" : "missing");
    });
  };
  useEffect(run, []);

  const install = async () => {
    setInstalling(true);
    setError(null);
    try {
      await installPi();
      await new Promise<void>((resolve) => {
        checkPi().then((s) => {
          setPi(s);
          setState(s.installed ? "ok" : "missing");
          resolve();
        });
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <>
      <Bear />
      <h1>The pi agent</h1>
      <p className="wiz-lead">
        Personal Aierbaer runs a local <b>pi</b> agent on your Mac to read each
        ClickUp ticket and draft a solution — using your own Copilot auth.
        Nothing leaves your machine except the ClickUp calls you already make.
      </p>

      {state === "checking" && <div className="wiz-status checking">Checking for pi…</div>}
      {state === "ok" && (
        <div className="wiz-status ok">✓ pi installed{pi?.version ? ` — ${pi.version}` : ""}</div>
      )}
      {state === "missing" && (
        <div className="wiz-status missing">
          <div>pi not found on your PATH.</div>
          {error && <div className="err-text">{error}</div>}
          <button className="fix" disabled={installing} onClick={install}>
            {installing ? <><span className="spinner" /> Installing…</> : "Install"}
          </button>
        </div>
      )}

      <div className="wiz-actions">
        <span />
        <button className="primary" disabled={state !== "ok"} onClick={onNext}>
          Continue
        </button>
      </div>
    </>
  );
}

function SkillStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [state, setState] = useState<StepState>("checking");
  const [skill, setSkill] = useState<SkillStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setState("checking");
    checkSkill().then((s) => {
      setSkill(s);
      setState(s.installed ? "ok" : "missing");
    });
  };
  useEffect(run, []);

  const install = async () => {
    setInstalling(true);
    setError(null);
    try {
      await installSkill();
      await new Promise<void>((resolve) => {
        checkSkill().then((s) => {
          setSkill(s);
          setState(s.installed ? "ok" : "missing");
          resolve();
        });
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <>
      <Bear />
      <h1>The clickup-aierbaer-solve skill</h1>
      <p className="wiz-lead">
        The <b>clickup-aierbaer-solve</b> skill teaches pi how to analyze a ticket and
        write a structured solution report it can learn from next time.
      </p>

      {state === "checking" && <div className="wiz-status checking">Looking for the skill…</div>}
      {state === "ok" && skill?.up_to_date && (
        <div className="wiz-status ok">
          ✓ Skill installed{skill?.version ? ` — v${skill.version}` : ""}
        </div>
      )}
      {state === "ok" && skill && !skill.up_to_date && (
        <div className="wiz-status missing">
          <div>
            Update available — installed v{skill.version ?? "?"}, bundled v{skill.bundled ?? "?"}.
          </div>
          {error && <div className="err-text">{error}</div>}
          <button className="fix" disabled={installing} onClick={install}>
            {installing ? <><span className="spinner" /> Updating…</> : "Update"}
          </button>
        </div>
      )}
      {state === "missing" && (
        <div className="wiz-status missing">
          <div>Skill not found at ~/.claude/skills/clickup-aierbaer-solve.</div>
          {error && <div className="err-text">{error}</div>}
          <button className="fix" disabled={installing} onClick={install}>
            {installing ? <><span className="spinner" /> Installing…</> : "Install"}
          </button>
        </div>
      )}

      <div className="wiz-actions">
        <button className="ghost" onClick={onBack}>
          Back
        </button>
        <button className="primary" disabled={!skill?.up_to_date} onClick={onNext}>
          Continue
        </button>
      </div>
    </>
  );
}

function CopilotStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [state, setState] = useState<StepState>("checking");
  const [cop, setCop] = useState<CopilotStatus | null>(null);
  const [authorizing, setAuthorizing] = useState(false);
  const [device, setDevice] = useState<{ userCode: string; verificationUri: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setState("checking");
    checkCopilot().then((s) => {
      setCop(s);
      setState(s.ready ? "ok" : "missing");
    });
  };
  useEffect(run, []);

  const signIn = async () => {
    setError(null);
    setAuthorizing(true);
    setDevice(null);
    // Show the code + auto-open the browser as soon as the device flow starts.
    const un = await listen<{ userCode: string; verificationUri: string }>(
      "copilot-device",
      (e) => {
        setDevice(e.payload);
        openUrl(e.payload.verificationUri);
      }
    );
    try {
      await copilotLogin();
      await new Promise<void>((resolve) => {
        checkCopilot().then((s) => {
          setCop(s);
          setState(s.ready ? "ok" : "missing");
          resolve();
        });
      });
    } catch (e) {
      setError(String(e));
    } finally {
      un();
      setAuthorizing(false);
      setDevice(null);
    }
  };

  return (
    <>
      <Bear />
      <h1>GitHub Copilot auth</h1>
      <p className="wiz-lead">
        The v1 runs on your <b>GitHub Copilot</b> subscription. Aierbaer never
        sees your token — it just asks the local pi agent to use it.
      </p>

      {state === "checking" && <div className="wiz-status checking">Checking Copilot auth…</div>}
      {state === "ok" && (
        <div className="wiz-status ok">
          ✓ Copilot ready{cop?.auth_type ? ` — ${cop.auth_type}` : ""}
        </div>
      )}
      {state === "missing" && !authorizing && (
        <div className="wiz-status missing">
          <div>Copilot not connected yet.</div>
          {error && <div className="err-text">{error}</div>}
          <button className="fix" onClick={signIn}>
            Sign in with GitHub
          </button>
        </div>
      )}

      {authorizing && (
        <div className="device-box">
          {device ? (
            <>
              <div className="device-label">Enter this code at GitHub</div>
              <div className="device-code-row">
                <span className="device-code">{device.userCode}</span>
                <button
                  className="copy-btn"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(device.userCode);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    } catch {
                      /* clipboard blocked — ignore */
                    }
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <button className="inline-link" onClick={() => openUrl(device.verificationUri)}>
                Open github.com/login/device ↗
              </button>
              <div className="device-wait">
                <span className="spinner" /> Waiting for authorization…
              </div>
            </>
          ) : (
            <div className="device-wait">
              <span className="spinner" /> Starting sign-in…
            </div>
          )}
          <button className="link" onClick={() => setAuthorizing(false)}>
            Cancel
          </button>
        </div>
      )}

      <div className="wiz-actions">
        <button className="ghost" onClick={onBack}>
          Back
        </button>
        <button className="primary" disabled={state !== "ok"} onClick={onNext}>
          Continue
        </button>
      </div>
    </>
  );
}

function ModelStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [models, setModels] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>(loadModel());
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    copilotModels()
      .then((ids) => {
        setModels(ids);
        // Default to newest Opus unless the user already picked something valid.
        const current = loadModel().replace(/^github-copilot\//, "");
        const def = ids.includes(current) ? loadModel() : pickDefaultModel(ids);
        setSelected(def);
        saveModel(def);
      })
      .finally(() => setLoading(false));
  }, []);

  const choose = (full: string) => {
    setSelected(full);
    saveModel(full);
    setResult(null);
  };

  const runTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const out = await testPi(selected);
      const firstLine = out.split("\n").find((l) => l.trim().length > 0) || "";
      setResult({ ok: firstLine.length > 0, text: firstLine || "(no output)" });
    } catch (e) {
      setResult({ ok: false, text: String(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <Bear />
      <h1>Model & test</h1>
      <p className="wiz-lead">
        Pick the Copilot model the agent uses. These are the models your account
        is allowed to run.
      </p>

      <div className="wiz-form">
        <label>
          Model
          <select
            value={selected}
            disabled={loading}
            onChange={(e) => choose(e.target.value)}
          >
            {loading && <option>Loading…</option>}
            {models.map((id) => {
              const full = `github-copilot/${id}`;
              return (
                <option key={id} value={full}>
                  {id}
                </option>
              );
            })}
          </select>
        </label>

        <button className="wiz-btn" disabled={testing || loading} onClick={runTest}>
          {testing ? (
            <>
              <span className="spinner" /> Testing pi agent…
            </>
          ) : (
            "Test pi agent"
          )}
        </button>

        {result && (
          <div className={`wiz-status ${result.ok ? "ok" : "missing"}`}>
            {result.ok ? (
              <>✓ pi agent works — replied “{result.text}”</>
            ) : (
              <>
                <div>pi didn’t respond.</div>
                <div className="err-text">{result.text}</div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="wiz-actions">
        <button className="ghost" onClick={onBack}>
          Back
        </button>
        <button className="primary" disabled={!result?.ok} onClick={onNext}>
          Continue
        </button>
      </div>
    </>
  );
}

function RepoStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [repo, setRepo] = useState<string>(loadRepo());

  const choose = async () => {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: "Select the Eversports repository",
    });
    if (typeof picked === "string") {
      setRepo(picked);
      saveRepo(picked);
    }
  };

  return (
    <>
      <Bear />
      <h1>Eversports repository</h1>
      <p className="wiz-lead">
        Pick your local checkout of the Eversports repo. The pi agent runs{" "}
        <b>inside this folder</b> when solving a ticket, so it can read the
        codebase.
      </p>

      <div className="wiz-form">
        <button className="wiz-btn" onClick={choose}>
          {repo ? "Change folder…" : "Choose folder…"}
        </button>
        {repo && (
          <div className="wiz-status ok path-status">
            <span className="path-icon">✓</span>
            <code className="path-text">{repo}</code>
          </div>
        )}
      </div>

      <div className="wiz-actions">
        <button className="ghost" onClick={onBack}>
          Back
        </button>
        <button className="primary" disabled={!repo} onClick={onNext}>
          Continue
        </button>
      </div>
    </>
  );
}

function ClickUpStep({ onBack, onDone }: { onBack: () => void; onDone: (c: ClickUpConfig) => void }) {
  const [token, setToken] = useState("");
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState("");
  const [owners, setOwners] = useState<OwnerOption[]>([]);
  const [ownerValue, setOwnerValue] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTeams = () => {
    setLoading(true);
    setError(null);
    fetchTeams(token)
      .then(async (t) => {
        setTeams(t);
        const tid = t.length ? t[0].id : "";
        if (tid) {
          setTeamId(tid);
          const opts = await fetchOwnerOptions(token, tid, DEFAULT_OWNER_FIELD_ID);
          setOwners(opts);
          saveClickupCache({ token, teams: t, owners: opts });
          const def = opts.find((o) => o.value === DEFAULT_OWNER_VALUE) ?? opts[0];
          if (def) setOwnerValue(def.value);
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  return (
    <>
      <Bear />
      <h1>Connect ClickUp</h1>
      <p className="wiz-lead">
        Paste your token — Aierbaer connects to your Eversports workspace. Your
        token stays on this Mac.{" "}
        <button
          className="inline-link"
          onClick={() => openUrl(clickupTokenUrl(teamId))}
        >
          Get a token ↗
        </button>
      </p>

      <div className="wiz-form">
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

        {teams.length === 1 && (
          <div className="wiz-status ok">✓ Connected — {teams[0].name}</div>
        )}

        {teams.length > 1 && (
          <label>
            Workspace
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {owners.length > 0 && (
          <label>
            Your owner team
            <select
              value={ownerValue ?? ""}
              onChange={(e) => setOwnerValue(Number(e.target.value))}
            >
              {owners.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="wiz-actions">
        <button className="ghost" onClick={onBack}>
          Back
        </button>
        <button
          className="primary"
          disabled={!token || !teamId || ownerValue === null}
          onClick={() => {
            const cfg: ClickUpConfig = {
              token,
              team_id: teamId,
              owner_field_id: DEFAULT_OWNER_FIELD_ID,
              owner_value: ownerValue as number,
            };
            saveConfig(cfg);
            markOnboarded();
            onDone(cfg);
          }}
        >
          Finish
        </button>
      </div>
    </>
  );
}
