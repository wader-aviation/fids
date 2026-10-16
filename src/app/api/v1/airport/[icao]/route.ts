import { json, ATTRIBUTION } from "@/lib/api";
import { airport, resolveCode } from "@/lib/airports";
import { airportFlights, flightCounts, LATEST_MAX_AGE_MIN, LEGS_WINDOW_MS, source, toAirportRows } from "@/lib/data";
import { legStatus } from "@/lib/movements/legs";

/**
 * GET /api/v1/airport/{icao}?hours=24 — everything for the airport board in one call:
 * current ATIS + history, departures, arrivals and counts. Weather and NOTAMs have their own endpoints.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/airport/[icao]">) {
  const icao = resolveCode((await ctx.params).icao);
  if (!icao) return json({ error: "unknown airport code" }, { status: 404 });
  const hours = Math.min(Math.max(Number(new URL(request.url).searchParams.get("hours") ?? 24) || 24, 1), 72);
  const src = await source();
  const [latest, history, legs] = await Promise.all([
    src.latest([icao], LATEST_MAX_AGE_MIN),
    src.history(icao, hours),
    src.legs([icao], LEGS_WINDOW_MS),
  ]);
  const now = new Date();
  const { departures, arrivals } = airportFlights(legs, icao, now);
  const withStatus = (l: (typeof legs)[number]) => ({
    ...l,
    status: legStatus(l),
    originCity: l.origin ? (airport(l.origin)?.city ?? null) : null,
    destinationCity: l.destination ? (airport(l.destination)?.city ?? null) : null,
  });
  return json({
    source: src.kind,
    attribution: ATTRIBUTION,
    generatedAt: now.toISOString(),
    data: {
      ...toAirportRows(latest, [icao])[0],
      history,
      departures: departures.map(withStatus),
      arrivals: arrivals.map(withStatus),
      counts: flightCounts(legs, icao, now),
    },
  });
}
