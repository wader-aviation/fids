/** Subset of the Airframes /v1/messages item we use. */
export interface AirframesMessage {
  id: number;
  label: string | null;
  text: string | null;
  timestamp: string;
  tail: string | null;
  flightNumber?: string | null;
  blockId: string | null;
  error: number | null;
  sourceType: string | null;
  station?: { id?: number } | null;
}

const BASE = process.env.AIRFRAMES_API_URL ?? "https://api.airframes.io/v1";
const PAGE = 100;

interface Query {
  labels: string[];
  text?: string;
  /** Only messages with id greater than this are returned. */
  afterId: number;
  /** ISO time passed as `since` to bound the scan. */
  since: string;
  maxPages: number;
}

async function getJson(url: string, attempt = 0): Promise<AirframesMessage[]> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "fids (open-source flight information board)",
  };
  if (process.env.AIRFRAMES_API_KEY) headers.Authorization = `Bearer ${process.env.AIRFRAMES_API_KEY}`;

  const res = await fetch(url, { headers, cache: "no-store" });
  if (res.status === 429 && attempt < 2) {
    const wait = Math.min(Number(res.headers.get("retry-after") ?? 5), 20);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return getJson(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`Airframes ${res.status} for ${url}`);
  return res.json();
}

/**
 * Pages newest → oldest until it reaches `afterId` or runs out of pages.
 * Returns messages oldest first.
 */
export async function fetchMessagesSince(q: Query): Promise<{ messages: AirframesMessage[]; complete: boolean }> {
  const out: AirframesMessage[] = [];
  let beforeId: number | undefined;
  for (let page = 0; page < q.maxPages; page++) {
    const params = new URLSearchParams({ labels: q.labels.join(","), since: q.since, limit: String(PAGE) });
    if (q.text) params.set("text", q.text);
    if (beforeId) params.set("before_id", String(beforeId));
    const batch = await getJson(`${BASE}/messages?${params}`);

    const fresh = batch.filter((m) => m.id > q.afterId);
    out.push(...fresh);
    if (batch.length < PAGE || fresh.length < batch.length) {
      return { messages: out.sort((a, b) => a.id - b.id), complete: true };
    }
    beforeId = batch[batch.length - 1].id;
  }
  return { messages: out.sort((a, b) => a.id - b.id), complete: false };
}
