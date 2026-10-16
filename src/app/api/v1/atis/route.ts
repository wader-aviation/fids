import { json, ATTRIBUTION } from "@/lib/api";
import { parseAirportList } from "@/lib/airports";
import { flightCounts, LATEST_MAX_AGE_MIN, LEGS_WINDOW_MS, source, toAirportRows } from "@/lib/data";

/** GET /api/v1/atis?icao=KJFK,LIS — latest ARR/DEP ATIS and flight counts per airport. Without `icao`, every airport heard recently. */
export async function GET(request: Request) {
  const param = new URL(request.url).searchParams.get("icao");
  const icaos = param ? parseAirportList(param).icaos.slice(0, 100) : null;
  const src = await source();
  const [records, legs] = await Promise.all([src.latest(icaos, LATEST_MAX_AGE_MIN), src.legs(icaos, LEGS_WINDOW_MS)]);
  const now = new Date();
  const rows = toAirportRows(records, icaos ?? undefined).map((r) => ({ ...r, flights: flightCounts(legs, r.icao, now) }));
  return json({ source: src.kind, attribution: ATTRIBUTION, generatedAt: now.toISOString(), data: rows });
}
