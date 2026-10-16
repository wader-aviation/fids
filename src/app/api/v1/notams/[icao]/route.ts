import { json } from "@/lib/api";
import { resolveCode } from "@/lib/airports";
import { faaNotams } from "@/lib/notams/faa";

/** GET /api/v1/notams/{icao} — NOTAMs from the FAA NOTAM API, grouped and labelled. */
export async function GET(_request: Request, ctx: RouteContext<"/api/v1/notams/[icao]">) {
  const icao = resolveCode((await ctx.params).icao);
  if (!icao) return json({ error: "unknown airport code" }, { status: 404 });
  const result = await faaNotams(icao);
  return json(
    { attribution: "NOTAMs from the FAA NOTAM API. Check official sources.", data: { icao, ...result } },
    { headers: { "Cache-Control": "public, max-age=300, s-maxage=300" } },
  );
}
