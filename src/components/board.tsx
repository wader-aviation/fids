"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { FlightCounts } from "@/lib/data";
import type { AirportAtis as AtisRow, AtisRecord } from "@/lib/data/types";
import { fmtAge, fmtCeil, fmtQnh, fmtVis, fmtWind, fmtZ, minutesSince, worstWind } from "@/lib/format";
import { CategoryPill, FlagChips, LetterBadge } from "./bits";
import { WindsockIcon } from "./icons";
import { TrafficSpark } from "./traffic-spark";

type AirportAtis = AtisRow & { flights?: FlightCounts };

const POLL_MS = 30_000;
const STALE_MIN = 60; // not heard for this long
const OLD_ISSUE_MIN = 120; // issued this long ago
const CHANGED_MS = 5 * 60_000;
const COLS =
  "lg:grid-cols-[minmax(10rem,1.2fr)_minmax(12rem,1.4fr)_minmax(8rem,0.9fr)_minmax(7rem,0.8fr)_4.5rem_minmax(8.5rem,0.9fr)_minmax(8rem,1.1fr)]";

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

const sameCodes = (a: string[], b: string[]) => a.length === b.length && a.every((c, i) => c === b[i]);

export function Board() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const codes = useMemo(() => (params.get("a") ?? "").split(",").filter(Boolean), [params]);
  const draft = params.get("new") === "1";
  const xwLimit = Number(params.get("xw") ?? 25);
  const twLimit = Number(params.get("tw") ?? 10);
  const tv = params.get("tv") === "1";

  const [rows, setRows] = useState<AirportAtis[] | null>(null);
  const [sourceKind, setSourceKind] = useState<string>("");
  const [updatedAt, setUpdatedAt] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [changedAt, setChangedAt] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState("");
  const [saved, setSaved] = useStored<SavedBoard[]>("fids.boards", []);
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
    if (!params.get("a") && !params.get("all")) {
      const last = storage.get<string[]>("fids.board", []);
      if (last.length) setParams({ a: last.join(",") });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    storage.set("fids.board", codes);
  }, [codes]);

  const showAll = !codes.length && !draft;

  const load = useCallback(async () => {
    if (!codes.length && draft) {
      setRows([]);
      return;
    }
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
  }, [codes, draft]);

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
    if (!showAll || !q) return rows;
    return rows.filter((r) =>
      [r.icao, r.airport?.iata, r.airport?.name, r.airport?.city, r.airport?.country].some((v) => v?.toUpperCase().includes(q)),
    );
  }, [rows, filter, showAll]);

  // One scale for every sparkline, so rows can be compared.
  const trafficScale = useMemo(
    () => Math.max(1, ...visible.flatMap((r) => [...(r.flights?.depBuckets ?? []), ...(r.flights?.arrBuckets ?? [])])),
    [visible],
  );

  const activeBoard = saved.find((b) => sameCodes(b.codes, codes));
  const addCodes = (icaos: string[]) => setParams({ a: [...codes, ...icaos.filter((i) => !codes.includes(i))].join(","), new: null, all: null });
  const removeCode = (icao: string) => setParams({ a: codes.filter((c) => c !== icao).join(",") || null, new: codes.length === 1 ? "1" : null });

  const saveBoard = () => {
    const name = prompt("Name this board", activeBoard?.name ?? "")?.trim();
    if (!name || !codes.length) return;
    setSaved([...saved.filter((b) => b.name !== name), { name, codes }]);
  };

  return (
    <div className={tv ? "tv" : ""}>
      {!tv && (
        <div className="flex flex-col gap-3 pb-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Chip active={showAll} onClick={() => setParams({ a: null, new: null, all: "1" })}>
              All airports
            </Chip>
            {saved.map((b) => (
              <Chip key={b.name} active={activeBoard?.name === b.name} onClick={() => setParams({ a: b.codes.join(","), new: null, all: null })} onDelete={() => setSaved(saved.filter((x) => x.name !== b.name))}>
                {b.name} <span className="text-muted">{b.codes.length}</span>
              </Chip>
            ))}
            {!showAll && !activeBoard && (
              <Chip active>
                {codes.length ? "Unsaved board" : "New board"}
                {codes.length > 0 && (
                  <button className="ml-2 text-accent hover:underline" onClick={saveBoard}>
                    Save
                  </button>
                )}
              </Chip>
            )}
            <button className="rounded-full border border-dashed border-line px-3 py-1 text-muted hover:text-fg" onClick={() => setParams({ a: null, new: "1", all: null })}>
              + New board
            </button>

            <span className="ml-auto flex items-center gap-4">
              <WindLimits xw={xwLimit} tw={twLimit} onChange={(xw, tw) => setParams({ xw: String(xw), tw: String(tw) })} />
              <Toggle label="Wall mode" on={tv} onChange={(v) => setParams({ tv: v ? "1" : null })} />
            </span>
          </div>

          {showAll ? (
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter airports by code, name or country (e.g. LIS, US, Heathrow)"
              aria-label="Filter airports"
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm placeholder:text-muted focus:border-accent focus:outline-none"
            />
          ) : (
            <AddAirports onAdd={addCodes} autoFocus={draft && !codes.length} />
          )}
        </div>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-muted">
        <span>
          {showAll ? "All airports heard in the last 3h" : `${codes.length} airports`}
          {rows && rows.length > 0 && ` · ${rows.filter((r) => r.arr || r.dep).length} with D-ATIS`}
        </span>
        <span className="ml-auto">
          {error ? <span className="text-danger">Update failed ({error}) — retrying</span> : updatedAt ? `Updated ${fmtZ(new Date(updatedAt).toISOString())}` : "Loading…"}
          {sourceKind === "live" && " · live feed (no database)"}
        </span>
        {tv && <Toggle label="Wall mode" on={tv} onChange={(v) => setParams({ tv: v ? "1" : null })} />}
      </div>

      {rows === null ? (
        <p className="py-16 text-center text-muted">Loading…</p>
      ) : !showAll && !codes.length ? (
        <p className="rounded-lg border border-dashed border-line py-16 text-center text-muted">
          Type airports above, or paste a route like <span className="font-mono text-fg">LPPT-KJFK ALT KBOS</span>.
        </p>
      ) : visible.length === 0 ? (
        <p className="py-16 text-center text-muted">No airports match.</p>
      ) : (
        <div className="rounded-lg border border-line bg-surface">
          <div className={`hidden gap-3 border-b border-line px-3 py-2 text-[11px] uppercase tracking-wide text-muted lg:grid ${COLS}`}>
            <span>Airport</span>
            <span>ATIS</span>
            <span>Wind · XW/TW</span>
            <span>Vis · Ceiling</span>
            <span>QNH</span>
            <span className="flex items-center gap-2">
              Traffic 3h
              <span className="flex items-center gap-1 normal-case tracking-normal">
                <span className="h-2 w-2 rounded-sm" style={{ background: "var(--dep)" }} />
                dep
                <span className="ml-1 h-2 w-2 rounded-sm" style={{ background: "var(--arr)" }} />
                arr
              </span>
            </span>
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
              trafficScale={trafficScale}
              onRemove={codes.length && !tv ? () => removeCode(r.icao) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({ active, onClick, onDelete, children }: { active?: boolean; onClick?: () => void; onDelete?: () => void; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full border ${active ? "border-accent bg-accent/10 text-fg" : "border-line bg-surface text-muted hover:text-fg"}`}>
      {onClick ? (
        <button className="px-3 py-1" onClick={onClick}>
          {children}
        </button>
      ) : (
        <span className="px-3 py-1">{children}</span>
      )}
      {onDelete && (
        <button
          className="pr-2.5 text-muted hover:text-danger"
          aria-label="Delete board"
          onClick={() => {
            if (confirm("Delete this saved board?")) onDelete();
          }}
        >
          ×
        </button>
      )}
    </span>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex items-center gap-2 text-muted hover:text-fg">
      <span className={`relative h-5 w-9 rounded-full transition-colors ${on ? "bg-accent" : "bg-line"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
      </span>
      {label}
    </button>
  );
}

function WindLimits({ xw, tw, onChange }: { xw: number; tw: number; onChange: (xw: number, tw: number) => void }) {
  const [open, setOpen] = useState(false);
  const [draftXw, setDraftXw] = useState(xw);
  const [draftTw, setDraftTw] = useState(tw);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => {
          setDraftXw(xw);
          setDraftTw(tw);
          setOpen(!open);
        }}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-muted hover:text-fg"
      >
        <WindsockIcon />
        Wind limits <span className="font-mono text-xs">{xw}/{tw}</span>
      </button>
      {open && (
        <form
          className="absolute right-0 z-30 mt-2 w-64 rounded-lg border border-line bg-surface-2 p-4 shadow-xl"
          onSubmit={(e) => {
            e.preventDefault();
            onChange(Math.max(0, draftXw), Math.max(0, draftTw));
            setOpen(false);
          }}
        >
          <p className="mb-3 text-xs text-muted">Values above these turn red on the board. Gusts count.</p>
          <label className="mb-3 flex items-center justify-between gap-3 text-sm">
            Crosswind
            <span className="flex items-center gap-1">
              <input type="number" min={0} max={60} value={draftXw} onChange={(e) => setDraftXw(Number(e.target.value))} className="w-16 rounded border border-line bg-surface px-2 py-1 text-right font-mono" />
              kt
            </span>
          </label>
          <label className="mb-4 flex items-center justify-between gap-3 text-sm">
            Tailwind
            <span className="flex items-center gap-1">
              <input type="number" min={0} max={30} value={draftTw} onChange={(e) => setDraftTw(Number(e.target.value))} className="w-16 rounded border border-line bg-surface px-2 py-1 text-right font-mono" />
              kt
            </span>
          </label>
          <button type="submit" className="w-full rounded-md bg-accent py-1.5 text-sm font-medium text-bg">
            Apply
          </button>
        </form>
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
  trafficScale,
  onRemove,
}: {
  row: AirportAtis;
  now: number;
  changed: boolean;
  xwLimit: number;
  twLimit: number;
  trafficScale: number;
  onRemove?: () => void;
}) {
  // Weather comes from whichever ATIS was issued last.
  const main = [row.arr, row.dep].filter(Boolean).sort((a, b) => b!.issuedAt.localeCompare(a!.issuedAt))[0] ?? null;
  const d = main?.decoded;
  const ww = d ? worstWind(d) : null;
  const flags = d ? mergeFlags(row.arr, row.dep) : [];
  const f = row.flights;

  return (
    <div className={`group relative grid grid-cols-2 gap-x-3 gap-y-2 border-b border-line px-3 py-2.5 last:border-b-0 lg:items-center ${COLS} ${changed ? "row-changed" : ""}`}>
      <div className="col-span-2 flex items-start gap-2 lg:col-span-1">
        <Link href={`/a/${row.icao}`} className="min-w-0 hover:text-accent">
          <div className="font-mono text-lg font-semibold leading-tight">
            {row.icao}
            {row.airport?.iata && <span className="ml-1.5 text-sm font-normal text-muted">{row.airport.iata}</span>}
          </div>
          <div className="truncate text-xs text-muted">{row.airport ? `${row.airport.city || row.airport.name}, ${row.airport.country}` : "Unknown airport"}</div>
        </Link>
        {onRemove && (
          <button onClick={onRemove} className="ml-auto text-muted opacity-0 transition group-hover:opacity-100 hover:text-danger focus:opacity-100" aria-label={`Remove ${row.icao}`}>
            ×
          </button>
        )}
      </div>

      <div className="col-span-2 flex flex-col gap-1.5 lg:col-span-1">
        {row.split ? (
          <>
            <AtisCell rec={row.arr} now={now} label="ARR" icao={row.icao} />
            <AtisCell rec={row.dep} now={now} label="DEP" icao={row.icao} />
          </>
        ) : (
          <AtisCell rec={row.arr} now={now} icao={row.icao} />
        )}
      </div>

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

      <div className="flex items-center gap-2">
        {f && (f.depBuckets.some(Boolean) || f.arrBuckets.some(Boolean) || f.inbound) ? (
          <>
            <TrafficSpark dep={f.depBuckets} arr={f.arrBuckets} scale={trafficScale} />
            <Link href={`/a/${row.icao}`} className="font-mono text-xs leading-tight text-muted hover:text-fg" title="Inbound now (heard over ACARS)">
              <span className="text-fg">{f.inbound}</span>
              <br />
              inbound
            </Link>
          </>
        ) : (
          <span className="text-sm text-muted">—</span>
        )}
      </div>

      <div className="col-span-2 lg:col-span-1">
        <FlagChips flags={flags} limit={4} />
      </div>
    </div>
  );
}

function AtisCell({ rec, now, label, icao }: { rec: AtisRecord | null; now: number; label?: "ARR" | "DEP"; icao: string }) {
  if (!rec) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <LetterBadge />
        <span>{label ? `${label} · ` : ""}no D-ATIS heard</span>
      </div>
    );
  }
  const age = minutesSince(rec.issuedAt, now);
  const heard = minutesSince(rec.lastSeen, now);
  const stale = heard > STALE_MIN || age > OLD_ISSUE_MIN;
  const d = rec.decoded;
  const rwys = label === "DEP" ? d.departureRunways : label === "ARR" ? d.arrivalRunways : null;
  return (
    <Link href={`/a/${icao}`} className="flex min-w-0 items-center gap-2">
      <LetterBadge letter={rec.letter} stale={stale} />
      <span className="min-w-0 text-sm">
        <span className="block font-mono">
          {label && <span className="mr-1 text-[11px] text-muted">{label}</span>}
          {rwys ? (
            rwys.join(" ") || <span className="text-muted">rwy ?</span>
          ) : (
            <>
              {d.arrivalRunways.length > 0 && <span title="Landing">↓{d.arrivalRunways.join(" ")} </span>}
              {d.departureRunways.length > 0 && <span title="Take-off">↑{d.departureRunways.join(" ")}</span>}
              {!d.arrivalRunways.length && !d.departureRunways.length && <span className="text-muted">rwy ?</span>}
            </>
          )}
          {d.approaches[0] && <span className="ml-1.5 text-xs text-muted">{d.approaches[0].type}</span>}
        </span>
        <span className={`block text-xs ${stale ? "text-warn" : "text-muted"}`}>
          {d.issued ? `${d.issued}Z` : fmtZ(rec.issuedAt)} · {fmtAge(age)} ago
          {stale && heard > STALE_MIN && ` · last heard ${fmtAge(heard)} ago`}
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

function AddAirports({ onAdd, autoFocus }: { onAdd: (icaos: string[]) => void; autoFocus?: boolean }) {
  const [value, setValue] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Array<{ icao: string; iata: string; name: string; city: string; country: string }>>([]);

  const query = value.trim();
  const searchable = query.length >= 2 && !/[\s,\-]/.test(query);
  useEffect(() => {
    if (!searchable) return;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/v1/airports?q=${encodeURIComponent(query)}`);
      if (res.ok) setSuggestions((await res.json()).data);
    }, 200);
    return () => clearTimeout(t);
  }, [query, searchable]);

  const submit = async () => {
    if (!query) return;
    const res = await fetch(`/api/v1/airports?resolve=${encodeURIComponent(value)}`);
    const { icaos, unknown } = (await res.json()) as { icaos: string[]; unknown: string[] };
    if (icaos.length) onAdd(icaos);
    setNote(unknown.length ? `Not found: ${unknown.join(", ")}` : null);
    setValue("");
    setSuggestions([]);
  };

  return (
    <div className="relative">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Add airports: type a code or name, or paste a route like LPPT-KJFK ALT KBOS, then Enter"
          aria-label="Add airports or a route"
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm placeholder:text-muted focus:border-accent focus:outline-none"
        />
      </form>
      {note && <p className="mt-1 text-xs text-warn">{note}</p>}
      {searchable && suggestions.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full max-w-xl overflow-hidden rounded-md border border-line bg-surface-2 shadow-lg">
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
