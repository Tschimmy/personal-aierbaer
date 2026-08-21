import { useRef, useState, useEffect, useMemo } from "react";
import { listen } from "@tauri-apps/api/event";
import { applyTheme, loadTheme, loadHideResolved, saveHideResolved, getApiSettings, apiHealthy, checkUpdate, installUpdate, restartApp, type ClickUpTask, type UpdateInfo } from "../lib/api";
import { APP_VERSION } from "../lib/releaseNotes";
import { Help } from "./Help";
import { ReportPane } from "./ReportPane";
import { StatusBar, type Hint } from "../components/StatusBar";
import type { ReportMeta } from "../lib/api";

const ico = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const IconRefresh = () => (
  <svg {...ico}><path d="M21 12a9 9 0 1 1-2.64-6.36" /><polyline points="21 3 21 9 15 9" /></svg>
);
const IconSearch = () => (
  <svg {...ico}><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
);
const IconSun = () => (
  <svg {...ico}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
);
const IconMoon = () => (
  <svg {...ico}><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" /></svg>
);
const IconHelp = () => (
  <svg {...ico}><circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></svg>
);
const IconGear = () => (
  <svg {...ico}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
);
const IconAlert = () => (
  <svg {...ico}><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
);

interface Props {
  tasks: ClickUpTask[];
  loading: boolean;
  error: string | null;
  solving: Record<string, boolean>;
  reportIds: string[];
  reportsMeta: ReportMeta[];
  skillOutdated: boolean;
  onRefresh: () => void;
  onSolve: (taskId: string) => void;
  onReportsChanged: () => void;
  onSettings: () => void;
}

