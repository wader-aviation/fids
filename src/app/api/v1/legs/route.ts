import { json, ATTRIBUTION } from "@/lib/api";
import { airport } from "@/lib/airports";
import { source } from "@/lib/data";
import { legStatus } from "@/lib/movements/legs";

/** GET /api/v1/legs?tail=N123AB or ?flight=AA1476 — every leg heard over ACARS (kept 3 days), newest first. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const tail = params.get("tail")?.trim().toUpperCase() || undefined;
  const flight = params.get("flight")?.trim().toUpperCase() || undefined;
  if (!tail && !flight) return json({ error: "tail or flight is required" }, { status: 400 });
  const src = await source();
  const legs = await src.legsFor(tail ? { tail } : { flight });
  return json({
    source: src.kind,
    attribution: `${ATTRIBUTION} Flights heard over ACARS; not a full schedule.`,
    data: {
      tail: tail ?? null,
      flight: flight ?? null,
      legs: legs.map((l) => ({
        ...l,
        status: legStatus(l),
        originCity: l.origin ? (airport(l.origin)?.city ?? null) : null,
        destinationCity: l.destination ? (airport(l.destination)?.city ?? null) : null,
      })),
    },
  });
}
