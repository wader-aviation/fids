import { json } from "@/lib/api";
import { parseAirportList, searchAirports } from "@/lib/airports";

/** GET /api/v1/airports?q=lisb — search by ICAO, IATA, name or city. ?resolve=LIS-JFK ALT BOS — codes to ICAO. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const resolve = params.get("resolve");
  if (resolve !== null) return json(parseAirportList(resolve), { headers: { "Cache-Control": "public, max-age=86400" } });
  return json({ data: searchAirports(params.get("q") ?? "") }, { headers: { "Cache-Control": "public, max-age=86400" } });
}
