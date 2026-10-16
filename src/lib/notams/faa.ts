import { cacheLife } from "next/cache";
import { classify, type Notam } from "./classify";

const URL_BASE = process.env.FAA_NOTAM_API_URL ?? "https://external-api.faa.gov/notamapi/v1/notams";

export type NotamResult =
  | { status: "ok"; notams: Notam[]; fetchedAt: string }
  | { status: "not-configured" }
  | { status: "error"; message: string };

/** Subset of the FAA NOTAM API (GeoJSON) item we use. */
interface FaaItem {
  properties?: {
    coreNOTAMData?: {
      notam?: {
        id?: string;
        number?: string;
        series?: string;
        year?: string;
        location?: string;
        icaoLocation?: string;
        selectionCode?: string;
        effectiveStart?: string;
        effectiveEnd?: string;
        text?: string;
      };
      notamTranslation?: Array<{ type?: string; formattedText?: string; simpleText?: string }>;
    };
  };
}

const toIso = (s?: string) => {
  if (!s || /^PERM/i.test(s)) return null;
  const d = new Date(s.replace(/EST$/i, ""));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

export function mapFaaItem(item: FaaItem): Notam | null {
  const core = item.properties?.coreNOTAMData;
  const n = core?.notam;
  if (!n?.text) return null;
  const icaoText = core?.notamTranslation?.find((t) => t.type === "ICAO")?.formattedText;
  const text = (icaoText ?? n.text).trim();
  const qcode = n.selectionCode ? `Q${n.selectionCode.replace(/^Q/, "")}`.toUpperCase() : (/\bQ\)\s*\w+\/(Q[A-Z]{4})\//.exec(text)?.[1] ?? null);
  const id = n.series && n.number ? `${n.series}${n.number}${n.year ? `/${n.year.slice(-2)}` : ""}` : (n.number ?? n.id ?? "?");
  return {
    id,
    location: (n.icaoLocation ?? n.location ?? "").toUpperCase(),
    qcode: qcode && /^Q[A-Z]{4}$/.test(qcode) ? qcode : null,
    start: toIso(n.effectiveStart),
    end: toIso(n.effectiveEnd),
    estimatedEnd: /EST$/i.test(n.effectiveEnd ?? ""),
    text,
    ...classify(qcode, text),
  };
}

/** NOTAMs for one airport from the FAA NOTAM API (free keys from api.faa.gov). Cached 15 minutes. */
export async function faaNotams(icao: string): Promise<NotamResult> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 900, expire: 3600 });
  const id = process.env.FAA_CLIENT_ID;
  const secret = process.env.FAA_CLIENT_SECRET;
  if (!id || !secret) return { status: "not-configured" };

  try {
    const notams: Notam[] = [];
    for (let page = 1; page <= 5; page++) {
      const res = await fetch(`${URL_BASE}?icaoLocation=${icao}&pageSize=1000&pageNum=${page}`, {
        headers: { client_id: id, client_secret: secret, Accept: "application/json" },
      });
      if (!res.ok) return { status: "error", message: `FAA NOTAM API ${res.status}` };
      const body = (await res.json()) as { items?: FaaItem[]; totalPages?: number };
      for (const item of body.items ?? []) {
        const n = mapFaaItem(item);
        if (n) notams.push(n);
      }
      if (!body.totalPages || page >= body.totalPages) break;
    }
    return { status: "ok", notams, fetchedAt: new Date().toISOString() };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "request failed" };
  }
}
