"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { FlightCounts } from "@/lib/data";
import type { AirportAtis as AtisRow, AtisRecord } from "@/lib/data/types";

type AirportAtis = AtisRow & { flights?: FlightCounts };
import { fmtAge, fmtCeil, fmtQnh, fmtVis, fmtWind, fmtZ, minutesSince, worstWind } from "@/lib/format";
import { CategoryPill, FlagChips, LetterBadge } from "./bits";

const POLL_MS = 30_000;
const STALE_MIN = 60; // not heard for this long
const OLD_ISSUE_MIN = 120; // issued this long ago
const CHANGED_MS = 5 * 60_000;

interface SavedBoard {
  name: string;
  codes: string[];
}

const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key);
      return v ? (JSON.parse(v) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};

/** localStorage value shared across components; empty on the server. */
function useStored<T>(key: string, fallback: T): [T, (v: T) => void] {
  const raw = useSyncExternalStore(
    (cb) => {
      window.addEventListener("storage", cb);
      window.addEventListener(`local:${key}`, cb);
      return () => {
        window.removeEventListener("storage", cb);
        window.removeEventListener(`local:${key}`, cb);
      };
    },
    () => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    () => null,
  );
  const value = useMemo(() => {
    try {
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw]);
  const set = useCallback(
    (v: T) => {
      storage.set(key, v);
      window.dispatchEvent(new Event(`local:${key}`));
    },
    [key],
  );
  return [value, set];
}

function useNow(interval = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(t);
  }, [interval]);
  return now;
}

