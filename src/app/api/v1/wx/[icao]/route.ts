import { json } from "@/lib/api";
import { resolveCode } from "@/lib/airports";
import { weather } from "@/lib/weather";

/** GET /api/v1/wx/{icao} — latest METAR and TAF from aviationweather.gov. */
export async function GET(_request: Request, ctx: RouteContext<"/api/v1/wx/[icao]">) {
  const icao = resolveCode((await ctx.params).icao);
  if (!icao) return json({ error: "unknown airport code" }, { status: 404 });
  return json({ data: await weather(icao) }, { headers: { "Cache-Control": "public, max-age=120, s-maxage=120" } });
}
