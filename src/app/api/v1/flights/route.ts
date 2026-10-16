import { json, ATTRIBUTION } from "@/lib/api";
import { airport, resolveCode } from "@/lib/airports";
import { airportFlights, LEGS_WINDOW_MS, source } from "@/lib/data";
import { legStatus } from "@/lib/movements/legs";

/** GET /api/v1/flights?airport=KJFK&dir=dep|arr — flights heard over ACARS for one airport. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const icao = resolveCode(params.get("airport") ?? "");
  if (!icao) return json({ error: "airport is required (ICAO or IATA)" }, { status: 400 });
  const dir = params.get("dir");
  const src = await source();
  const { departures, arrivals } = airportFlights(await src.legs([icao], LEGS_WINDOW_MS), icao);
  const withStatus = <T extends Parameters<typeof legStatus>[0]>(l: T) => ({
    ...l,
    status: legStatus(l),
    originCity: l.origin ? (airport(l.origin)?.city ?? null) : null,
    destinationCity: l.destination ? (airport(l.destination)?.city ?? null) : null,
  });
  return json({
    source: src.kind,
    attribution: `${ATTRIBUTION} Flights heard over ACARS; not a full schedule.`,
    generatedAt: new Date().toISOString(),
    data: {
      icao,
      ...(dir !== "arr" && { departures: departures.map(withStatus) }),
      ...(dir !== "dep" && { arrivals: arrivals.map(withStatus) }),
    },
  });
}
