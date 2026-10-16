import { fetchMessagesSince, type AirframesMessage } from "@/lib/airframes/client";
import { diffAtis } from "@/lib/decoder/diff";
import { assemble, isBetter, merge } from "@/lib/ingest/assemble";
import { decodeMovement, MOVEMENT_LABELS } from "@/lib/movements/decode";
import { foldEvents, LEG_IDLE_MS } from "@/lib/movements/legs";
import type { FlightLeg } from "@/lib/movements/types";
import type { AtisRecord, AtisSource } from "./types";

/**
 * Database-free source for development and previews: keeps the last few hours of ATIS
 * in memory, refreshed from Airframes at most once a minute.
 */
const REFRESH_MS = 60_000;
const KEEP_MS = 6 * 3_600_000;
const STITCH_KEEP_MS = 3 * 60_000;

interface Store {
  records: Map<string, AtisRecord>;
  recentRaw: AirframesMessage[];
  lastId: number;
  legs: Map<string, FlightLeg>;
  currentLeg: Map<string, FlightLeg>;
  movementLastId: number;
  refreshedAt: number;
  pending: Promise<void> | null;
}

const g = globalThis as unknown as { __fidsLive?: Store };
const store: Store = (g.__fidsLive ??= {
  records: new Map(),
  recentRaw: [],
  lastId: 0,
  legs: new Map(),
  currentLeg: new Map(),
  movementLastId: 0,
  refreshedAt: 0,
  pending: null,
});

async function refresh() {
  const now = Date.now();
  const first = store.lastId === 0;
  const since = new Date(now - (first ? 60 : 15) * 60_000).toISOString();
  const [a9, other] = await Promise.all([
    fetchMessagesSince({ labels: ["A9"], afterId: store.lastId, since, maxPages: first ? 15 : 5 }),
    fetchMessagesSince({ labels: ["RA", "HX"], text: "ATIS", afterId: store.lastId, since, maxPages: 3 }),
    refreshMovements(now).catch(() => {}), // ATIS must not fail because movements did
  ]);
  const fresh = [...a9.messages, ...other.messages].sort((a, b) => a.id - b.id);
  if (fresh.length) {
    const freshIds = new Set(fresh.map((m) => m.id));
    const candidates = assemble([...store.recentRaw, ...fresh]).filter((c) => c.sourceIds.some((id) => freshIds.has(id)));
    for (const m of merge(candidates)) {
      const cur = store.records.get(m.key);
      if (!cur) {
        store.records.set(m.key, {
          key: m.key,
          icao: m.decoded.icao,
          type: m.decoded.type,
          letter: m.decoded.letter,
          issuedAt: m.issuedAt.toISOString(),
          firstSeen: m.firstSeen.toISOString(),
          lastSeen: m.lastSeen.toISOString(),
          sightings: m.sightings,
          truncated: m.decoded.truncated,
          text: m.text,
          decoded: m.decoded,
          prevKey: null,
          diff: null,
        });
        continue;
      }
      cur.sightings += m.sightings;
      if (m.lastSeen.toISOString() > cur.lastSeen) cur.lastSeen = m.lastSeen.toISOString();
      if (isBetter({ truncated: m.decoded.truncated, length: m.text.length }, { truncated: cur.truncated, length: cur.text.length })) {
        Object.assign(cur, { text: m.text, decoded: m.decoded, truncated: m.decoded.truncated });
      }
    }
    store.lastId = fresh[fresh.length - 1].id;
    store.recentRaw = [...store.recentRaw, ...fresh].filter((m) => now - new Date(m.timestamp).getTime() < STITCH_KEEP_MS);
  }

  for (const [key, r] of store.records) if (now - new Date(r.lastSeen).getTime() > KEEP_MS) store.records.delete(key);
  linkDiffs();
  store.refreshedAt = now;
}

/** Movement messages are ~130/min; the first load takes the last 12 minutes (Airframes allows 60 calls/min). */
async function refreshMovements(now: number) {
  const first = store.movementLastId === 0;
  const since = new Date(now - (first ? 12 : 10) * 60_000).toISOString();
  const { messages } = await fetchMessagesSince({
    labels: MOVEMENT_LABELS,
    afterId: store.movementLastId,
    since,
    maxPages: first ? 12 : 6,
  });
  if (!messages.length) return;
  const events = messages.map(decodeMovement).filter((e) => e !== null);
  for (const leg of foldEvents(store.currentLeg, events)) store.legs.set(leg.key, leg);
  store.movementLastId = messages[messages.length - 1].id;
  for (const [key, leg] of store.legs) if (now - new Date(leg.lastSeen).getTime() > LEG_IDLE_MS) store.legs.delete(key);
}

/** Recomputes prev/diff along each airport+type sequence. */
function linkDiffs() {
  const groups = new Map<string, AtisRecord[]>();
  for (const r of store.records.values()) {
    const k = `${r.icao}|${r.type}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.issuedAt.localeCompare(b.issuedAt));
    list.forEach((r, i) => {
      const prev = list[i - 1];
      r.prevKey = prev?.key ?? null;
      r.diff = prev ? diffAtis(prev.decoded, r.decoded) : null;
    });
  }
}

/** Waits only for the very first load; after that, serves what it has and refreshes in the background. */
async function ensureFresh() {
  if (Date.now() - store.refreshedAt < REFRESH_MS) return;
  store.pending ??= refresh()
    .catch(() => {})
    .finally(() => (store.pending = null));
  if (store.refreshedAt === 0) await store.pending;
}

export const liveSource: AtisSource = {
  kind: "live",

  async latest(icaos, maxAgeMin) {
    await ensureFresh();
    const since = new Date(Date.now() - maxAgeMin * 60_000).toISOString();
    const wanted = icaos ? new Set(icaos) : null;
    const best = new Map<string, AtisRecord>();
    for (const r of store.records.values()) {
      if (r.lastSeen < since || (wanted && !wanted.has(r.icao))) continue;
      const k = `${r.icao}|${r.type}`;
      const cur = best.get(k);
      if (!cur || r.issuedAt > cur.issuedAt) best.set(k, r);
    }
    return [...best.values()];
  },

  async legs(icaos, sinceMs) {
    await ensureFresh();
    const since = new Date(Date.now() - sinceMs).toISOString();
    const wanted = icaos ? new Set(icaos) : null;
    return [...store.legs.values()].filter(
      (l) => l.lastSeen >= since && (!wanted || (l.origin && wanted.has(l.origin)) || (l.destination && wanted.has(l.destination))),
    );
  },

  async history(icao, hours) {
    await ensureFresh();
    const since = new Date(Date.now() - hours * 3_600_000).toISOString();
    return [...store.records.values()]
      .filter((r) => r.icao === icao && r.issuedAt >= since)
      .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  },
};
