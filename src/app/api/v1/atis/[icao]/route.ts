import { json, ATTRIBUTION } from "@/lib/api";
import { resolveCode } from "@/lib/airports";
import { LATEST_MAX_AGE_MIN, source, toAirportRows } from "@/lib/data";

/** GET /api/v1/atis/{icao}?hours=24 — current ATIS plus every issue in the last `hours` (max 72). */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/atis/[icao]">) {
  const icao = resolveCode((await ctx.params).icao);
  if (!icao) return json({ error: "unknown airport code" }, { status: 404 });
  const hours = Math.min(Math.max(Number(new URL(request.url).searchParams.get("hours") ?? 24) || 24, 1), 72);
  const src = await source();
  const [latest, history] = await Promise.all([src.latest([icao], LATEST_MAX_AGE_MIN), src.history(icao, hours)]);
  return json({
    source: src.kind,
    attribution: ATTRIBUTION,
    generatedAt: new Date().toISOString(),
    data: { ...toAirportRows(latest, [icao])[0], history },
  });
}
