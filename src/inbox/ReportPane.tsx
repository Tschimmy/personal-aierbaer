import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { marked } from "marked";
import { readReportFor, saveResolution, deleteResolution, loadReportsDir, type ClickUpTask } from "../lib/api";
import { Keys } from "../components/StatusBar";

interface Props {
  task: ClickUpTask;
  solving: boolean;
  onSolve: (taskId: string) => void;
  onReportsChanged: () => void;
  focused?: boolean;
  resolveSignal?: number;
  deleteSignal?: number;
}

interface Card {
  key: string;
  label: string | null; // null = header/meta card
  html: string;
  resolution?: boolean;
}

/** Split the skill's markdown into its known sections (header + each `## `). */
function parseReport(md: string): Card[] {
  const blocks = md.split(/\n(?=## )/);
  const cards: Card[] = [];
  blocks.forEach((block, i) => {
    const trimmed = block.trim();
    if (!trimmed) return;
    if (i === 0 && !trimmed.startsWith("## ")) {
      cards.push({ key: "header", label: null, html: marked.parse(trimmed) as string });
      return;
    }
    const nl = trimmed.indexOf("\n");
    const heading = (nl === -1 ? trimmed : trimmed.slice(0, nl)).replace(/^##\s*/, "");
    const body = nl === -1 ? "" : trimmed.slice(nl + 1);
    cards.push({
      key: `${i}-${heading}`,
      label: heading,
      html: marked.parse(body) as string,
      resolution: heading.toLowerCase() === "resolution",
    });
  });
  // Show the Resolution section first when present.
  const ri = cards.findIndex((c) => c.resolution);
  if (ri > 0) {
    const [res] = cards.splice(ri, 1);
    cards.unshift(res);
  }
  return cards;
}

/** Bottom split pane: the generated solution report rendered as a form of
 *  section cards. When focused, j/k jump between sections. */
export function ReportPane({ task, solving, onSolve, onReportsChanged, focused, resolveSignal, deleteSignal }: Props) {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(0);
  const [options, setOptions] = useState<string[]>([]);
  const [resolving, setResolving] = useState(false);
  const [choice, setChoice] = useState("");
  const [notes, setNotes] = useState("");
  const [savingRes, setSavingRes] = useState(false);
  const [existingRes, setExistingRes] = useState<{ choice: string; notes: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const md = await readReportFor(task.id, loadReportsDir());
      setCards(md ? parseReport(md) : null);
      // Option headings from "### Option A: ..." for the resolution picker.
      const opts = md ? [...md.matchAll(/^###\s*(Option [^\n]+)/gm)].map((m) => m[1].trim()) : [];
      setOptions(opts);
      // Pre-parse an existing resolution so re-opening the form is pre-filled.
      const sec = md?.match(/\n## Resolution\n([\s\S]*)$/);
      if (sec) {
        const chosen = sec[1].match(/\*\*Chosen:\*\*\s*(.+)/)?.[1]?.trim() ?? "";
        const afterResolved = sec[1].split(/\*\*Resolved:\*\*[^\n]*\n/);
        const notes = (afterResolved.length > 1 ? afterResolved[1] : "").trim();
        setExistingRes({ choice: chosen, notes });
      } else {
        setExistingRes(null);
      }
      setActive(0);
    } catch {
      setCards(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  useEffect(() => {
    const unDone = listen<{ taskId: string; ok: boolean }>("pi-done", (e) => {
      onReportsChanged();
      if (e.payload.taskId === task.id) load();
    });
    return () => {
      unDone.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  useEffect(() => {
    if (focused) setActive((a) => a); // no-op; keep current on (re)focus
  }, [focused]);

  // j/k move between section cards while the report is focused.
  useEffect(() => {
    if (!focused || !cards) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.min(cards.length - 1, a + 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => Math.max(0, a - 1));
      } else if (e.key === "g") {
        setActive(0);
      } else if (e.key === "G") {
        setActive(cards.length - 1);
      } else if (e.key === "r") {
        e.preventDefault();
        openResolution();
      } else if (e.key === "d" && existingRes) {
        e.preventDefault();
        deleteRes();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, cards, options, existingRes]);

  const openResolution = () => {
    if (existingRes) {
      setChoice(existingRes.choice || options[0] || "Other");
      setNotes(existingRes.notes);
    } else {
      setChoice(options[0] ?? "Other");
      setNotes("");
    }
    setResolving(true);
  };

  // Trigger from the inbox (r on the selected ticket).
  useEffect(() => {
    if (resolveSignal && cards) openResolution();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolveSignal]);

  const deleteRes = async () => {
    await deleteResolution(task.id, loadReportsDir());
    await load();
    onReportsChanged();
  };

  // Trigger delete from the inbox (d on a resolved ticket).
  useEffect(() => {
    if (deleteSignal && existingRes) deleteRes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteSignal]);

  // Resolution form keys: 1/2/3 pick option (3 = Other → into textbox),
  // ⌘↵ save, esc blur textbox / cancel.
  useEffect(() => {
    if (!resolving) return;
    const onKey = (e: KeyboardEvent) => {
      const list = [...resRef.current.options, "Other"];
      const inTextarea = document.activeElement === textareaRef.current;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (inTextarea) textareaRef.current?.blur();
        else setResolving(false);
      } else if (e.metaKey && e.key === "Enter") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (resRef.current.choice && !resRef.current.savingRes) resRef.current.saveRes();
      } else if (!inTextarea && /^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        if (idx < list.length) {
          e.preventDefault();
          setChoice(list[idx]);
          if (list[idx] === "Other") setTimeout(() => textareaRef.current?.focus(), 0);
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [resolving]);

  const saveRes = async () => {
    setSavingRes(true);
    try {
      await saveResolution(task.id, choice, notes, loadReportsDir());
      setResolving(false);
      await load();
      onReportsChanged();
    } finally {
      setSavingRes(false);
    }
  };

  // Latest values + save fn for the capture-phase key handler.
  const resRef = useRef({ options, choice, savingRes, saveRes });
  resRef.current = { options, choice, savingRes, saveRes };

  // Scroll the active section into view.
  useEffect(() => {
    if (!focused) return;
    bodyRef.current
      ?.querySelector(`[data-card="${active}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active, focused]);

  return (
    <div className={`report-pane ${focused ? "pane-active" : ""}`}>
      <div className="report-head">
        <div className="report-title">{task.name}</div>
        <div className="report-head-actions">
          {cards && (
            <button className="open" onClick={openResolution} title="Set solution (r)">
              {existingRes ? "Edit solution" : "Set solution"}
            </button>
          )}
          {existingRes && (
            <button className="open danger" onClick={deleteRes} title="Delete solution (d)">
              Remove solution
            </button>
          )}
          <a href={task.url} target="_blank" rel="noreferrer" className="open">
            Open in ClickUp ↗
          </a>
          <button className="solve" onClick={() => onSolve(task.id)} disabled={solving}>
            {solving ? "solving…" : cards ? "Re-solve" : "Solve"}
          </button>
        </div>
      </div>

      {resolving && (
        <div className="resolution-overlay" onClick={() => setResolving(false)}>
          <div className="resolution-form" onClick={(e) => e.stopPropagation()}>
            <div className="card-label">Record the actual solution</div>
            <div className="res-options">
              {[...options, "Other"].map((o, i) => (
                <label
                  key={o}
                  className={`res-option ${choice === o ? "opt-sel" : ""}`}
                  onClick={() => setChoice(o)}
                >
                  <kbd className="opt-num">{i + 1}</kbd>
                  <input
                    type="radio"
                    name="resolution"
                    checked={choice === o}
                    onChange={() => setChoice(o)}
                  />
                  {o}
                </label>
              ))}
            </div>
            <textarea
              ref={textareaRef}
              placeholder="What actually fixed it / what was decided…  ·  press Esc to leave the textbox"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={5}
            />
            <div className="res-hint">
              <Keys keys={["1"]} /><Keys keys={["2"]} /><Keys keys={["3"]} /> choose ·{" "}
              <Keys keys={["⌘", "↵"]} /> save · <Keys keys={["esc"]} /> blur / cancel
            </div>
            <div className="res-actions">
              <button className="ghost" onClick={() => setResolving(false)}>
                Cancel
              </button>
              <button className="primary" disabled={!choice || savingRes} onClick={saveRes}>
                {savingRes ? "Saving…" : "Save solution"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="report-body" ref={bodyRef}>
        {loading && <div className="report-empty">Loading report…</div>}

        {solving && (
          <div className="report-empty">
            <span className="spinner" /> pi agent is analyzing this ticket…
          </div>
        )}

        {!loading && !solving && !cards && (
          <div className="report-empty">
            No report yet. Click <b>Solve</b> to generate one.
          </div>
        )}

        {!loading && !solving && cards && (
          <div className="report-form">
            {cards.map((c, i) => (
              <section
                key={c.key}
                data-card={i}
                className={`report-card ${c.resolution ? "resolution" : ""} ${focused && i === active ? "card-active" : ""}`}
                onClick={() => setActive(i)}
              >
                {c.label && <div className="card-label">{c.label}</div>}
                <div
                  className="report-md"
                  dangerouslySetInnerHTML={{ __html: c.html }}
                />
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
