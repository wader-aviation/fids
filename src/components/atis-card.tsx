"use client";

import { useMemo, useState } from "react";
import type { AtisRecord } from "@/lib/data/types";
import { diffAtis, type AtisDiff } from "@/lib/decoder/diff";
import { windComponents } from "@/lib/decoder/ops";
import { fmtAge, fmtCeil, fmtVis, fmtWind, fmtZ, minutesSince } from "@/lib/format";
import { CategoryPill, FlagChips, LetterBadge } from "./bits";

const FIELD_LABEL: Record<string, string> = {
  letter: "Letter",
  arrivalRunways: "Arrival runways",
  departureRunways: "Departure runways",
  approaches: "Approaches",
  wind: "Wind",
  qnh: "QNH",
  visibility: "Visibility (m)",
  ceiling: "Ceiling (ft)",
  flags: "Flags",
};

/** One ATIS (arrival, departure or combined): decoded fields, 24h letter timeline, diff, full text. */
export function AtisCard({ title, current, history, now }: { title: string; current: AtisRecord; history: AtisRecord[]; now: number }) {
  const list = useMemo(() => (history.some((h) => h.key === current.key) ? history : [current, ...history]), [history, current]);
  // null = follow the newest ATIS.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [compareKey, setCompareKey] = useState<string | null>(null);

  const selected = (selectedKey && list.find((r) => r.key === selectedKey)) || current;
  const idx = list.findIndex((r) => r.key === selected.key);
  const defaultPrev = list[idx + 1] ?? null;
  const compare = compareKey ? list.find((r) => r.key === compareKey) ?? null : defaultPrev;
  const diff: AtisDiff | null = compare ? diffAtis(compare.decoded, selected.decoded) : null;
  const d = selected.decoded;
  const heard = minutesSince(selected.lastSeen, now);

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4">
      <div className="flex items-start gap-4">
        <LetterBadge letter={selected.letter} size="xl" stale={heard > 60} />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title} ATIS</h2>
          <p className="font-mono text-lg">
            Information {selected.letter} · {d.issued ? `${d.issued}Z` : fmtZ(selected.issuedAt)}
          </p>
          <p className="text-xs text-muted">
            Issued {fmtAge(minutesSince(selected.issuedAt, now))} ago · heard {selected.sightings}× · last {fmtAge(heard)} ago
            {selected.key !== current.key && <span className="text-warn"> · older issue</span>}
          </p>
          {selected.truncated && <p className="mt-1 text-xs text-warn">Only part of this ATIS was received.</p>}
        </div>
        <CategoryPill cat={d.flightCategory} />
      </div>

      {list.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="ATIS timeline, last 24 hours">
          <span className="mr-1 text-xs text-muted">24h:</span>
          {[...list].reverse().map((r) => (
            <button
              key={r.key}
              onClick={() => {
                setSelectedKey(r.key === current.key ? null : r.key);
                setCompareKey(null);
              }}
              title={`${r.letter} ${fmtZ(r.issuedAt)}`}
              className={`rounded border px-1.5 py-0.5 font-mono text-xs ${
                r.key === selected.key ? "border-accent text-accent" : "border-line text-muted hover:text-fg"
              }`}
            >
              {r.letter}
              <span className="ml-1 opacity-70">{fmtZ(r.issuedAt).slice(0, 4)}</span>
            </button>
          ))}
        </div>
      )}

      <FlagChips flags={d.flags} />

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <Field label="Arrival rwy" value={d.arrivalRunways.join(" ") || "—"} />
        <Field label="Departure rwy" value={d.departureRunways.join(" ") || "—"} />
        <Field label="Approach" value={d.approaches.map((a) => `${a.type}${a.runways.length ? ` ${a.runways.join("/")}` : ""}`).join(", ") || "—"} />
        <Field label="Wind" value={fmtWind(d.wind)} />
        <Field label="Visibility" value={fmtVis(d)} />
        <Field label="Ceiling" value={fmtCeil(d)} />
        <Field label="Clouds" value={d.clouds.map((c) => `${c.cover}${Math.round(c.baseFt / 100).toString().padStart(3, "0")}${c.type ?? ""}`).join(" ") || "—"} />
        <Field label="Temp / dew" value={d.temperatureC !== undefined ? `${d.temperatureC}° / ${d.dewpointC ?? "—"}°` : "—"} />
        <Field label="QNH" value={d.qnh ? `${d.qnh.hpa} hPa · ${d.qnh.inHg.toFixed(2)} inHg` : "—"} />
        <Field label="Transition" value={[d.transitionAltitudeFt && `TA ${d.transitionAltitudeFt}`, d.transitionLevel && `TL ${d.transitionLevel}`].filter(Boolean).join(" · ") || "—"} />
        <Field label="RWYCC" value={d.rwycc !== undefined ? String(d.rwycc) : "—"} />
      </dl>

      <WindTable d={d} />

      {diff && compare && (
        <div className="rounded-md border border-line bg-surface-2 p-3 text-sm">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
            What changed since
            <select
              value={compare.key}
              onChange={(e) => setCompareKey(e.target.value)}
              className="rounded border border-line bg-surface px-1 py-0.5 font-mono text-fg"
            >
              {list
                .filter((r) => r.key !== selected.key)
                .map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.letter} {fmtZ(r.issuedAt)}
                  </option>
                ))}
            </select>
          </div>
          {diff.changes.every((c) => c.field === "letter") && diff.added.length === 0 && diff.removed.length === 0 ? (
            <p className="text-muted">No changes.</p>
          ) : (
            <>
              <ul className="mb-2 space-y-0.5 font-mono text-xs">
                <FlagChanges from={compare} to={selected} />
                {diff.changes
                  .filter((c) => c.field !== "letter" && c.field !== "flags")
                  .map((c) => (
                    <li key={c.field}>
                      <span className="text-muted">{FIELD_LABEL[c.field]}:</span> <span className="line-through opacity-60">{c.from || "—"}</span> →{" "}
                      <span className="text-accent">{c.to || "—"}</span>
                    </li>
                  ))}
              </ul>
              <ul className="space-y-0.5 font-mono text-xs">
                {diff.added.map((s) => (
                  <li key={`+${s}`} className="text-ok">
                    + {s}
                  </li>
                ))}
                {diff.removed.map((s) => (
                  <li key={`-${s}`} className="text-danger opacity-80">
                    − {s}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <details open className="text-sm">
        <summary className="cursor-pointer text-xs uppercase tracking-wide text-muted">Full text</summary>
        <pre className="mt-2 whitespace-pre-wrap rounded-md bg-surface-2 p-3 font-mono text-[13px] leading-relaxed">{d.lines.join("\n")}</pre>
      </details>
    </section>
  );
}

function FlagChanges({ from, to }: { from: AtisRecord; to: AtisRecord }) {
  const before = new Map(from.decoded.flags.map((f) => [f.id, f.label]));
  const after = new Map(to.decoded.flags.map((f) => [f.id, f.label]));
  const added = [...after].filter(([id]) => !before.has(id)).map(([, l]) => l);
  const removed = [...before].filter(([id]) => !after.has(id)).map(([, l]) => l);
  if (!added.length && !removed.length) return null;
  return (
    <li>
      <span className="text-muted">Flags:</span>
      {added.map((l) => (
        <span key={l} className="ml-2 text-warn">
          + {l}
        </span>
      ))}
      {removed.map((l) => (
        <span key={l} className="ml-2 opacity-60">
          − {l}
        </span>
      ))}
    </li>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="font-mono break-words">{value}</dd>
    </div>
  );
}

function WindTable({ d }: { d: AtisRecord["decoded"] }) {
  const runways = [...new Set([...d.arrivalRunways, ...d.departureRunways])];
  if (!d.wind || d.wind.direction === null || !runways.length) return null;
  const rows = runways.map((r) => windComponents(d.wind!, r)!).filter(Boolean);
  return (
    <table className="w-full max-w-md text-left font-mono text-xs">
      <thead className="text-muted">
        <tr>
          <th className="font-normal">Runway</th>
          <th className="font-normal">Head/tail</th>
          <th className="font-normal">Cross</th>
          {d.wind.gustKt && <th className="font-normal">Gust cross</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr key={c.runway}>
            <td>{c.runway}</td>
            <td className={c.headwindKt < 0 ? "text-warn" : ""}>{c.headwindKt < 0 ? `TW ${-c.headwindKt}` : `HW ${c.headwindKt}`}</td>
            <td>{c.crosswindKt}</td>
            {d.wind!.gustKt && <td>{c.gustCrosswindKt}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
