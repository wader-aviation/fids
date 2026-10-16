"use client";

import { useEffect, useRef, useState } from "react";
import { LandingIcon, TakeoffIcon } from "./icons";

/** The order a real flap drum turns through. */
const DRUM = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:./-";
const STEP_MS = 55;
const MAX_STEPS = 10; // long trips jump ahead so a row settles in well under a second
const STAGGER_MS = 22;

const norm = (c: string) => (DRUM.includes(c) ? c : " ");

function path(from: string, to: string): string[] {
  const a = DRUM.indexOf(norm(from));
  const b = DRUM.indexOf(norm(to));
  const dist = (b - a + DRUM.length) % DRUM.length;
  const steps = Math.min(dist, MAX_STEPS);
  const out: string[] = [];
  for (let i = steps - 1; i >= 1; i--) out.push(DRUM[(b - i + DRUM.length) % DRUM.length]);
  out.push(DRUM[b]);
  return out;
}

const pad = (text: string, width: number) => text.toUpperCase().slice(0, width).padEnd(width, " ");

/** Fixed-width text on flap cells. When the text changes, every cell turns through the drum to its new letter. */
export function FlapText({ text, width, tone = "yellow", delay = 0 }: { text: string; width: number; tone?: FlapTone; delay?: number }) {
  const target = pad(text, width);
  const [shown, setShown] = useState(() => " ".repeat(width));
  const [flipping, setFlipping] = useState<boolean[]>(() => new Array(width).fill(false));
  const current = useRef(" ".repeat(width));

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const from = current.current;
    const set = (i: number, c: string, flip: boolean) => {
      const chars = current.current.split("");
      chars[i] = c;
      current.current = chars.join("");
      setShown(current.current);
      setFlipping((f) => {
        const next = [...f];
        next[i] = flip;
        return next;
      });
    };
    for (let i = 0; i < width; i++) {
      if (from[i] === target[i]) continue;
      if (reduce) {
        timers.push(setTimeout(() => set(i, target[i], false), 0));
        continue;
      }
      path(from[i], target[i]).forEach((c, s, all) => {
        timers.push(setTimeout(() => set(i, c, s < all.length - 1), delay + i * STAGGER_MS + s * STEP_MS));
      });
    }
    return () => timers.forEach(clearTimeout);
  }, [target, width, delay]);

  return (
    <span className={`flap-text flap-${tone}`} aria-label={text}>
      {shown.split("").map((c, i) => (
        <span key={i} className={`flap ${flipping[i] ? "flipping" : ""}`} aria-hidden>
          <span key={c + i}>{c === " " ? " " : c}</span>
        </span>
      ))}
    </span>
  );
}

export type FlapTone = "yellow" | "white" | "green" | "red" | "dim";

export interface FlapColumn {
  label: string;
  width: number;
}

export interface FlapCell {
  text: string;
  tone?: FlapTone;
  /** Makes the cell a button (e.g. open a flight's history). */
  onClick?: () => void;
  title?: string;
}

export interface FlapRow {
  key: string;
  cells: FlapCell[];
}

/** A departures/arrivals board in the style of an airport split-flap display. */
export function FlapBoard({
  title,
  direction,
  columns,
  rows,
  minRows = 10,
  note,
}: {
  title: string;
  direction: "dep" | "arr";
  columns: FlapColumn[];
  rows: FlapRow[];
  minRows?: number;
  note?: string;
}) {
  const chars = columns.reduce((n, c) => n + c.width, 0);
  const blanks = Math.max(0, minRows - rows.length);
  return (
    <section className="flap-board overflow-hidden" style={{ containerType: "inline-size" }} aria-label={title}>
      {/* Character size follows the panel width so every column always fits. */}
      <div style={{ fontSize: `min(17px, calc((100cqw - ${columns.length * 10 + 24}px) / ${chars * 1.02}))` }}>
        <header className="flex items-center gap-3 px-3 pt-3 pb-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md" style={{ background: "#f5d33f", color: "#111" }}>
            {direction === "dep" ? <TakeoffIcon /> : <LandingIcon />}
          </span>
          <h2 className="text-2xl font-semibold tracking-wide text-white">{title}</h2>
        </header>
        <div className="flex gap-[10px] px-[10px] pb-1 font-medium tracking-wider text-white/80">
          {columns.map((c) => (
            // Same width as the flap cells below: width × 0.92em plus 1px gaps.
            <span key={c.label} className="shrink-0" style={{ width: `calc(${c.width * 0.92}em + ${c.width - 1}px)` }}>
              <span className="text-[0.75em]">{c.label}</span>
            </span>
          ))}
        </div>
        <div role="table">
          {rows.map((r, ri) => (
            // Keyed by position, not flight: when the list moves, letters flip in place like a real board.
            <div key={`row-${ri}`} role="row" className="flap-row">
              {r.cells.map((cell, ci) => (
                <span role="cell" key={ci}>
                  {cell.onClick && cell.text.trim() ? (
                    <button
                      onClick={cell.onClick}
                      title={cell.title}
                      aria-label={cell.title ? `${cell.title}: ${cell.text}` : cell.text}
                      className="rounded-[3px] outline-offset-2 hover:outline hover:outline-1 hover:outline-[#f5d33f]/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f5d33f]"
                    >
                      <FlapText text={cell.text} width={columns[ci].width} tone={cell.tone} delay={ri * 40} />
                    </button>
                  ) : (
                    <FlapText text={cell.text} width={columns[ci].width} tone={cell.tone} delay={ri * 40} />
                  )}
                </span>
              ))}
            </div>
          ))}
          {Array.from({ length: blanks }, (_, i) => (
            <div key={`blank-${i}`} className="flap-row" aria-hidden>
              {columns.map((c, ci) => (
                <span key={ci}>
                  <FlapText text="" width={c.width} />
                </span>
              ))}
            </div>
          ))}
        </div>
        {note && <p className="px-3 py-2 text-[11px] text-white/50">{note}</p>}
      </div>
    </section>
  );
}
