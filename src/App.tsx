import { useEffect, useState, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  fetchTasks,
  loadConfig,
  saveConfig,
  solveTask,
  loadModel,
  loadRepo,
  loadReportsDir,
  setRuntimeConfig,
  currentRuntimeConfig,
  listReportsMeta,
  checkSkill,
  onboardingDone,
  type ClickUpTask,
  type ClickUpConfig,
  type ReportMeta,
} from "./lib/api";
import { Inbox } from "./inbox/Inbox";
import { Settings } from "./inbox/Settings";
import { Wizard } from "./onboarding/Wizard";

export function App() {
  const [cfg, setCfg] = useState<ClickUpConfig | null>(() => loadConfig());
  const [onboarded, setOnboarded] = useState<boolean>(() => onboardingDone());
  const [tasks, setTasks] = useState<ClickUpTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [solving, setSolving] = useState<Record<string, boolean>>({});
  const [reportIds, setReportIds] = useState<string[]>([]);
  const [reportsMeta, setReportsMeta] = useState<ReportMeta[]>([]);
  const [reportsLoaded, setReportsLoaded] = useState(false);
  const [skillOutdated, setSkillOutdated] = useState(false);
  const attempted = useRef<Set<string>>(new Set());

  const refreshReportIds = useCallback(async () => {
    try {
      const meta = await listReportsMeta(loadReportsDir());
      setReportsMeta(meta);
      setReportIds(meta.map((m) => m.id));
    } catch {
      /* ignore */
    } finally {
      setReportsLoaded(true);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!cfg) return;
    setLoading(true);
    setError(null);
    try {
      setTasks(await fetchTasks(cfg));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [cfg]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Keep the HTTP API's config in sync so external dashboards can act.
  useEffect(() => {
    const rc = currentRuntimeConfig();
    if (rc) setRuntimeConfig(rc).catch(() => {});
  }, [cfg]);

  // Keyboard shortcuts: ⌘, opens Settings, Esc closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!cfg || !onboarded) return;
      if (e.metaKey && e.key === ",") {
        e.preventDefault();
        setShowSettings(true);
      } else if (e.key === "Escape") {
        setShowSettings(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cfg, onboarded]);

  useEffect(() => {
    refreshReportIds();
  }, [refreshReportIds]);

  // Flag an outdated/missing skill for the top-bar indicator.
  useEffect(() => {
    if (!cfg || !onboarded) return;
    checkSkill()
      .then((s) => setSkillOutdated(!s.installed || !s.up_to_date))
      .catch(() => {});
  }, [cfg, onboarded, showSettings]);

  // Auto-solve: any unsolved ticket that appears gets solved once, hands-free.
  // Gated on reportsLoaded so we don't re-solve tickets that already have a
  // report; `attempted` prevents retry loops on failure.
  useEffect(() => {
    if (!cfg || !reportsLoaded) return;
    const solved = new Set(reportIds);
    for (const t of tasks) {
      if (solved.has(t.id) || solving[t.id] || attempted.current.has(t.id)) continue;
      attempted.current.add(t.id);
      handleSolve(t.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, reportIds, reportsLoaded, cfg]);

  // Deep link aierbaer://solve/<id> → kick off a solve for that ticket.
  useEffect(() => {
    const un = listen<string>("deep-link-solve", (e) => {
      if (cfg) handleSolve(e.payload);
    });
    const un2 = listen<string>("deep-link-open", () => {
      refresh();
    });
    return () => {
      un.then((f) => f());
      un2.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg]);

  const handleSolve = useCallback(
    async (taskId: string) => {
      if (!cfg) return;
      setSolving((s) => ({ ...s, [taskId]: true }));
      try {
        await solveTask(cfg.token, taskId, loadModel(), loadRepo(), loadReportsDir());
        await refreshReportIds();
      } catch (e) {
        setError(String(e));
      } finally {
        setSolving((s) => ({ ...s, [taskId]: false }));
      }
    },
    [cfg]
  );

  if (!cfg || !onboarded) {
    return (
      <Wizard
        onDone={(c) => {
          setCfg(c);
          setOnboarded(true);
        }}
      />
    );
  }

  if (showSettings) {
    return (
      <Settings
        initial={cfg}
        onSave={(c) => {
          saveConfig(c);
          setCfg(c);
          setShowSettings(false);
        }}
        onCancel={() => setShowSettings(false)}
      />
    );
  }

  return (
    <Inbox
      tasks={tasks}
      loading={loading}
      error={error}
      solving={solving}
      reportIds={reportIds}
      reportsMeta={reportsMeta}
      skillOutdated={skillOutdated}
      onRefresh={refresh}
      onSolve={handleSolve}
      onReportsChanged={refreshReportIds}
      onSettings={() => setShowSettings(true)}
    />
  );
}
