import { airport } from "@/lib/airports";
import { arrivalsTo, departuresFrom } from "@/lib/movements/legs";
import type { FlightLeg } from "@/lib/movements/types";
import type { AirportAtis, AtisRecord, AtisSource } from "./types";

export type { AirportAtis, AtisRecord } from "./types";

/** Database when DATABASE_URL is set, otherwise the in-memory live feed. */
export async function source(): Promise<AtisSource> {
  if (process.env.DATABASE_URL) return (await import("./db-source")).dbSource;
  return (await import("./live-source")).liveSource;
}

/** Board window: an ATIS not heard for 3 hours is dropped. */
export const LATEST_MAX_AGE_MIN = 180;

const newer = (a: AtisRecord | null, b: AtisRecord) => (!a || b.issuedAt > a.issuedAt ? b : a);

/** How far back we look to decide whether an airport has separate arrival and departure ATIS. */
export const SPLIT_LOOKBACK_HOURS = 24;

/**
 * Groups latest records into one row per airport.
 * Airports in `split` get separate ARR and DEP columns; all others show one ATIS (the newest of any type).
 */
export function toAirportRows(records: AtisRecord[], order?: string[], split: Set<string> = new Set()): AirportAtis[] {
  const rows = new Map<string, AirportAtis>();
  const row = (icao: string) => {
    let r = rows.get(icao);
    if (!r) {
      const a = airport(icao);
      r = {
        icao,
        airport: a ? { iata: a.iata, name: a.name, city: a.city, country: a.country } : null,
        split: split.has(icao),
        arr: null,
        dep: null,
      };
      rows.set(icao, r);
    }
    return r;
  };
  for (const rec of records) {
    const r = row(rec.icao);
    if (!r.split) {
      r.arr = r.dep = newer(r.arr, rec);
      continue;
    }
    if (rec.type !== "DEP") r.arr = newer(r.arr, rec);
    if (rec.type !== "ARR") r.dep = newer(r.dep, rec);
  }
  if (order) {
    order.forEach(row); // keep requested airports even without ATIS
    return order.map((icao) => rows.get(icao)!);
  }
  return [...rows.values()].sort((a, b) => a.icao.localeCompare(b.icao));
}

/** Legs heard within this window are loaded for boards. */
export const LEGS_WINDOW_MS = 18 * 3_600_000;
/** Finished movements stay on the airport board this long. */
export const BOARD_PAST_MS = 3 * 3_600_000;

export function airportFlights(legs: FlightLeg[], icao: string, now = new Date()) {
  const w = { now, pastMs: BOARD_PAST_MS };
  return { departures: departuresFrom(legs, icao, w), arrivals: arrivalsTo(legs, icao, w) };
}

/** Traffic sparkline: 6 buckets of 30 minutes, oldest first, ending now. */
export const TRAFFIC_BUCKETS = 6;
const BUCKET_MS = 30 * 60_000;

export interface FlightCounts {
  /** Departures (OFF, or OUT) per 30-minute bucket over the last 3 hours, oldest first. */
  depBuckets: number[];
  /** Arrivals (ON, or IN) per 30-minute bucket over the last 3 hours, oldest first. */
  arrBuckets: number[];
  /** Took off (or pushed back) in the last hour. */
  departedLastHour: number;
  /** Landed (or reached the gate) in the last hour. */
  arrivedLastHour: number;
  /** Inbound, not landed yet. */
  inbound: number;
  /** Earliest ETA among inbound flights. */
  nextEta: string | null;
}

export function flightCounts(legs: FlightLeg[], icao: string, now = new Date()): FlightCounts {
  const hourAgo = new Date(now.getTime() - 3_600_000).toISOString();
  const { departures, arrivals } = airportFlights(legs, icao, now);
  const inbound = arrivals.filter((l) => !l.onAt && !l.inAt);
  const nowIso = now.toISOString();
  const etas = inbound.map((l) => l.eta).filter((e): e is string => !!e && e >= nowIso).sort();
  const buckets = (times: Array<string | null>) => {
    const out = new Array<number>(TRAFFIC_BUCKETS).fill(0);
    for (const t of times) {
      if (!t) continue;
      const ago = now.getTime() - new Date(t).getTime();
      const i = TRAFFIC_BUCKETS - 1 - Math.floor(ago / BUCKET_MS);
      if (ago >= 0 && i >= 0) out[i]++;
    }
    return out;
  };
  return {
    depBuckets: buckets(departures.map((l) => l.offAt ?? l.outAt)),
    arrBuckets: buckets(arrivals.map((l) => l.onAt ?? l.inAt)),
    departedLastHour: departures.filter((l) => (l.offAt ?? l.outAt ?? "") >= hourAgo).length,
    arrivedLastHour: arrivals.filter((l) => (l.onAt ?? l.inAt ?? "") >= hourAgo).length,
    inbound: inbound.length,
    nextEta: etas[0] ?? null,
  };
}
