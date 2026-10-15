import { airport } from "@/lib/airports";
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
