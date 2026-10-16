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

/** Groups latest records into one row per airport. A combined ATIS fills both columns unless a newer split one exists. */
export function toAirportRows(records: AtisRecord[], order?: string[]): AirportAtis[] {
  const rows = new Map<string, AirportAtis>();
  const row = (icao: string) => {
    let r = rows.get(icao);
    if (!r) {
      const a = airport(icao);
      r = { icao, airport: a ? { iata: a.iata, name: a.name, city: a.city, country: a.country } : null, arr: null, dep: null };
      rows.set(icao, r);
    }
    return r;
  };
  for (const rec of records) {
    const r = row(rec.icao);
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

export interface FlightCounts {
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
  return {
    departedLastHour: departures.filter((l) => (l.offAt ?? l.outAt ?? "") >= hourAgo).length,
    arrivedLastHour: arrivals.filter((l) => (l.onAt ?? l.inAt ?? "") >= hourAgo).length,
    inbound: inbound.length,
    nextEta: etas[0] ?? null,
  };
}
