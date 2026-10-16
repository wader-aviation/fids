"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { FlightCounts } from "@/lib/data";
import type { AirportAtis, AtisRecord } from "@/lib/data/types";
import { parseWind } from "@/lib/decoder/body";
import { fmtAge, fmtWind, fmtZ, minutesSince } from "@/lib/format";
import type { NotamResult } from "@/lib/notams/faa";
import type { Weather } from "@/lib/weather";
import { AtisCard } from "./atis-card";
import { CategoryPill, LetterBadge } from "./bits";
import { FlightsTable, type BoardLeg } from "./flights-table";
import { NotamList, relevantNotams } from "./notam-list";

type Data = AirportAtis & { history: AtisRecord[]; departures: BoardLeg[]; arrivals: BoardLeg[]; counts: FlightCounts };
type Tab = "dep" | "arr" | "conditions";

const POLL_MS = 60_000;

export function AirportBoard({ icao }: { icao: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [data, setData] = useState<Data | null>(null);
  const [wx, setWx] = useState<Weather | null>(null);
  const [notams, setNotams] = useState<NotamResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const tab = (params.get("tab") as Tab | null) ?? "dep";
  const setTab = (t: Tab) => router.replace(`${pathname}?tab=${t}`, { scroll: false });

  const load = useCallback(async () => {
    // Weather and NOTAMs are slower; they fill in on their own.
    fetch(`/api/v1/wx/${icao}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((r) => r && setWx(r.data))
      .catch(() => {});
    fetch(`/api/v1/notams/${icao}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((r) => r && setNotams(r.data))
      .catch(() => setNotams({ status: "error", message: "request failed" }));
    try {
      const res = await fetch(`/api/v1/airport/${icao}?hours=24`, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 404 ? "Unknown airport" : `HTTP ${res.status}`);
      setData((await res.json()).data);
      setError(null);
      setNow(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    }
  }, [icao]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(load, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  const addToBoard = () => {
    try {
      const cur: string[] = JSON.parse(localStorage.getItem("datis.board") ?? "[]");
      if (!cur.includes(icao)) localStorage.setItem("datis.board", JSON.stringify([...cur, icao]));
    } catch {}
  };

  if (error) return <p className="py-16 text-center text-danger">{error}</p>;
  if (!data) return <p className="py-16 text-center text-muted">Loading {icao}…</p>;

  const same = data.arr && data.dep && data.arr.key === data.dep.key;
  const byType = (type: "ARR" | "DEP") => data.history.filter((r) => (type === "ARR" ? r.type !== "DEP" : r.type !== "ARR"));

  const tabs: Array<[Tab, string]> = [
    ["dep", `Departures (${data.departures.length})`],
    ["arr", `Arrivals (${data.arrivals.length})`],
    ["conditions", "Conditions"],
  ];

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div>
          <h1 className="font-mono text-3xl font-semibold">
            {icao}
            {data.airport?.iata && <span className="ml-2 text-xl font-normal text-muted">{data.airport.iata}</span>}
          </h1>
          <p className="text-muted">{data.airport ? `${data.airport.name} · ${data.airport.city}, ${data.airport.country}` : "Airport not in our list"}</p>
        </div>
        <Link href="/" onClick={addToBoard} className="ml-auto rounded-md border border-line px-3 py-1.5 text-sm hover:border-accent">
          Add to my board
        </Link>
      </header>

      <ConditionsStrip data={data} wx={wx} notams={notams} now={now} onOpen={() => setTab("conditions")} />

      <nav className="flex gap-1 border-b border-line" role="tablist">
        {tabs.map(([t, label]) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "dep" && <FlightsTable legs={data.departures} dir="dep" now={now} />}
      {tab === "arr" && <FlightsTable legs={data.arrivals} dir="arr" now={now} />}
      {tab !== "conditions" && (
        <p className="text-xs text-muted">Flights heard over ACARS in the last 3 hours. Not a full schedule: only aircraft whose datalink messages reach Airframes feeders.</p>
      )}

      {tab === "conditions" && (
        <div className="flex flex-col gap-5">
          {!data.arr && !data.dep && (
            <div className="rounded-lg border border-line bg-surface p-6 text-muted">
              No D-ATIS heard for {icao} in the last 3 hours. D-ATIS only reaches us when an aircraft asks for it, and only some airports publish it.
            </div>
          )}
          <div className={`grid gap-4 ${same || !data.arr || !data.dep ? "" : "lg:grid-cols-2"}`}>
            {same ? (
              <AtisCard title="Arrival & departure" history={byType("ARR")} current={data.arr!} now={now} />
            ) : (
              <>
                {data.arr && <AtisCard title="Arrival" history={byType("ARR")} current={data.arr} now={now} />}
                {data.dep && <AtisCard title="Departure" history={byType("DEP")} current={data.dep} now={now} />}
              </>
            )}
          </div>
          <WeatherPanel wx={wx} now={now} />
          <section className="rounded-lg border border-line bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">NOTAMs (FAA)</h2>
            <NotamList result={notams} now={now} />
          </section>
        </div>
      )}
    </div>
  );
}

function ConditionsStrip({
  data,
  wx,
  notams,
  now,
  onOpen,
}: {
  data: Data;
  wx: Weather | null;
  notams: NotamResult | null;
  now: number;
  onOpen: () => void;
}) {
  const atis = (rec: AtisRecord | null, label: string) => {
    if (!rec) return null;
    const d = rec.decoded;
    const rwys = label === "DEP" ? d.departureRunways : label === "ARR" ? d.arrivalRunways : [...new Set([...d.arrivalRunways, ...d.departureRunways])];
    const age = minutesSince(rec.issuedAt, now);
    return (
      <div className="flex items-center gap-2">
        <LetterBadge letter={rec.letter} stale={age > 120 || minutesSince(rec.lastSeen, now) > 60} />
        <div className="text-sm leading-tight">
          <div className="text-[11px] uppercase text-muted">{label} ATIS</div>
          <div className="font-mono">{rwys.join(" ") || "rwy ?"}</div>
          <div className="text-xs text-muted">{fmtAge(age)} ago</div>
        </div>
      </div>
    );
  };
  const same = data.arr && data.dep && data.arr.key === data.dep.key;
  const metarWind = wx?.metar ? parseWind(wx.metar.raw) : undefined;
  const tafNext = wx?.taf ? /\b(?:FM\d{6}|TEMPO|BECMG|PROB\d0)\b[^]*?(?=\s(?:FM\d{6}|TEMPO|BECMG|PROB\d0)\b|$)/.exec(wx.taf.raw)?.[0] : undefined;
  const relevant = notams?.status === "ok" ? relevantNotams(notams.notams, new Date(now)).active : [];
  const warnNotams = relevant.filter((n) => n.severity === "warn");
  const c = data.counts;

  return (
    <section className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-line bg-surface p-3 lg:grid-cols-[auto_auto_1fr_1fr_auto]">
      <div className="col-span-2 flex gap-4 lg:col-span-1">
        {same ? atis(data.arr, "ARR/DEP") : (
          <>
            {atis(data.arr, "ARR")}
            {atis(data.dep, "DEP")}
          </>
        )}
        {!data.arr && !data.dep && <span className="text-sm text-muted">No D-ATIS heard</span>}
      </div>

      <div className="text-sm leading-tight">
        <div className="text-[11px] uppercase text-muted">METAR {wx?.metar && fmtZ(wx.metar.observedAt)}</div>
        {wx?.metar ? (
          <>
            <div className="font-mono">{fmtWind(metarWind)}</div>
            {wx.metar.category && <CategoryPill cat={wx.metar.category as "VFR"} />}
          </>
        ) : (
          <div className="text-muted">{wx ? "none" : "…"}</div>
        )}
      </div>

      <div className="col-span-2 min-w-0 text-sm leading-tight sm:col-span-1">
        <div className="text-[11px] uppercase text-muted">TAF next</div>
        <div className="truncate font-mono text-xs" title={tafNext}>
          {wx?.taf ? (tafNext ?? "no change groups") : wx ? "none" : "…"}
        </div>
      </div>

      <button onClick={onOpen} className="min-w-0 text-left text-sm leading-tight">
        <div className="text-[11px] uppercase text-muted">NOTAMs</div>
        {notams?.status === "ok" ? (
          <div className="flex flex-wrap gap-1">
            <span className="text-xs text-muted">{relevant.length} active</span>
            {[...new Set(warnNotams.map((n) => n.summary))].slice(0, 3).map((s) => (
              <span key={s} className="rounded border border-warn/60 px-1.5 py-0.5 text-[11px] text-warn">
                {s}
              </span>
            ))}
          </div>
        ) : (
          <div className="text-xs text-muted">{notams === null ? "…" : notams.status === "not-configured" ? "not set up" : "unavailable"}</div>
        )}
      </button>

      <div className="text-sm leading-tight">
        <div className="text-[11px] uppercase text-muted">Last hour</div>
        <div className="font-mono">
          ↑{c.departedLastHour} ↓{c.arrivedLastHour}
        </div>
        <div className="text-xs text-muted">
          {c.inbound} inbound{c.nextEta && ` · next ${fmtZ(c.nextEta)}`}
        </div>
      </div>
    </section>
  );
}

function WeatherPanel({ wx, now }: { wx: Weather | null; now: number }) {
  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Weather (aviationweather.gov)</h2>
      {wx?.metar ? (
        <div className="mb-3">
          <div className="mb-1 flex items-center gap-2 text-xs text-muted">
            METAR · {fmtZ(wx.metar.observedAt)} · {fmtAge(minutesSince(wx.metar.observedAt, now))} ago
            {wx.metar.category && <CategoryPill cat={wx.metar.category as "VFR"} />}
          </div>
          <pre className="whitespace-pre-wrap font-mono text-sm">{wx.metar.raw}</pre>
        </div>
      ) : (
        <p className="mb-3 text-sm text-muted">{wx ? "No METAR." : "Loading…"}</p>
      )}
      {wx?.taf ? (
        <div>
          <div className="mb-1 text-xs text-muted">TAF · issued {fmtZ(wx.taf.issuedAt)}</div>
          <pre className="whitespace-pre-wrap font-mono text-sm">{wx.taf.raw.replace(/ (FM\d{6}|TEMPO|BECMG|PROB\d0)/g, "\n  $1")}</pre>
        </div>
      ) : (
        <p className="text-sm text-muted">{wx ? "No TAF." : ""}</p>
      )}
    </section>
  );
}