export function Board() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const codes = useMemo(() => (params.get("a") ?? "").split(",").filter(Boolean), [params]);
  const xwLimit = Number(params.get("xw") ?? 25);
  const twLimit = Number(params.get("tw") ?? 10);
  const tv = params.get("tv") === "1";

  const [rows, setRows] = useState<AirportAtis[] | null>(null);
  const [sourceKind, setSourceKind] = useState<string>("");
  const [updatedAt, setUpdatedAt] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [changedAt, setChangedAt] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState("");
  const [saved, setSaved] = useStored<SavedBoard[]>("datis.boards", []);
  const lastLetters = useRef<Record<string, string>>({});
  const now = useNow();

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
    },
    [params, pathname, router],
  );

  // Restore the last board when opening "/" with no airports.
  useEffect(() => {
    if (!params.get("a")) {
      const last = storage.get<string[]>("datis.board", []);
      if (last.length) setParams({ a: last.join(",") });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    storage.set("datis.board", codes);
  }, [codes]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/atis${codes.length ? `?icao=${codes.join(",")}` : ""}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { source: string; data: AirportAtis[] };
      const t = Date.now();
      const changes: Record<string, number> = {};
      for (const r of body.data) {
        const sig = `${r.arr?.key ?? ""}~${r.dep?.key ?? ""}`;
        const prev = lastLetters.current[r.icao];
        if (prev !== undefined && prev !== sig) changes[r.icao] = t;
        lastLetters.current[r.icao] = sig;
      }
      if (Object.keys(changes).length) setChangedAt((c) => ({ ...c, ...changes }));
      setRows(body.data);
      setSourceKind(body.source);
      setUpdatedAt(t);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    }
  }, [codes]);

  useEffect(() => {
    lastLetters.current = {};
    const first = setTimeout(load, 0);
    const t = setInterval(load, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  const visible = useMemo(() => {
    if (!rows) return [];
    const q = filter.trim().toUpperCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.icao, r.airport?.iata, r.airport?.name, r.airport?.city, r.airport?.country].some((v) => v?.toUpperCase().includes(q)),
    );
  }, [rows, filter]);

  const removeCode = (icao: string) => setParams({ a: codes.filter((c) => c !== icao).join(",") });

  const saveBoard = () => {
    const name = prompt("Name this board", saved.length ? "" : "My airports")?.trim();
    if (!name || !codes.length) return;
    const next = [...saved.filter((b) => b.name !== name), { name, codes }];
    setSaved(next);
  };
  const deleteBoard = (name: string) => {
    setSaved(saved.filter((b) => b.name !== name));
  };

  return (
    <div className={tv ? "tv" : ""}>
      {!tv && (
        <div className="flex flex-col gap-3 pb-4">
          <AddAirports
            onAdd={(icaos) => setParams({ a: [...codes, ...icaos.filter((i) => !codes.includes(i))].join(",") })}
            onReplace={(icaos) => setParams({ a: icaos.join(",") })}
          />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {saved.map((b) => (
              <span key={b.name} className="inline-flex items-center rounded-full border border-line bg-surface">
                <button className="px-3 py-1 hover:text-accent" onClick={() => setParams({ a: b.codes.join(",") })}>
                  {b.name} <span className="text-muted">({b.codes.length})</span>
                </button>
                <button className="pr-2 text-muted hover:text-danger" aria-label={`Delete ${b.name}`} onClick={() => deleteBoard(b.name)}>
                  ×
                </button>
              </span>
            ))}
            {codes.length > 0 && (
              <>
                <button className="rounded-full border border-dashed border-line px-3 py-1 text-muted hover:text-fg" onClick={saveBoard}>
                  Save board
                </button>
                <button className="rounded-full px-3 py-1 text-muted hover:text-fg" onClick={() => setParams({ a: null })}>
                  Show all airports
                </button>
              </>
            )}
            <span className="ml-auto flex items-center gap-3 text-muted">
              <label className="flex items-center gap-1">
                XW limit
                <input
                  type="number"
                  min={5}
                  max={50}
                  value={xwLimit}
                  onChange={(e) => setParams({ xw: e.target.value })}
                  className="w-14 rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-fg"
                />
              </label>
              <label className="flex items-center gap-1">
                TW
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={twLimit}
                  onChange={(e) => setParams({ tw: e.target.value })}
                  className="w-12 rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-fg"
                />
              </label>
              <button className="hover:text-fg" onClick={() => setParams({ tv: "1" })}>
                Wall mode
              </button>
            </span>
          </div>
        </div>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-muted">
        <span>
          {codes.length ? `${codes.length} airports` : `All airports heard in the last 3h`}
          {rows && ` · ${rows.filter((r) => r.arr || r.dep).length} with D-ATIS`}
        </span>
        {!codes.length && rows && (
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by code, name, country (e.g. US, LIS)"
            className="w-64 rounded border border-line bg-surface px-2 py-1 text-fg"
          />
        )}
        <span className="ml-auto">
          {error ? <span className="text-danger">Update failed ({error}) — retrying</span> : updatedAt ? `Updated ${fmtZ(new Date(updatedAt).toISOString())}` : "Loading…"}
          {sourceKind === "live" && " · live feed (no database)"}
        </span>
        {tv && (
          <button className="underline" onClick={() => setParams({ tv: null })}>
            Exit wall mode
          </button>
        )}
      </div>

      {rows === null ? (
        <p className="py-16 text-center text-muted">Loading D-ATIS…</p>
      ) : visible.length === 0 ? (
        <p className="py-16 text-center text-muted">No airports match.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <div className="hidden grid-cols-[minmax(10rem,1.3fr)_minmax(9rem,1fr)_minmax(9rem,1fr)_minmax(8rem,0.9fr)_minmax(7rem,0.8fr)_4.5rem_5.5rem_minmax(8rem,1.2fr)] gap-3 border-b border-line px-3 py-2 text-[11px] uppercase tracking-wide text-muted lg:grid">
            <span>Airport</span>
            <span>Arrival</span>
            <span>Departure</span>
            <span>Wind · XW/TW</span>
            <span>Vis · Ceiling</span>
            <span>QNH</span>
            <span>Traffic 1h</span>
            <span>Ops flags</span>
          </div>
          {visible.map((r) => (
            <Row
              key={r.icao}
              row={r}
              now={now}
              changed={!!changedAt[r.icao] && now - changedAt[r.icao] < CHANGED_MS}
              xwLimit={xwLimit}
              twLimit={twLimit}
              onRemove={codes.length && !tv ? () => removeCode(r.icao) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Row({
  row,
  now,
  changed,
  xwLimit,
  twLimit,
  onRemove,
}: {
  row: AirportAtis;
  now: number;
  changed: boolean;
  xwLimit: number;
  twLimit: number;
  onRemove?: () => void;
}) {
  // Weather comes from whichever ATIS was issued last.
  const main = [row.arr, row.dep].filter(Boolean).sort((a, b) => b!.issuedAt.localeCompare(a!.issuedAt))[0] ?? null;
  const d = main?.decoded;
  const ww = d ? worstWind(d) : null;
  const flags = d ? mergeFlags(row.arr, row.dep) : [];
  const same = row.arr && row.dep && row.arr.key === row.dep.key;

  return (
    <div
      className={`group relative grid grid-cols-2 gap-x-3 gap-y-2 border-b border-line px-3 py-2.5 last:border-b-0 lg:grid-cols-[minmax(10rem,1.3fr)_minmax(9rem,1fr)_minmax(9rem,1fr)_minmax(8rem,0.9fr)_minmax(7rem,0.8fr)_4.5rem_5.5rem_minmax(8rem,1.2fr)] lg:items-center ${
        changed ? "row-changed" : ""
      }`}
    >
      <div className="col-span-2 flex items-start gap-2 lg:col-span-1">
        <Link href={`/a/${row.icao}`} className="min-w-0 hover:text-accent">
          <div className="font-mono text-lg font-semibold leading-tight">
            {row.icao}
            {row.airport?.iata && <span className="ml-1.5 text-sm font-normal text-muted">{row.airport.iata}</span>}
          </div>
          <div className="truncate text-xs text-muted">{row.airport ? `${row.airport.city || row.airport.name}, ${row.airport.country}` : "Unknown airport"}</div>
        </Link>
        {onRemove && (
          <button
            onClick={onRemove}
            className="ml-auto text-muted opacity-0 transition group-hover:opacity-100 hover:text-danger focus:opacity-100"
            aria-label={`Remove ${row.icao}`}
          >
            ×
          </button>
        )}
      </div>

      {same ? (
        <div className="col-span-2">
          <AtisCell rec={row.arr} now={now} label="ARR/DEP" />
        </div>
      ) : (
        <>
          <AtisCell rec={row.arr} now={now} label="ARR" />
          <AtisCell rec={row.dep} now={now} label="DEP" />
        </>
      )}

      <div className="font-mono text-sm">
        <div>{fmtWind(d?.wind)}</div>
        {ww && (
          <div className="text-xs">
            <span className={ww.crosswindKt > xwLimit ? "font-semibold text-danger" : "text-muted"}>
              XW {ww.crosswindKt}
              <span className="text-muted">/{ww.crosswindRunway}</span>
            </span>
            {ww.tailwindKt > 0 && (
              <span className={`ml-2 ${ww.tailwindKt > twLimit ? "font-semibold text-danger" : "text-muted"}`}>
                TW {ww.tailwindKt}
                <span className="text-muted">/{ww.tailwindRunway}</span>
              </span>
            )}
          </div>
        )}
      </div>

      <div className="font-mono text-sm">
        {d ? (
          <>
            <div>
              {fmtVis(d)} · {fmtCeil(d)}
            </div>
            <CategoryPill cat={d.flightCategory} />
          </>
        ) : (
          <span className="text-muted">—</span>
        )}
      </div>

      <div className="font-mono text-sm">{d ? fmtQnh(d) : "—"}</div>

      <Link href={`/a/${row.icao}?tab=arr`} className="font-mono text-sm hover:text-accent" title="Departed / arrived in the last hour, inbound now (heard over ACARS)">
        {row.flights && (row.flights.departedLastHour || row.flights.arrivedLastHour || row.flights.inbound) ? (
          <>
            <div>
              ↑{row.flights.departedLastHour} ↓{row.flights.arrivedLastHour}
            </div>
            <div className="text-xs text-muted">{row.flights.inbound} inbound</div>
          </>
        ) : (
          <span className="text-muted">—</span>
        )}
      </Link>

      <div className="col-span-2 lg:col-span-1">
        <FlagChips flags={flags} limit={4} />
      </div>
    </div>
  );
}

function AtisCell({ rec, now, label }: { rec: AtisRecord | null; now: number; label: string }) {
  if (!rec) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <LetterBadge />
        <span>
          <span className="text-[11px] uppercase lg:hidden">{label} · </span>no D-ATIS heard
        </span>
      </div>
    );
  }
  const age = minutesSince(rec.issuedAt, now);
  const heard = minutesSince(rec.lastSeen, now);
  const stale = heard > STALE_MIN || age > OLD_ISSUE_MIN;
  const d = rec.decoded;
  const rwys = label === "DEP" ? d.departureRunways : label === "ARR" ? d.arrivalRunways : [...new Set([...d.arrivalRunways, ...d.departureRunways])];
  const appr = d.approaches[0]?.type;
  return (
    <Link href={`/a/${rec.icao}`} className="flex min-w-0 items-center gap-2">
      <LetterBadge letter={rec.letter} stale={stale} />
      <span className="min-w-0 text-sm">
        <span className="block font-mono">
          <span className="text-[11px] text-muted uppercase lg:hidden">{label} </span>
          {rwys.length ? rwys.join(" ") : <span className="text-muted">rwy ?</span>}
          {appr && <span className="ml-1.5 text-xs text-muted">{appr}</span>}
        </span>
        <span className={`block text-xs ${stale ? "text-warn" : "text-muted"}`}>
          {d.issued ? `${d.issued}Z` : fmtZ(rec.issuedAt)} · {fmtAge(age)} ago
          {stale && ` · last heard ${fmtAge(heard)} ago`}
          {rec.diff && rec.diff.changes.some((c) => c.field.endsWith("Runways")) && <span className="ml-1 text-accent">· rwy change</span>}
        </span>
      </span>
    </Link>
  );
}

function mergeFlags(a: AtisRecord | null, b: AtisRecord | null) {
  const map = new Map<string, AtisRecord["decoded"]["flags"][number]>();
  for (const r of [a, b]) r?.decoded.flags.forEach((f) => map.set(f.id, f));
  return [...map.values()];
}

function AddAirports({ onAdd, onReplace }: { onAdd: (icaos: string[]) => void; onReplace: (icaos: string[]) => void }) {
  const [value, setValue] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Array<{ icao: string; iata: string; name: string; city: string; country: string }>>([]);

  const query = value.trim();
  const searchable = query.length >= 3 && !/[\s,\-]/.test(query);
  useEffect(() => {
    if (!searchable) return;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/v1/airports?q=${encodeURIComponent(query)}`);
      if (res.ok) setSuggestions((await res.json()).data);
    }, 200);
    return () => clearTimeout(t);
  }, [query, searchable]);

  const submit = async (replace: boolean) => {
    if (!value.trim()) return;
    const res = await fetch(`/api/v1/airports?resolve=${encodeURIComponent(value)}`);
    const { icaos, unknown } = (await res.json()) as { icaos: string[]; unknown: string[] };
    if (icaos.length) (replace ? onReplace : onAdd)(icaos);
    setNote(unknown.length ? `Not found: ${unknown.join(", ")}` : null);
    setValue("");
    setSuggestions([]);
  };

  return (
    <div className="relative">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          submit(false);
        }}
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Add airports or a route: LPPT-KJFK ALT KBOS, or LIS JFK BOS"
          aria-label="Add airports or a route"
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm uppercase placeholder:normal-case placeholder:text-muted focus:border-accent focus:outline-none"
        />
        <div className="flex gap-2">
          <button type="submit" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-bg">
            Add
          </button>
          <button type="button" onClick={() => submit(true)} className="rounded-md border border-line px-4 py-2 text-sm">
            New board
          </button>
        </div>
      </form>
      {note && <p className="mt-1 text-xs text-warn">{note}</p>}
      {searchable && suggestions.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full max-w-xl overflow-hidden rounded-md border border-line bg-surface-2 shadow-lg">
          {suggestions.map((s) => (
            <li key={s.icao}>
              <button
                className="flex w-full gap-3 px-3 py-2 text-left text-sm hover:bg-surface"
                onClick={() => {
                  onAdd([s.icao]);
                  setValue("");
                  setSuggestions([]);
                }}
              >
                <span className="font-mono">{s.icao}</span>
                <span className="font-mono text-muted">{s.iata}</span>
                <span className="truncate">
                  {s.name} <span className="text-muted">· {s.city}, {s.country}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