export function Inbox({
  tasks,
  loading,
  error,
  solving,
  reportIds,
  reportsMeta,
  skillOutdated,
  onRefresh,
  onSolve,
  onReportsChanged,
  onSettings,
}: Props) {
  const [theme, setTheme] = useState(loadTheme());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hideResolved, setHideResolved] = useState(loadHideResolved());
  const [apiPort, setApiPort] = useState<number | null>(null);
  const [apiOk, setApiOk] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [updateErr, setUpdateErr] = useState<string | null>(null);

  // Check GitHub for a newer release on open.
  useEffect(() => {
    checkUpdate().then(setUpdate).catch(() => {});
  }, []);

  const doInstall = async () => {
    if (!update) return;
    setUpdating(true);
    setUpdateErr(null);
    try {
      await installUpdate(update.url);
      setUpdateReady(true);
    } catch (e) {
      setUpdateErr(String(e));
    } finally {
      setUpdating(false);
    }
  };
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1600);
  };

  // Poll the local API health for the footer indicator.
  useEffect(() => {
    let port = 0;
    let timer: ReturnType<typeof setInterval>;
    getApiSettings().then((s) => {
      port = s.port;
      setApiPort(s.port);
      const ping = async () => setApiOk(await apiHealthy(port));
      ping();
      timer = setInterval(ping, 5000);
    });
    return () => clearInterval(timer);
  }, []);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [focusReport, setFocusReport] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(0.45);
  const dragging = useRef(false);
  const [resolveSignal, setResolveSignal] = useState(0);
  const [deleteSignal, setDeleteSignal] = useState(0);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  };

  const filtered = useMemo(() => {
    const resolved = new Set(reportsMeta.filter((m) => m.resolved).map((m) => m.id));
    const q = query.trim().toLowerCase();
    let list = tasks;
    if (q) {
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.status.toLowerCase().includes(q) ||
          t.list.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    }
    if (hideResolved) list = list.filter((t) => !resolved.has(t.id));
    return list;
  }, [tasks, query, hideResolved, reportsMeta]);

  const toggleHideResolved = () => {
    setHideResolved((prev) => {
      const next = !prev;
      saveHideResolved(next);
      return next;
    });
  };

  const selected = filtered.find((t) => t.id === selectedId) ?? null;
  const hasReport = new Set(reportIds);
  const resolvedMap = new Map(reportsMeta.filter((m) => m.resolved).map((m) => [m.id, m.choice]));
  const shortChoice = (c: string | null | undefined) => (c ? c.split(":")[0].trim() : "resolved");

  // Context-aware footer hints — only show what's actually possible right now.
  const hints: Hint[] = useMemo(() => {
    if (searchOpen) {
      return [
        { keys: ["esc"], label: "close search" },
        { keys: ["⌘", "R"], label: "refresh" },
        { keys: ["⌘", ","], label: "settings" },
      ];
    }
    const canSolve = selected && !solving[selected.id];
    if (focusReport) {
      const h: Hint[] = [
        { keys: ["j", "k"], label: "scroll" },
        { keys: ["esc"], label: "back to list" },
      ];
      if (canSolve) h.push({ keys: ["s"], label: "re-solve" });
      h.push({ keys: ["r"], label: "set solution" });
      if (selected && resolvedMap.has(selected.id)) h.push({ keys: ["d"], label: "delete solution" });
      h.push({ keys: ["?"], label: "help" }, { keys: ["⌘", "R"], label: "refresh" }, { keys: ["⌘", ","], label: "settings" });
      return h;
    }
    const h: Hint[] = [];
    if (filtered.length > 0) h.push({ keys: ["j", "k"], label: "navigate" });
    if (canSolve) h.push({ keys: ["s"], label: hasReport.has(selected!.id) ? "re-solve" : "solve" });
    if (selected) h.push({ keys: ["↵"], label: "open report" });
    if (selected && hasReport.has(selected.id)) h.push({ keys: ["r"], label: "set solution" });
    if (selected && resolvedMap.has(selected.id)) h.push({ keys: ["d"], label: "delete solution" });
    if (selected) h.push({ keys: ["⌘", "C"], label: "copy id" });
    h.push(
      { keys: ["⌘", "F"], label: "search" },
      { keys: ["⌘", "U"], label: hideResolved ? "show resolved" : "hide resolved" },
      { keys: ["?"], label: "help" },
      { keys: ["⌘", "R"], label: "refresh" },
      { keys: ["⌘", ","], label: "settings" },
    );
    return h;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchOpen, focusReport, selectedId, filtered.length, solving, reportIds, reportsMeta, hideResolved]);

  // Keep latest values for the keydown handler without re-registering it.
  const nav = useRef({ filtered, selectedId, solving, focusReport, reportIds, resolvedMap });
  nav.current = { filtered, selectedId, solving, focusReport, reportIds, resolvedMap };

  const move = (delta: number) => {
    const { filtered: list, selectedId: cur } = nav.current;
    if (list.length === 0) return;
    const idx = list.findIndex((t) => t.id === cur);
    const next = idx === -1 ? (delta > 0 ? 0 : list.length - 1) : Math.min(list.length - 1, Math.max(0, idx + delta));
    setFocusReport(false);
    setSelectedId(list[next].id);
  };

  useEffect(() => {
    const isTyping = () => {
      const el = document.activeElement;
      return el instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
    };
    const onKey = (e: KeyboardEvent) => {
      // Global shortcuts (work even while typing).
      if (e.metaKey && (e.key === "r" || e.key === "R")) {
        e.preventDefault();
        onRefresh();
        return;
      }
      if (e.metaKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchRef.current?.focus(), 0);
        return;
      }
      if (e.metaKey && (e.key === "c" || e.key === "C")) {
        const sel = window.getSelection()?.toString();
        const cur = nav.current.selectedId;
        if (!sel && cur && !isTyping()) {
          e.preventDefault();
          navigator.clipboard.writeText(cur).then(() => showToast(`Copied ID ${cur}`)).catch(() => {});
        }
        return;
      }
      if (e.key === "?" && !isTyping()) {
        e.preventDefault();
        setHelpOpen((v) => !v);
        return;
      }
      if (e.metaKey && (e.key === "u" || e.key === "U")) {
        e.preventDefault();
        toggleHideResolved();
        return;
      }
      if (e.metaKey && e.code === "Space") {
        e.preventDefault();
        const { selectedId: cur, solving: s } = nav.current;
        if (cur && !s[cur]) onSolve(cur);
        return;
      }
      if (e.key === "Escape") {
        if (searchOpen) {
          setSearchOpen(false);
          setQuery("");
        } else if (nav.current.focusReport) {
          setFocusReport(false);
        }
        return;
      }
      if (isTyping()) return;
      // 's' solves the selected ticket (from either focus).
      if (e.key === "s" || e.key === "S") {
        const { selectedId: cur, solving: s } = nav.current;
        if (cur && !s[cur]) {
          e.preventDefault();
          onSolve(cur);
        }
        return;
      }
      if (nav.current.focusReport) {
        // Report focused: section navigation is handled inside ReportPane.
        return;
      }
      // List focused: j/k move selection, Enter drops into the report.
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        move(1);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        move(-1);
      } else if (e.key === "r") {
        // Set resolution for the selected ticket (only if it has a report).
        const { selectedId: cur, reportIds: ids } = nav.current;
        if (cur && ids.includes(cur)) {
          e.preventDefault();
          setResolveSignal((n) => n + 1);
        }
      } else if (e.key === "d") {
        // Delete resolution for the selected resolved ticket.
        const { selectedId: cur, resolvedMap: rmap } = nav.current;
        if (cur && rmap.has(cur)) {
          e.preventDefault();
          setDeleteSignal((n) => n + 1);
        }
      } else if (e.key === "Enter") {
        if (nav.current.selectedId) {
          e.preventDefault();
          setFocusReport(true);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchOpen]);

  // Scroll the selected row into view as you navigate.
  useEffect(() => {
    if (selectedId) {
      document.querySelector(`[data-ticket="${selectedId}"]`)?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedId]);

  // Deep link aierbaer://open/<id> → select and reveal that ticket.
  useEffect(() => {
    const un = listen<string>("deep-link-open", (e) => {
      setSearchOpen(false);
      setQuery("");
      setHideResolved(false);
      setFocusReport(false);
      setSelectedId(e.payload);
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  // Divider drag to resize the split.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current || !splitRef.current) return;
      const rect = splitRef.current.getBoundingClientRect();
      setRatio(Math.min(0.85, Math.max(0.15, (e.clientY - rect.top) / rect.height)));
    };
    const up = () => {
      dragging.current = false;
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  return (
    <div className="app">
      <header className="titlebar" data-tauri-drag-region>
        <span className="brand">🐻 Personal Aierbaer</span>
        <div className="actions">
          <button onClick={() => setHelpOpen(true)} title="Help (?)">
            <IconHelp />
          </button>
          {skillOutdated && (
            <button className="skill-warn" onClick={onSettings} title="Skill update available — open Settings">
              <IconAlert /> Update skill
            </button>
          )}
          <button
            className={`hide-toggle ${hideResolved ? "on" : ""}`}
            onClick={toggleHideResolved}
            title={hideResolved ? "Showing only unresolved (⌘U)" : "Hide resolved (⌘U)"}
          >
            <span className="switch"><span className="knob" /></span>
            Hide resolved
          </button>
          <button onClick={onRefresh} disabled={loading} title="Refresh (⌘R)">
            <IconRefresh />
          </button>
          <button onClick={() => { setSearchOpen((v) => !v); setTimeout(() => searchRef.current?.focus(), 0); }} title="Search (⌘F)">
            <IconSearch />
          </button>
          <button onClick={toggleTheme} title="Toggle theme">
            {theme === "dark" ? <IconSun /> : <IconMoon />}
          </button>
          <button onClick={onSettings} title="Settings (⌘,)">
            <IconGear />
          </button>
        </div>
      </header>

      {searchOpen && (
        <div className="search-bar">
          <input
            ref={searchRef}
            value={query}
            placeholder="Filter tickets…"
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="search-close" onClick={() => { setSearchOpen(false); setQuery(""); }}>✕</button>
        </div>
      )}

      {error && <div className="banner error">{error}</div>}

      {update && (
        <div className="update-banner">
          <span>
            <b>Version {update.version}</b> is available (you have {update.current}).
            {updateErr && <span className="err-text"> {updateErr}</span>}
          </span>
          <span className="update-actions">
            {updateReady ? (
              <button className="update-btn" onClick={restartApp}>Restart to update</button>
            ) : (
              <button className="update-btn" onClick={doInstall} disabled={updating}>
                {updating ? "Downloading…" : "Install"}
              </button>
            )}
            <button className="update-dismiss" onClick={() => setUpdate(null)}>✕</button>
          </span>
        </div>
      )}

      <div className={selected ? "split split-open" : "split"} ref={splitRef}>
        <main
          className={`inbox ${focusReport ? "" : selected ? "pane-active" : ""}`}
          style={selected ? { flex: `0 0 ${ratio * 100}%` } : undefined}
        >
          {filtered.length === 0 && !loading && (
            <div className="empty">{query ? "No matching tickets." : "No open tickets."}</div>
          )}
          {filtered.map((t) => (
            <article
              className={`ticket ${selectedId === t.id ? "selected" : ""} ${resolvedMap.has(t.id) ? "resolved" : ""}`}
              key={t.id}
              data-ticket={t.id}
              onClick={() => { setSelectedId(t.id); setFocusReport(false); }}
            >
              <div className="ticket-main">
                <span className="dot" style={{ background: t.status_color || "#666" }} />
                <div className="ticket-body">
                  <div className="ticket-name">
                    {resolvedMap.has(t.id) ? (
                      <span className="resolved-badge" title={`Resolved — ${resolvedMap.get(t.id) ?? ""}`}>
                        ✓ {shortChoice(resolvedMap.get(t.id))}
                      </span>
                    ) : (
                      hasReport.has(t.id) && <span className="report-badge" title="Has report">◆</span>
                    )}
                    {t.name}
                  </div>
                  <div className="ticket-meta">
                    <span className="status">{t.status}</span>
                    <span className="list">{t.list}</span>
                    {t.tags.map((tag) => (
                      <span className="tag" key={tag}>
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="ticket-actions">
                <button
                  className="solve"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSolve(t.id);
                  }}
                  disabled={solving[t.id]}
                >
                  {solving[t.id] ? "solving…" : hasReport.has(t.id) ? "Re-solve" : "Solve"}
                </button>
              </div>
            </article>
          ))}
        </main>

        {selected && (
          <>
            <div
              className="split-divider"
              onPointerDown={(e) => {
                dragging.current = true;
                document.body.style.userSelect = "none";
                e.preventDefault();
              }}
            >
              <span className="grip" />
            </div>
            <ReportPane
              task={selected}
              solving={!!solving[selected.id]}
              onSolve={onSolve}
              onReportsChanged={onReportsChanged}
              focused={focusReport}
              resolveSignal={resolveSignal}
              deleteSignal={deleteSignal}
            />
          </>
        )}
      </div>

      <StatusBar
        hints={hints}
        right={
          <span className="footer-right">
            <span className="app-ver">v{APP_VERSION}</span>
            <span className="api-status" title={apiOk ? `API running on :${apiPort}` : "API not responding"}>
              <span className={`api-dot ${apiOk ? "ok" : "down"}`} />
              API{apiPort ? ` :${apiPort}` : ""}
            </span>
          </span>
        }
      />
      {toast && <div className="toast">{toast}</div>}
      {helpOpen && <Help onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
