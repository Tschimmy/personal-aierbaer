import { useEffect, useRef } from "react";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { APP_VERSION } from "../lib/releaseNotes";

/** User-facing explainer: what the app does, and how to go beyond it via the
 *  local API, the aierbaer-api skill, other agents, and your own dashboard. */
export function Help({ onClose }: { onClose: () => void }) {
  const bodyRef = useRef<HTMLDivElement>(null);

  // Own the keys while open (capture) so j/k scroll the modal, not the inbox.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      } else if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        e.stopImmediatePropagation();
        bodyRef.current?.scrollBy({ top: 90 });
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopImmediatePropagation();
        bodyRef.current?.scrollBy({ top: -90 });
      } else if (e.key === "g") {
        bodyRef.current?.scrollTo({ top: 0 });
      } else if (e.key === "G") {
        bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="prefs-backdrop" onClick={onClose}>
      <div className="prefs-panel help-panel" onClick={(e) => e.stopPropagation()}>
        <header className="prefs-head" data-tauri-drag-region>
          <span className="prefs-title">How Personal Aierbaer works</span>
          <button className="prefs-close" onClick={onClose}>✕</button>
        </header>

        <div className="help-body" ref={bodyRef}>
          <section>
            <h3>The idea</h3>
            <p>
              Aierbaer watches your ClickUp support inbox. For each ticket, a local
              <b> pi</b> agent reads it, looks at your repo and past solutions, and
              drafts a structured <b>solution report</b>. You review it, and record
              which option actually fixed it. Those resolutions become a memory the
              agent reuses on similar tickets later.
            </p>
          </section>

          <section>
            <h3>In the app</h3>
            <ul>
              <li>New tickets <b>auto-solve</b> — a report appears without you clicking.</li>
              <li>Click a ticket (or <kbd>j</kbd>/<kbd>k</kbd>) to see its report below.</li>
              <li><kbd>s</kbd> re-solve, <kbd>r</kbd> set the real solution, <kbd>d</kbd> remove it.</li>
              <li>Resolved tickets turn green with the chosen option; <kbd>⌘</kbd><kbd>U</kbd> hides them.</li>
              <li><kbd>⌘</kbd><kbd>C</kbd> copies the selected ticket's ID (handy for the steps below).</li>
            </ul>
          </section>

          <section>
            <h3>Drive it from another agent or dashboard</h3>
            <p>
              While the app is open it runs a small <b>local API</b> at
              <code> http://127.0.0.1:&lt;port&gt;</code> (see Settings → Local API for the
              port + token). Anything that can make HTTP calls can:
            </p>
            <ul>
              <li>list the inbox with resolution status,</li>
              <li>read a ticket's report and resolution,</li>
              <li>start a solve, set or remove a resolution.</li>
            </ul>
            <p>
              So you can build <b>your own dashboard</b> on top of Aierbaer without
              re-implementing the ClickUp/pi integration — Aierbaer stays the engine.
            </p>
          </section>

          <section>
            <h3>The aierbaer-api skill</h3>
            <p>
              Your coding agent of choice (via pi/Claude/etc.) can use the installed
              <b> aierbaer-api</b> skill to talk to the app for you. Ask it things like
              "list unresolved Aierbaer tickets", "show the report for &lt;id&gt;", or
              "mark &lt;id&gt; solved with option A". It reads the token from
              <code> $AIERBAER_TOKEN</code> or the app's config file automatically.
            </p>
            <p>
              Good pattern: if a drafted report isn't quite right but you don't want to
              start over, <kbd>⌘</kbd><kbd>C</kbd> the ticket ID, hand it to another
              agent with the report, let it improve the solution, then post it back as
              the resolution.
            </p>
          </section>

          <section>
            <h3>Jump straight to a ticket</h3>
            <p>
              From a browser or dashboard, <code>aierbaer://open/&lt;id&gt;</code> focuses
              the app on that ticket, and <code>aierbaer://solve/&lt;id&gt;</code> starts a
              solve.
            </p>
          </section>

          <section>
            <h3>Limits</h3>
            <ul>
              <li>v1 runs on your GitHub Copilot subscription; everything is local.</li>
              <li>The agent proposes — you decide. Always confirm the real fix.</li>
              <li>Reports live on your Mac; there's no shared team memory yet.</li>
            </ul>
          </section>

          <p className="help-foot">
            Personal Aierbaer v{APP_VERSION} · full API docs on{" "}
            <button
              className="inline-link"
              onClick={() => openUrl("https://github.com/Tschimmy/personal-aierbaer/blob/main/API.md")}
            >
              GitHub ↗
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
