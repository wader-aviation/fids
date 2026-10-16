/**
 * FAA NOTAM Management Service (NMS-API) client.
 *
 * Ported from Wader's cloud-code `nms.js` / `notam-normalize.js`, which were measured against the
 * live API. The rules that matter:
 *  - 1 request per second, burst 1, and no Retry-After on 429 → pace on a minimum interval.
 *  - A throttle body is `{fault:{…}}` with no `data`; it must never read as "no NOTAMs".
 *  - Never send a date filter: NMS filters on *start* date and drops NOTAMs already in force.
 *  - `effectiveEnd` may be "PERM"; `estimated` is the string "true" or absent; fields are padded.
 */
import { classify, type Notam } from "./classify";

const BASE = (process.env.NMS_BASE_URL ?? "https://api-nms.aim.faa.gov").replace(/\/+$/, "");
const MIN_INTERVAL_MS = 1200;
const MAX_ATTEMPTS = 3;
const USER_AGENT = "fids (open-source flight information board)";

export const nmsConfigured = () => !!(process.env.NMS_CLIENT_ID && process.env.NMS_CLIENT_SECRET);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Per-process pacing: hand out slots at a fixed interval so requests never burst.
let nextSlot = 0;
async function pace() {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + MIN_INTERVAL_MS;
  if (slot > now) await sleep(slot - now);
}

let token: { value: string; expires: number } | null = null;
let tokenInFlight: Promise<string> | null = null;

async function getToken(force = false): Promise<string> {
  if (!force && token && Date.now() < token.expires) return token.value;
  tokenInFlight ??= (async () => {
    const basic = Buffer.from(`${process.env.NMS_CLIENT_ID}:${process.env.NMS_CLIENT_SECRET}`).toString("base64");
    await pace();
    const res = await fetch(`${BASE}/v1/auth/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      body: "grant_type=client_credentials",
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: string; fault?: unknown };
    if (!res.ok || !body.access_token) throw new Error(`NMS token request failed (HTTP ${res.status})`);
    const ttl = (parseInt(body.expires_in ?? "", 10) || 1799) * 1000;
    token = { value: body.access_token, expires: Date.now() + ttl - Math.min(5 * 60_000, ttl / 2) };
    return token.value;
  })().finally(() => (tokenInFlight = null));
  return tokenInFlight;
}

class NmsError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly authFailure = false,
  ) {
    super(message);
  }
}

/** Accepts only a positive success envelope; every other shape throws (see header). */
export function parseNmsBody(status: number, text: string): { data?: { geojson?: unknown[] } } {
  let parsed: Record<string, unknown> | null = null;
  if (text.trim()) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new NmsError(`NMS returned non-JSON (HTTP ${status})`, status >= 500);
    }
  }
  if (parsed?.fault) throw new NmsError(`NMS fault (HTTP ${status})`, true);
  if (status === 401 || status === 403) throw new NmsError(`NMS authentication failed (HTTP ${status})`, false, true);
  if (status === 429) throw new NmsError("NMS rate limited (HTTP 429)", true);
  if (status >= 500) throw new NmsError(`NMS server error (HTTP ${status})`, true);
  if (status !== 200) throw new NmsError(`NMS error (HTTP ${status})`, false);
  if (!parsed || !("status" in parsed)) throw new NmsError("NMS returned an unrecognised body", false);
  if (String(parsed.status).toLowerCase() === "failure") throw new NmsError("NMS reported Failure", false);
  return parsed as { data?: { geojson?: unknown[] } };
}

async function nmsGet(path: string, params: Record<string, string>): Promise<{ data?: { geojson?: unknown[] } }> {
  const url = `${BASE}${path}?${new URLSearchParams(params)}`;
  let refreshed = false;
  let last: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const t = await getToken();
    await pace();
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${t}`, Accept: "application/json", nmsResponseFormat: "GEOJSON", "User-Agent": USER_AGENT },
        cache: "no-store",
      });
      return parseNmsBody(res.status, await res.text());
    } catch (e) {
      last = e;
      if (e instanceof NmsError && e.authFailure && !refreshed) {
        refreshed = true;
        token = null;
        continue;
      }
      if (e instanceof NmsError && !e.retryable) break;
      if (attempt < MAX_ATTEMPTS) await sleep(1500 * 2 ** (attempt - 1));
    }
  }
  throw last instanceof Error ? last : new Error("NMS request failed");
}

// ---------------------------------------------------------------- mapping

interface NmsFeature {
  properties?: {
    coreNOTAMData?: {
      notam?: Record<string, unknown>;
      notamTranslation?: Array<Record<string, unknown>>;
    };
  };
}

const str = (v: unknown) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};
const iso = (v: unknown) => {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

function translation(list: unknown, type: string): string | null {
  if (!Array.isArray(list)) return null;
  for (const t of list as Array<Record<string, unknown>>) {
    if (str(t?.type)?.toUpperCase() !== type) continue;
    return str(t.formattedText) ?? str(t.simpleText) ?? str(t.icao_message) ?? str(t.domestic_message) ?? str(t.message);
  }
  return null;
}

/** One NMS GeoJSON feature → Notam, or null when unusable or a cancellation. */
export function mapNmsFeature(feature: unknown): Notam | null {
  const core = (feature as NmsFeature)?.properties?.coreNOTAMData;
  const n = core?.notam;
  if (!n) return null;
  if (str(n.type)?.toUpperCase() === "C") return null; // cancellation notice
  const number = str(n.number);
  const id = str(n.id);
  if (!number && !id) return null;

  const series = str(n.series)?.toUpperCase() ?? "";
  const year = str(n.year);
  // `number` sometimes already carries the series ("A8258") and/or year ("10/123").
  const withSeries = number && series && !number.startsWith(series) ? `${series}${number}` : number;
  const label = withSeries ? (/\//.test(withSeries) || !year ? withSeries : `${withSeries}/${year.slice(-2)}`) : id!;
  const text = translation(core?.notamTranslation, "ICAO") ?? str(n.text) ?? translation(core?.notamTranslation, "LOCAL_FORMAT") ?? "";
  if (!text) return null;
  const selection = str(n.selectionCode)?.toUpperCase() ?? null;
  const qcode = selection && /^Q[A-Z]{4}$/.test(selection) ? selection : null;
  const rawEnd = str(n.effectiveEnd)?.toUpperCase();

  return {
    id: label,
    location: (str(n.icaoLocation) ?? str(n.location) ?? "").toUpperCase(),
    qcode,
    start: iso(n.effectiveStart),
    end: rawEnd === "PERM" ? null : iso(n.effectiveEnd),
    estimatedEnd: str(n.estimated)?.toUpperCase() === "TRUE",
    text,
    ...classify(qcode, text),
  };
}

/** Every NOTAM in force or scheduled for one location. Throws on any failure (never returns a fake empty). */
export async function fetchNmsNotams(location: string): Promise<Notam[]> {
  const body = await nmsGet("/nmsapi/v1/notams", { location: location.toUpperCase() });
  const features = body.data?.geojson;
  if (!Array.isArray(features)) throw new Error("NMS success body without data.geojson");
  return features.map(mapNmsFeature).filter((n): n is Notam => n !== null);
}
