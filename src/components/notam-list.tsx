"use client";

import { fmtZ } from "@/lib/format";
import { GROUP_ORDER, isActive, type Notam, type NotamGroup } from "@/lib/notams/classify";
import type { NotamResult } from "@/lib/notams/faa";

const GROUP_LABEL: Record<NotamGroup, string> = {
  runway: "Runways",
  navaid: "Navaids & GNSS",
  taxiway: "Taxiways & aprons",
  lighting: "Lighting",
  obstacle: "Obstacles",
  airspace: "Airspace",
  procedure: "Procedures & ATS",
  other: "Other",
};

/** Groups that are long and rarely urgent start closed. */
const COLLAPSED: NotamGroup[] = ["obstacle", "airspace", "procedure", "other"];

const DAY = 86_400_000;

function validity(n: Notam) {
  const from = n.start ? fmtZ(n.start) : "";
  const fromDay = n.start ? n.start.slice(5, 10).replace("-", "/") : "";
  const to = n.end ? `${n.end.slice(5, 10).replace("-", "/")} ${fmtZ(n.end)}${n.estimatedEnd ? " EST" : ""}` : "PERM";
  return `${fromDay} ${from} → ${to}`;
}

/** Splits NOTAMs into active now and starting within 24h; drops expired and far-future ones. */
export function relevantNotams(notams: Notam[], now: Date) {
  const soon = new Date(now.getTime() + DAY).toISOString();
  const active = notams.filter((n) => isActive(n, now));
  const upcoming = notams.filter((n) => !isActive(n, now) && n.start && n.start > now.toISOString() && n.start <= soon);
  return { active, upcoming };
}

export function NotamList({ result, now }: { result: NotamResult | null; now: number }) {
  if (!result) return <p className="text-sm text-muted">Loading NOTAMs…</p>;
  if (result.status === "not-configured") {
    return <p className="text-sm text-muted">NOTAMs are not set up on this server (FAA NOTAM API keys missing).</p>;
  }
  if (result.status === "error") return <p className="text-sm text-danger">NOTAMs unavailable: {result.message}</p>;

  const { active, upcoming } = relevantNotams(result.notams, new Date(now));
  if (!active.length && !upcoming.length) return <p className="text-sm text-muted">No active NOTAMs.</p>;

  const all = [...active.map((n) => ({ n, upcoming: false })), ...upcoming.map((n) => ({ n, upcoming: true }))];
  return (
    <div className="flex flex-col gap-2">
      {GROUP_ORDER.map((g) => {
        const items = all.filter(({ n }) => n.group === g).sort((a, b) => (a.n.severity === b.n.severity ? 0 : a.n.severity === "warn" ? -1 : 1));
        if (!items.length) return null;
        const warn = items.filter(({ n }) => n.severity === "warn").length;
        return (
          <details key={g} open={!COLLAPSED.includes(g) || warn > 0} className="rounded-md border border-line">
            <summary className="cursor-pointer px-3 py-2 text-sm">
              {GROUP_LABEL[g]} <span className="text-muted">({items.length})</span>
              {warn > 0 && <span className="ml-2 text-xs text-warn">{warn} important</span>}
            </summary>
            <ul className="divide-y divide-line border-t border-line">
              {items.map(({ n, upcoming: up }) => (
                <li key={n.id + n.text.slice(0, 20)} className="px-3 py-2 text-sm">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={`rounded border px-1.5 py-0.5 ${n.severity === "warn" ? "border-warn/60 text-warn" : "border-line text-muted"}`}
                    >
                      {n.summary}
                    </span>
                    <span className="font-mono text-muted">{n.id}</span>
                    <span className="font-mono text-muted">{validity(n)}</span>
                    {up && <span className="text-accent">starts within 24h</span>}
                  </div>
                  <pre className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed">{n.text}</pre>
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
