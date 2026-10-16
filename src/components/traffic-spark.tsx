"use client";

import { useState } from "react";

const W = 96;
const H = 34;
const MID = H / 2;
const GAP = 2;

/**
 * Departures above the line, arrivals below, one bar pair per 30 minutes over the last 3 hours.
 * Position (up/down) carries identity as well as colour, so it reads without colour too.
 */
export function TrafficSpark({ dep, arr, scale }: { dep: number[]; arr: number[]; scale: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = dep.length;
  const slot = W / n;
  const barW = slot - GAP;
  const max = Math.max(1, scale);
  const h = (v: number) => (v === 0 ? 0 : Math.max(2, (v / max) * (MID - 2)));
  const label = (i: number) => {
    const fromMin = (n - i) * 30;
    const toMin = (n - i - 1) * 30;
    return toMin === 0 ? `last 30 min` : `${fromMin}–${toMin} min ago`;
  };

  return (
    <div className="relative">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Departures ${dep.join(", ")}; arrivals ${arr.join(", ")} per 30 minutes, last 3 hours`}>
        {dep.map((v, i) => {
          const x = i * slot + GAP / 2;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={x - GAP / 2} y={0} width={slot} height={H} fill="transparent" />
              {v > 0 && <rect x={x} y={MID - 1 - h(v)} width={barW} height={h(v)} rx={2} fill="var(--dep)" opacity={hover === null || hover === i ? 1 : 0.45} />}
              {arr[i] > 0 && <rect x={x} y={MID + 1} width={barW} height={h(arr[i])} rx={2} fill="var(--arr)" opacity={hover === null || hover === i ? 1 : 0.45} />}
            </g>
          );
        })}
        <line x1={0} x2={W} y1={MID} y2={MID} stroke="var(--border)" strokeWidth={1} />
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 -translate-x-1/2 rounded-md border border-line bg-surface-2 px-2 py-1 text-[11px] whitespace-nowrap text-fg shadow-lg">
          <div className="text-muted">{label(hover)}</div>
          <div>
            <span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: "var(--dep)" }} />
            {dep[hover]} departed
          </div>
          <div>
            <span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: "var(--arr)" }} />
            {arr[hover]} landed
          </div>
        </div>
      )}
    </div>
  );
}
