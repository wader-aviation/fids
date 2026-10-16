"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { fmtAge } from "@/lib/format";
import type { FlightLeg, LegStatus } from "@/lib/movements/types";
import { CloseIcon } from "./icons";

export type HistoryQuery = { tail: string } | { flight: string };

type Leg = FlightLeg & { status: LegStatus; originCity: string | null; destinationCity: string | null };

const STATUS: Record<LegStatus, string> = {
  "taxi-out": "Taxiing",
  airborne: "Airborne",
  "en-route": "En route",
  landed: "Landed",
  "at-gate": "At gate",
  unknown: "Heard",
};

const utc = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}Z`;
};
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });

/** Side panel listing every leg of one aircraft or one flight number heard over ACARS (last 3 days). */
export function LegHistory({ query, onClose, onOpen }: { query: HistoryQuery; onClose: () => void; onOpen: (q: HistoryQuery) => void }) {
  const [legs, setLegs] = useState<Leg[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const panel = useRef<HTMLDivElement>(null);
  const isTail = "tail" in query;
  const id = isTail ? query.tail : query.flight;

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      setLegs(null);
      try {
        const res = await fetch(`/api/v1/legs?${isTail ? "tail" : "flight"}=${encodeURIComponent(id)}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        if (alive) setLegs(body.data.legs);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "failed");
      }
    }, 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [id, isTail]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    panel.current?.focus();
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);


  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`${isTail ? "Aircraft" : "Flight"} ${id} history`}>
      <button className="absolute inset-0 bg-black/50" aria-label="Close" onClick={onClose} />
      <div ref={panel} tabIndex={-1} className="relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-line bg-bg shadow-2xl outline-none">
        <header className="sticky top-0 flex items-start gap-3 border-b border-line bg-bg px-5 py-4">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-muted">{isTail ? "Aircraft" : "Flight"}</div>
            <h2 className="font-mono text-2xl font-semibold">{id}</h2>
            <p className="text-xs text-muted">{legs ? `${legs.length} leg${legs.length === 1 ? "" : "s"} heard in the last 3 days` : " "}</p>
          </div>
          <button onClick={onClose} className="ml-auto rounded-md p-1.5 text-muted hover:bg-surface hover:text-fg" aria-label="Close">
            <CloseIcon className="h-5 w-5" />
          </button>
        </header>

        <div className="flex flex-col gap-3 p-5">
          {error && <p className="text-sm text-danger">Could not load history ({error}).</p>}
          {!legs && !error && <p className="text-sm text-muted">Loading…</p>}
          {legs?.length === 0 && <p className="text-sm text-muted">Nothing heard for {id} in the last 3 days.</p>}
          {legs?.map((l) => (
            <article key={l.key} className="rounded-lg border border-line bg-surface p-3">
              <div className="mb-2 flex items-center gap-2 text-xs text-muted">
                <span>{day(l.offAt ?? l.outAt ?? l.firstSeen)}</span>
                <span className="ml-auto rounded border border-line px-1.5 py-0.5 text-[11px]">{STATUS[l.status]}</span>
              </div>
              <div className="flex items-center gap-2 font-mono text-lg">
                <Place icao={l.origin} city={l.originCity} />
                <span className="text-muted">→</span>
                <Place icao={l.destination} city={l.destinationCity} />
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 text-sm">
                {isTail ? (
                  l.flight && (
                    <button className="font-mono text-accent hover:underline" onClick={() => onOpen({ flight: l.flight! })}>
                      {l.flight}
                    </button>
                  )
                ) : (
                  <button className="font-mono text-accent hover:underline" onClick={() => onOpen({ tail: l.tail })}>
                    {l.tail}
                  </button>
                )}
                {l.arrivalRunway && <span className="text-muted">arr rwy {l.arrivalRunway}</span>}
              </div>
              <dl className="mt-3 grid grid-cols-5 gap-1 text-center font-mono text-xs">
                {(
                  [
                    ["OUT", l.outAt],
                    ["OFF", l.offAt],
                    ["ETA", l.onAt || l.inAt ? null : l.eta],
                    ["ON", l.onAt],
                    ["IN", l.inAt],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="rounded bg-surface-2 py-1">
                    <dt className="text-[10px] text-muted">{k}</dt>
                    <dd className={v ? "" : "text-muted"}>{utc(v)}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-xs text-muted">
                {l.lastLat !== null && l.lastLon !== null && (
                  <>
                    Last position {Math.abs(l.lastLat).toFixed(2)}
                    {l.lastLat >= 0 ? "N" : "S"} {Math.abs(l.lastLon).toFixed(2)}
                    {l.lastLon >= 0 ? "E" : "W"}
                    {l.lastAltFt ? ` · ${l.lastAltFt >= 18000 ? `FL${Math.round(l.lastAltFt / 100)}` : `${l.lastAltFt.toLocaleString("en-US")} ft`}` : ""}
                    {" · "}
                  </>
                )}
                last heard {fmtAge(Math.max(0, Math.round((now - new Date(l.lastSeen).getTime()) / 60_000)))} ago
              </p>
            </article>
          ))}
          <p className="text-xs text-muted">Times in UTC. Built from ACARS messages heard by Airframes feeders; gaps are normal.</p>
        </div>
      </div>
    </div>
  );
}

function Place({ icao, city }: { icao: string | null; city: string | null }) {
  if (!icao) return <span className="text-muted">????</span>;
  return (
    <Link href={`/a/${icao}`} className="hover:text-accent" title={city ?? undefined}>
      {icao}
    </Link>
  );
}
