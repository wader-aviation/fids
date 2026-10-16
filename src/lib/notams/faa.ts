import { cacheLife } from "next/cache";
import type { Notam } from "./classify";
import { fetchNmsNotams, nmsConfigured } from "./nms";

export type NotamResult =
  | { status: "ok"; notams: Notam[]; fetchedAt: string }
  | { status: "not-configured" }
  | { status: "error"; message: string };

/** Successful lookups are cached 15 minutes. Failures are thrown, so they are never cached. */
async function cachedNotams(icao: string): Promise<{ notams: Notam[]; fetchedAt: string }> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 900, expire: 3600 });
  return { notams: await fetchNmsNotams(icao), fetchedAt: new Date().toISOString() };
}

/** NOTAMs for one airport from the FAA NOTAM Management Service (keys: NMS_CLIENT_ID / NMS_CLIENT_SECRET). */
export async function faaNotams(icao: string): Promise<NotamResult> {
  if (!nmsConfigured()) return { status: "not-configured" };
  try {
    return { status: "ok", ...(await cachedNotams(icao)) };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "request failed" };
  }
}
