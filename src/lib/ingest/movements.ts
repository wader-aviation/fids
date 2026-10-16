import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { getTableColumns } from "drizzle-orm";
import { db, schema } from "@/db";
import { fetchMessagesSince } from "@/lib/airframes/client";
import { decodeMovement, MOVEMENT_LABELS } from "@/lib/movements/decode";
import { foldEvents, LEG_IDLE_MS } from "@/lib/movements/legs";
import { legToRow, rowToLeg } from "@/lib/movements/rows";
import type { FlightLeg } from "@/lib/movements/types";

const STATE_ID = "airframes-movements";
const SCAN_WINDOW_MS = 10 * 60_000;
const LEG_RETENTION_DAYS = 3;

export interface MovementIngestResult {
  fetched: number;
  events: number;
  legsChanged: number;
  complete: boolean;
}

export async function runMovementIngest(now = new Date()): Promise<MovementIngestResult> {
  const d = db();
  const state = await d.query.ingestState.findFirst({ where: eq(schema.ingestState.id, STATE_ID) });
  const since = new Date(now.getTime() - SCAN_WINDOW_MS).toISOString();
  const { messages, complete } = await fetchMessagesSince({ labels: MOVEMENT_LABELS, afterId: state?.lastId ?? 0, since, maxPages: 6 });
  if (!messages.length) return { fetched: 0, events: 0, legsChanged: 0, complete };

  const events = messages.map(decodeMovement).filter((e) => e !== null);
  let changed: FlightLeg[] = [];
  if (events.length) {
    // Each tail's most recent leg, so new messages continue it.
    const tails = [...new Set(events.map((e) => e.tail))];
    const rows = await d
      .selectDistinctOn([schema.flightLegs.tail])
      .from(schema.flightLegs)
      .where(and(inArray(schema.flightLegs.tail, tails), gte(schema.flightLegs.lastSeen, new Date(now.getTime() - LEG_IDLE_MS))))
      .orderBy(schema.flightLegs.tail, desc(schema.flightLegs.firstSeen));
    const current = new Map(rows.map((r) => [r.tail, rowToLeg(r)]));
    changed = foldEvents(current, events);

    const cols = getTableColumns(schema.flightLegs);
    const set = Object.fromEntries(
      Object.entries(cols)
        .filter(([k]) => k !== "key")
        .map(([k, c]) => [k, sql.raw(`excluded."${c.name}"`)]),
    );
    for (let i = 0; i < changed.length; i += 200) {
      await d
        .insert(schema.flightLegs)
        .values(changed.slice(i, i + 200).map(legToRow))
        .onConflictDoUpdate({ target: schema.flightLegs.key, set });
    }
  }

  const lastId = messages[messages.length - 1].id;
  await d
    .insert(schema.ingestState)
    .values({ id: STATE_ID, lastId, updatedAt: now })
    .onConflictDoUpdate({ target: schema.ingestState.id, set: { lastId, updatedAt: now } });

  if (now.getUTCMinutes() === 30) {
    await d.delete(schema.flightLegs).where(lt(schema.flightLegs.lastSeen, new Date(now.getTime() - LEG_RETENTION_DAYS * 86_400_000)));
  }
  return { fetched: messages.length, events: events.length, legsChanged: changed.length, complete };
}
