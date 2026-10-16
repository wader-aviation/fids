import { cacheLife } from "next/cache";

export interface Weather {
  metar: { raw: string; observedAt: string; category: string | null } | null;
  taf: { raw: string; issuedAt: string } | null;
}

const BASE = "https://aviationweather.gov/api/data";

async function getJson<T>(url: string): Promise<T[]> {
  const res = await fetch(url, { headers: { "User-Agent": "fids" } });
  if (!res.ok || res.status === 204) return [];
  return res.json();
}

/** METAR + TAF from aviationweather.gov (NOAA, public domain), cached 5 minutes. */
export async function weather(icao: string): Promise<Weather> {
  "use cache";
  cacheLife({ stale: 60, revalidate: 300, expire: 3600 });
  const [metars, tafs] = await Promise.all([
    getJson<{ rawOb: string; obsTime: number; fltCat?: string }>(`${BASE}/metar?ids=${icao}&format=json`).catch(() => []),
    getJson<{ rawTAF: string; issueTime: string }>(`${BASE}/taf?ids=${icao}&format=json`).catch(() => []),
  ]);
  const m = metars[0];
  const t = tafs[0];
  return {
    metar: m ? { raw: m.rawOb, observedAt: new Date(m.obsTime * 1000).toISOString(), category: m.fltCat ?? null } : null,
    taf: t ? { raw: t.rawTAF, issuedAt: t.issueTime } : null,
  };
}
