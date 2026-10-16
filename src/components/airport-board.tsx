"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { FlightCounts } from "@/lib/data";
import type { AirportAtis, AtisRecord } from "@/lib/data/types";
import { parseWind } from "@/lib/decoder/body";
import { fmtAge, fmtWind, fmtZ, minutesSince } from "@/lib/format";
import type { FlightLeg, LegStatus } from "@/lib/movements/types";
import type { NotamResult } from "@/lib/notams/faa";
import type { Weather } from "@/lib/weather";
import { AtisCard } from "./atis-card";
import { CategoryPill, LetterBadge } from "./bits";
import { FlapBoard, type FlapRow, type FlapTone } from "./flap";
import { BackIcon, ChevronIcon } from "./icons";
import { NotamList, relevantNotams } from "./notam-list";

type BoardLeg = FlightLeg & { status: LegStatus; originCity: string | null; destinationCity: string | null };

type Data = AirportAtis & {
  history: AtisRecord[];
  departures: BoardLeg[];
  arrivals: BoardLeg[];
  counts: FlightCounts;
  timezone: string | null;
};

const POLL_MS = 60_000;
const BOARD_ROWS = 12;

export function AirportBoard({ icao }: { icao: string }) {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [wx, setWx] = useState<Weather | null>(null);
  const [notams, setNotams] = useState<NotamResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);

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

  const back = () => (window.history.length > 1 ? router.back() : router.push("/"));

  const header = (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <button onClick={back} className="flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-sm text-muted hover:border-accent hover:text-fg">
        <BackIcon /> Back
      </button>
      <div className="min-w-0">
        <h1 className="font-mono text-3xl font-semibold leading-tight">
          {icao}
          {data?.airport?.iata && <span className="ml-2 text-xl font-normal text-muted">{data.airport.iata}</span>}
        </h1>
        <p className="truncate text-muted">{data?.airport ? `${data.airport.name} · ${data.airport.city}, ${data.airport.country}` : " "}</p>
      </div>
      {data?.timezone && <LocalClock timezone={data.timezone} />}
    </header>
  );

  if (error) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <p className="py-16 text-center text-danger">{error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <p className="py-16 text-center text-muted">Loading {icao}…</p>
      </div>
    );
  }

  const tz = data.timezone ?? "UTC";
  const same = data.arr && data.dep && data.arr.key === data.dep.key;
  const byType = (type: "ARR" | "DEP") => (data.split ? data.history.filter((r) => (type === "ARR" ? r.type !== "DEP" : r.type !== "ARR")) : data.history);

  return (
    <div className="flex flex-col gap-5">
      {header}

      <section className="rounded-lg border border-line bg-surface">
        <ConditionsStrip data={data} wx={wx} notams={notams} now={now} />
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex w-full items-center justify-center gap-1 border-t border-line py-1.5 text-xs text-muted hover:text-fg"
        >
          {open ? "Hide details" : "ATIS, weather and NOTAM details"} <ChevronIcon open={open} />
        </button>
        {open && (
          <div className="flex flex-col gap-5 border-t border-line p-4">
            {!data.arr && !data.dep && (
              <p className="text-sm text-muted">
                No D-ATIS heard for {icao} in the last 3 hours. D-ATIS only reaches us when an aircraft asks for it, and only some airports publish it.
              </p>
            )}
            <div className={`grid gap-4 ${same || !data.arr || !data.dep ? "" : "lg:grid-cols-2"}`}>
              {same || !data.split ? (
                data.arr && <AtisCard title="Current" history={byType("ARR")} current={data.arr} now={now} />
              ) : (
                <>
                  {data.arr && <AtisCard title="Arrival" history={byType("ARR")} current={data.arr} now={now} />}
                  {data.dep && <AtisCard title="Departure" history={byType("DEP")} current={data.dep} now={now} />}
                </>
              )}
            </div>
            <WeatherPanel wx={wx} now={now} />
            <div>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">NOTAMs</h2>
              <NotamList result={notams} now={now} />
            </div>
          </div>
        )}
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <FlapBoard
          title="Departures"
          direction="dep"
          columns={[
            { label: "TIME", width: 5 },
            { label: "DESTINATION", width: 12 },
            { label: "FLIGHT", width: 7 },
            { label: "REMARKS", width: 9 },
          ]}
          rows={departureRows(data.departures, tz)}
          minRows={BOARD_ROWS}
        />
        <FlapBoard
          title="Arrivals"
          direction="arr"
          columns={[
            { label: "TIME", width: 5 },
            { label: "ORIGIN", width: 12 },
            { label: "FLIGHT", width: 7 },
            { label: "REMARKS", width: 9 },
          ]}
          rows={arrivalRows(data.arrivals, tz)}
          minRows={BOARD_ROWS}
        />
      </div>
      <p className="text-center text-xs text-muted">
        Local times. Flights heard over ACARS in the last 3 hours: only aircraft whose datalink messages reach Airframes feeders, so this is not a full schedule.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- flap rows

const localHm = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

/** City names without accents (the flap drum has none). */
const place = (city: string | null, icao: string | null) => (city ? city.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : (icao ?? "?"));

function departureRows(legs: BoardLeg[], tz: string): FlapRow[] {
  const remark = (l: BoardLeg): [string, FlapTone] => {
    if (l.status === "taxi-out") return ["TAXIING", "yellow"];
    if (l.status === "landed" || l.status === "at-gate") return ["ARRIVED", "dim"];
    if (l.offAt || l.status === "airborne" || l.status === "en-route") return ["DEPARTED", "green"];
    // Route heard (e.g. flight plan or init report) but no push-back yet.
    return ["PLANNED", "white"];
  };
  return legs
    .map((l) => ({ l, t: l.offAt ?? l.outAt ?? l.firstSeen }))
    .sort((a, b) => a.t.localeCompare(b.t))
    .slice(-BOARD_ROWS)
    .map(({ l, t }) => {
      const [text, tone] = remark(l);
      return {
        key: l.key,
        cells: [
          { text: localHm(t, tz), tone: "yellow" },
          { text: place(l.destinationCity, l.destination), tone: "yellow" },
          { text: l.flight ?? l.tail, tone: "yellow" },
          { text, tone },
        ],
      };
    });
}

function arrivalRows(legs: BoardLeg[], tz: string): FlapRow[] {
  const inbound = legs.filter((l) => !l.onAt && !l.inAt);
  const landed = legs.filter((l) => l.onAt || l.inAt);
  // Upcoming first matter most; fill the rest with the latest landings.
  const keepLanded = landed
    .sort((a, b) => (b.onAt ?? b.inAt)!.localeCompare((a.onAt ?? a.inAt)!))
    .slice(0, Math.max(0, BOARD_ROWS - inbound.length));
  const rows = [...keepLanded, ...inbound.slice(0, BOARD_ROWS)].map((l) => ({ l, t: l.onAt ?? l.inAt ?? l.eta }));
  return rows
    .sort((a, b) => (a.t ?? "9").localeCompare(b.t ?? "9"))
    .map(({ l, t }) => {
      const [text, tone]: [string, FlapTone] = l.inAt ? ["AT GATE", "dim"] : l.onAt ? ["LANDED", "green"] : l.eta ? ["EXPECTED", "white"] : ["EN ROUTE", "white"];
      return {
        key: l.key,
        cells: [
          { text: t ? localHm(t, tz) : "--:--", tone: "yellow" },
          { text: place(l.originCity, l.origin), tone: "yellow" },
          { text: l.flight ?? l.tail, tone: "yellow" },
          { text, tone },
        ],
      };
    });
}

// ---------------------------------------------------------------- header clock

/** "UTC+3", "UTC-3", "UTC+5:30" for a time zone right now. */
function utcOffset(tz: string, at: Date) {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  return part.replace("GMT", "UTC").replace(/^UTC$/, "UTC+0");
}

function LocalClock({ timezone }: { timezone: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
  if (!now) return <div className="ml-auto h-14" />;
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(now);
  return (
    <div className="ml-auto text-right" title={timezone.replace(/_/g, " ")}>
      <div className="font-mono text-3xl font-semibold tabular-nums leading-tight" style={{ color: "var(--warn)" }}>
        {time}
      </div>
      <div className="text-xs text-muted">Local time · {utcOffset(timezone, now)}</div>
    </div>
  );
}

// ---------------------------------------------------------------- conditions

function ConditionsStrip({ data, wx, notams, now }: { data: Data; wx: Weather | null; notams: NotamResult | null; now: number }) {
  const atis = (rec: AtisRecord | null, label: string) => {
    if (!rec) return null;
    const d = rec.decoded;
    const age = minutesSince(rec.issuedAt, now);
    const rwys =
      label.startsWith("DEP") ? d.departureRunways.join(" ") : label.startsWith("ARR") ? d.arrivalRunways.join(" ") : [d.arrivalRunways.length && `↓${d.arrivalRunways.join(" ")}`, d.departureRunways.length && `↑${d.departureRunways.join(" ")}`].filter(Boolean).join(" ");
    return (
      <div className="flex items-center gap-2">
        <LetterBadge letter={rec.letter} stale={age > 120 || minutesSince(rec.lastSeen, now) > 60} />
        <div className="text-sm leading-tight">
          <div className="text-[11px] uppercase text-muted">{label}</div>
          <div className="font-mono">{rwys || "rwy ?"}</div>
          <div className="text-xs text-muted">{fmtAge(age)} ago</div>
        </div>
      </div>
    );
  };
  const metarWind = wx?.metar ? parseWind(wx.metar.raw) : undefined;
  const tafNext = wx?.taf ? /\b(?:FM\d{6}|TEMPO|BECMG|PROB\d0)\b[^]*?(?=\s(?:FM\d{6}|TEMPO|BECMG|PROB\d0)\b|$)/.exec(wx.taf.raw)?.[0] : undefined;
  const relevant = notams?.status === "ok" ? relevantNotams(notams.notams, new Date(now)).active : [];
  const warnNotams = relevant.filter((n) => n.severity === "warn");
  const c = data.counts;

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-3 p-3 lg:grid-cols-[auto_auto_1fr_1fr_auto]">
      <div className="col-span-2 flex gap-4 lg:col-span-1">
        {data.split ? (
          <>
            {atis(data.arr, "ARR ATIS")}
            {atis(data.dep, "DEP ATIS")}
          </>
        ) : (
          atis(data.arr, "ATIS")
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

      <div className="min-w-0 text-sm leading-tight">
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
      </div>

      <div className="text-sm leading-tight">
        <div className="text-[11px] uppercase text-muted">Last hour</div>
        <div className="font-mono">
          <span style={{ color: "var(--dep)" }}>↑</span>
          {c.departedLastHour} <span style={{ color: "var(--arr)" }}>↓</span>
          {c.arrivedLastHour}
        </div>
        <div className="text-xs text-muted">
          {c.inbound} inbound{c.nextEta && ` · next ${fmtZ(c.nextEta)}`}
        </div>
      </div>
    </div>
  );
}

function WeatherPanel({ wx, now }: { wx: Weather | null; now: number }) {
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Weather</h2>
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
    </div>
  );
}
