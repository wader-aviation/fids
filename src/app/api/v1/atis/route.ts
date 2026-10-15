import { json, ATTRIBUTION } from "@/lib/api";
import { parseAirportList } from "@/lib/airports";
import { LATEST_MAX_AGE_MIN, source, toAirportRows } from "@/lib/data";

/** GET /api/v1/atis?icao=KJFK,LIS — latest ARR/DEP ATIS per airport. Without `icao`, every airport heard recently. */
export async function GET(request: Request) {
  const param = new URL(request.url).searchParams.get("icao");
  const icaos = param ? parseAirportList(param).icaos.slice(0, 100) : null;
  const src = await source();
  const records = await src.latest(icaos, LATEST_MAX_AGE_MIN);
  return json({ source: src.kind, attribution: ATTRIBUTION, generatedAt: new Date().toISOString(), data: toAirportRows(records, icaos ?? undefined) });
}
