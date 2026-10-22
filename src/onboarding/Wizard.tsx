import { useEffect, useState } from "react";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  checkClaude,
  checkSkill,
  testClaude,
  loadModel,
  saveModel,
  loadRepo,
  saveRepo,
  MODELS,
  installClaude,
  installSkill,
  openTerminal,
  fetchTeams,
  fetchOwnerOptions,
  saveClickupCache,
  clickupTokenUrl,
  saveConfig,
  markOnboarded,
  DEFAULT_OWNER_FIELD_ID,
  DEFAULT_OWNER_VALUE,
  type ClickUpConfig,
  type ClaudeStatus,
  type SkillStatus,
  type Team,
  type OwnerOption,
} from "../lib/api";

type StepState = "checking" | "ok" | "missing";

interface Props {
  onDone: (cfg: ClickUpConfig) => void;
}

const STEPS = 5;

/** Freeform-style wizard: Claude Code → skill → model+test → repo → ClickUp.
 *  Each step self-checks and offers a fix action when the check fails. */
export function Wizard({ onDone }: Props) {
  const [step, setStep] = useState(0);
  return (
    <div className="wiz-backdrop">
      <div className="wiz-card">
        {step === 0 && <ClaudeStep onNext={() => setStep(1)} />}
        {step === 1 && <SkillStep onBack={() => setStep(0)} onNext={() => setStep(2)} />}
        {step === 2 && <ModelStep onBack={() => setStep(1)} onNext={() => setStep(3)} />}
        {step === 3 && <RepoStep onBack={() => setStep(2)} onNext={() => setStep(4)} />}
        {step === 4 && <ClickUpStep onBack={() => setStep(3)} onDone={onDone} />}
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

function ClaudeStep({ onNext }: { onNext: () => void }) {
  const [state, setState] = useState<StepState>("checking");
  const [cc, setCc] = useState<ClaudeStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [waitingLogin, setWaitingLogin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setState("checking");
    return checkClaude().then((s) => {
      setCc(s);
      setState(s.installed && s.logged_in ? "ok" : "missing");
      if (s.logged_in) setWaitingLogin(false);
      return s;
    });
  };
  useEffect(() => {
    run();
  }, []);

  // After opening the login Terminal, poll until the sign-in lands.
  useEffect(() => {
    if (!waitingLogin) return;
    const t = setInterval(() => {
      checkClaude().then((s) => {
        if (s.logged_in) {
          setCc(s);
          setState("ok");
          setWaitingLogin(false);
        }
      });
    }, 2000);
    return () => clearInterval(t);
  }, [waitingLogin]);

  const install = async () => {
    setInstalling(true);
    setError(null);
    try {
      await installClaude();
      await run();
    } catch (e) {
      setError(String(e));
    } finally {
      setInstalling(false);
    }
  };

  const login = async () => {
    setError(null);
    try {
      await openTerminal("claude auth login");
      setWaitingLogin(true);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <>
      <Bear />
      <h1>Claude Code</h1>
      <p className="wiz-lead">
        Personal Aierbaer runs <b>Claude Code</b> on your Mac to read each ClickUp
        ticket and draft a solution — using your own Claude subscription. Nothing
        leaves your machine except the ClickUp calls you already make.
      </p>

      {state === "checking" && <div className="wiz-status checking">Checking for Claude Code…</div>}
      {state === "ok" && (
        <div className="wiz-status ok">
          ✓ Claude Code ready{cc?.version ? ` — ${cc.version}` : ""}
          {cc?.email ? ` · ${cc.email}` : ""}
        </div>
      )}
      {state === "missing" && cc && !cc.installed && (
        <div className="wiz-status missing">
          <div>Claude Code not found on your PATH.</div>
          {error && <div className="err-text">{error}</div>}
          <button className="fix" disabled={installing} onClick={install}>
            {installing ? <><span className="spinner" /> Installing…</> : "Install"}
          </button>
        </div>
      )}
      {state === "missing" && cc && cc.installed && (
        <div className="wiz-status missing">
          <div>Not signed in. Sign in with your Claude subscription.</div>
          {error && <div className="err-text">{error}</div>}
          {waitingLogin ? (
            <div className="device-wait">
              <span className="spinner" /> Finish sign-in in the Terminal window…
            </div>
          ) : (
            <button className="fix" onClick={login}>
              Sign in
            </button>
          )}
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
      <h1>The Aierbaer skills</h1>
      <p className="wiz-lead">
        Skills are instruction files Claude Code loads to do its job. Aierbaer
        installs two: <b>clickup-aierbaer-solve</b> teaches Claude how to analyze a ticket
        and write a structured solution report — reusing your past resolutions so it
        improves over time — and <b>aierbaer-api</b> lets other coding agents drive
        Aierbaer over its local API.
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

function ModelStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [selected, setSelected] = useState<string>(loadModel());
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const choose = (id: string) => {
    setSelected(id);
    saveModel(id);
    setResult(null);
  };

  const runTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const out = await testClaude(selected);
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
        Pick the Claude model the agent uses. Opus gives the best analysis; Sonnet
        is faster and uses less of your plan limits.
      </p>

      <div className="wiz-form">
        <label>
          Model
          <select value={selected} onChange={(e) => choose(e.target.value)}>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <button className="wiz-btn" disabled={testing} onClick={runTest}>
          {testing ? (
            <>
              <span className="spinner" /> Testing Claude…
            </>
          ) : (
            "Test Claude"
          )}
        </button>

        {result && (
          <div className={`wiz-status ${result.ok ? "ok" : "missing"}`}>
            {result.ok ? (
              <>✓ Claude works — replied “{result.text}”</>
            ) : (
              <>
                <div>Claude didn’t respond.</div>
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
        Pick your local checkout of the Eversports repo. Claude runs{" "}
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
