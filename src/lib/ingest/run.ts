import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { fetchMessagesSince, type AirframesMessage } from "@/lib/airframes/client";
import { diffAtis } from "@/lib/decoder/diff";
import { assemble, merge, type MergedAtis } from "./assemble";

const STATE_ID = "airframes";
const SCAN_WINDOW_MS = 15 * 60_000; // never look further back than this
const STITCH_LOOKBACK_MS = 3 * 60_000; // re-read recent raw blocks so multi-block ATIS can join across runs
const RAW_RETENTION_DAYS = 7;
const ATIS_RETENTION_DAYS = 30;

export interface IngestResult {
  fetched: number;
  newAtis: number;
  updatedAtis: number;
  complete: boolean;
}

export async function runIngest(now = new Date()): Promise<IngestResult> {
  const d = db();
  const state = await d.query.ingestState.findFirst({ where: eq(schema.ingestState.id, STATE_ID) });
  const afterId = state?.lastId ?? 0;
  const since = new Date(now.getTime() - SCAN_WINDOW_MS).toISOString();

  // A9 is the ATIS uplink label; fetch all of it so continuation blocks (no "ATIS" in text) come too.
  // RA (printer) and HX carry some ATIS as well, only those mentioning ATIS.
  const [a9, other] = await Promise.all([
    fetchMessagesSince({ labels: ["A9"], afterId, since, maxPages: 10 }),
    fetchMessagesSince({ labels: ["RA", "HX"], text: "ATIS", afterId, since, maxPages: 3 }),
  ]);
  const fresh = [...a9.messages, ...other.messages].filter((m) => m.text).sort((a, b) => a.id - b.id);
  if (!fresh.length) return { fetched: 0, newAtis: 0, updatedAtis: 0, complete: a9.complete && other.complete };

  await d
    .insert(schema.rawMessages)
    .values(
      fresh.map((m) => ({
        id: m.id,
        label: m.label,
        tail: m.tail,
        blockId: m.blockId,
        sourceType: m.sourceType,
        stationId: m.station?.id ?? null,
        text: m.text!,
        receivedAt: new Date(m.timestamp),
      })),
    )
    .onConflictDoNothing();

  // Assemble over recent history + new messages, but only count candidates that include a new message.
  const oldest = new Date(new Date(fresh[0].timestamp).getTime() - STITCH_LOOKBACK_MS);
  const recent = await d
    .select()
    .from(schema.rawMessages)
    .where(and(gte(schema.rawMessages.receivedAt, oldest), lt(schema.rawMessages.id, fresh[0].id)))
    .orderBy(schema.rawMessages.id);
  const freshIds = new Set(fresh.map((m) => m.id));
  const history: AirframesMessage[] = recent.map((r) => ({
    id: r.id,
    label: r.label,
    text: r.text,
    timestamp: r.receivedAt.toISOString(),
    tail: r.tail,
    blockId: r.blockId,
    error: 0,
    sourceType: r.sourceType,
  }));
  const candidates = assemble([...history, ...fresh]).filter((c) => c.sourceIds.some((id) => freshIds.has(id)));
  const merged = merge(candidates);

  const { newAtis, updatedAtis } = await saveAtis(merged);

  const lastId = fresh[fresh.length - 1].id;
  await d
    .insert(schema.ingestState)
    .values({ id: STATE_ID, lastId, updatedAt: now })
    .onConflictDoUpdate({ target: schema.ingestState.id, set: { lastId, updatedAt: now } });

  if (now.getUTCMinutes() === 0) await prune(now);

  return { fetched: fresh.length, newAtis, updatedAtis, complete: a9.complete && other.complete };
}

async function saveAtis(merged: MergedAtis[]): Promise<{ newAtis: number; updatedAtis: number }> {
  if (!merged.length) return { newAtis: 0, updatedAtis: 0 };
  const d = db();
  const existing = await d
    .select({ key: schema.atis.key })
    .from(schema.atis)
    .where(inArray(schema.atis.key, merged.map((m) => m.key)));
  const known = new Set(existing.map((e) => e.key));

  let newAtis = 0;
  for (const m of merged) {
    const row = {
      key: m.key,
      icao: m.decoded.icao,
      type: m.decoded.type,
      letter: m.decoded.letter,
      issuedAt: m.issuedAt,
      firstSeen: m.firstSeen,
      lastSeen: m.lastSeen,
      sightings: m.sightings,
      truncated: m.decoded.truncated,
      text: m.text,
      decoded: m.decoded,
    };

    if (!known.has(m.key)) {
      const prev = await d.query.atis.findFirst({
        where: and(eq(schema.atis.icao, row.icao), eq(schema.atis.type, row.type), lt(schema.atis.issuedAt, row.issuedAt)),
        orderBy: desc(schema.atis.issuedAt),
      });
      const withDiff = prev ? { ...row, prevKey: prev.key, diff: diffAtis(prev.decoded, m.decoded) } : row;
      await d.insert(schema.atis).values(withDiff).onConflictDoNothing();
      newAtis++;
      continue;
    }

    // Keep the best text: complete beats cut, then longer wins.
    const better = sql`(${schema.atis.truncated} AND NOT ${row.truncated}) OR (${schema.atis.truncated} = ${row.truncated} AND length(${schema.atis.text}) < ${row.text.length})`;
    await d
      .update(schema.atis)
      .set({
        firstSeen: sql`least(${schema.atis.firstSeen}, ${row.firstSeen})`,
        lastSeen: sql`greatest(${schema.atis.lastSeen}, ${row.lastSeen})`,
        sightings: sql`${schema.atis.sightings} + ${row.sightings}`,
        text: sql`case when ${better} then ${row.text} else ${schema.atis.text} end`,
        decoded: sql`case when ${better} then ${JSON.stringify(row.decoded)}::jsonb else ${schema.atis.decoded} end`,
        truncated: sql`case when ${better} then ${row.truncated} else ${schema.atis.truncated} end`,
      })
      .where(eq(schema.atis.key, m.key));
  }
  return { newAtis, updatedAtis: merged.length - newAtis };
}

async function prune(now: Date) {
  const d = db();
  const day = 86_400_000;
  await d.delete(schema.rawMessages).where(lt(schema.rawMessages.receivedAt, new Date(now.getTime() - RAW_RETENTION_DAYS * day)));
  await d.delete(schema.atis).where(lt(schema.atis.lastSeen, new Date(now.getTime() - ATIS_RETENTION_DAYS * day)));
}
