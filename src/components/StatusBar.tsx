import { Fragment } from "react";
import type React from "react";

export interface Hint {
  keys: string[];
  label: string;
}

const MODS = new Set(["⌘", "⌥", "⌃", "⇧"]);

/** Render a key group. Combos (containing a modifier) are joined with "+";
 *  alternatives (j/k, 1/2/3) are just spaced keycaps. */
export function Keys({ keys }: { keys: string[] }) {
  const combo = keys.some((k) => MODS.has(k));
  return (
    <span className="keys">
      {keys.map((k, i) => (
        <Fragment key={i}>
          {i > 0 && combo && <span className="key-sep">+</span>}
          <kbd>{k}</kbd>
        </Fragment>
      ))}
    </span>
  );
}

/** Bottom status bar showing only the shortcuts valid in the current context. */
export function StatusBar({
  hints,
  className = "",
  right,
}: {
  hints: Hint[];
  className?: string;
  right?: React.ReactNode;
}) {
  return (
    <footer className={`statusbar ${className}`}>
      <div className="sb-left">
        {hints.map((h, i) => (
          <span key={i}>
            <Keys keys={h.keys} /> {h.label}
          </span>
        ))}
      </div>
      {right && <div className="sb-right">{right}</div>}
    </footer>
  );
}
