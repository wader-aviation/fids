"use client";

import Link from "next/link";
import { fmtAge, fmtZ } from "@/lib/format";
import type { FlightLeg, LegStatus } from "@/lib/movements/types";

export type BoardLeg = FlightLeg & { status: LegStatus; originCity: string | null; destinationCity: string | null };

const STATUS: Record<LegStatus, { label: string; cls: string }> = {
  "taxi-out": { label: "Taxiing", cls: "text-warn border-warn/50" },
  airborne: { label: "Airborne", cls: "text-accent border-accent/50" },
  "en-route": { label: "En route", cls: "text-accent border-accent/50" },
  landed: { label: "Landed", cls: "text-ok border-ok/50" },
  "at-gate": { label: "At gate", cls: "text-muted border-line" },
  unknown: { label: "Heard", cls: "text-muted border-line" },
};

const z = (s: string | null) => (s ? fmtZ(s) : "—");

function relative(s: string | null, now: number) {
  if (!s) return null;
  const min = Math.round((new Date(s).getTime() - now) / 60_000);
  return min >= 0 ? `in ${fmtAge(min)}` : `${fmtAge(-min)} ago`;
}

function Place({ icao, city }: { icao: string | null; city: string | null }) {
  if (!icao) return <span className="text-muted">?</span>;
  return (
    <Link href={`/a/${icao}`} className="hover:text-accent">
      <span className="font-mono">{icao}</span>
      {city && <span className="ml-1.5 text-xs text-muted">{city}</span>}
    </Link>
  );
}

export function FlightsTable({ legs, dir, now }: { legs: BoardLeg[]; dir: "dep" | "arr"; now: number }) {
  if (!legs.length) {
    return (
      <p className="rounded-lg border border-line bg-surface p-6 text-sm text-muted">
        No {dir === "dep" ? "departures" : "arrivals"} heard over ACARS in the last 3 hours.
      </p>
    );
  }
  const head = dir === "dep" ? ["Flight", "Tail", "To", "Out", "Off", "Status"] : ["Flight", "Tail", "From", "ETA", "On", "In", "Rwy", "Status"];
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[34rem] text-left text-sm">
        <thead className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {legs.map((l) => {
            const s = STATUS[l.status];
            return (
              <tr key={l.key} className="border-b border-line last:border-b-0">
                <td className="px-3 py-2 font-mono font-semibold">{l.flight ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-muted">{l.tail}</td>
                {dir === "dep" ? (
                  <>
                    <td className="px-3 py-2">
                      <Place icao={l.destination} city={l.destinationCity} />
                    </td>
                    <td className="px-3 py-2 font-mono">{z(l.outAt)}</td>
                    <td className="px-3 py-2 font-mono">{z(l.offAt)}</td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-2">
                      <Place icao={l.origin} city={l.originCity} />
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {l.eta && !l.onAt && !l.inAt ? (
                        <>
                          {z(l.eta)} <span className="text-xs text-muted">{relative(l.eta, now)}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono">{z(l.onAt)}</td>
                    <td className="px-3 py-2 font-mono">{z(l.inAt)}</td>
                    <td className="px-3 py-2 font-mono">{l.arrivalRunway ?? "—"}</td>
                  </>
                )}
                <td className="px-3 py-2">
                  <span className={`rounded border px-1.5 py-0.5 text-[11px] whitespace-nowrap ${s.cls}`} title={`Last heard ${relative(l.lastSeen, now)}`}>
                    {s.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
