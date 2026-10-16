import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { rowToLeg } from "@/lib/movements/rows";
import { db, schema } from "@/db";
import type { AtisRecord, AtisSource } from "./types";

type Row = typeof schema.atis.$inferSelect;

const toRecord = (r: Row): AtisRecord => ({
  ...r,
  type: r.type as AtisRecord["type"],
  issuedAt: r.issuedAt.toISOString(),
  firstSeen: r.firstSeen.toISOString(),
  lastSeen: r.lastSeen.toISOString(),
});

export const dbSource: AtisSource = {
  kind: "database",

  async latest(icaos, maxAgeMin) {
    const since = new Date(Date.now() - maxAgeMin * 60_000);
    const where = icaos
      ? and(gte(schema.atis.lastSeen, since), inArray(schema.atis.icao, icaos))
      : gte(schema.atis.lastSeen, since);
    const rows = await db()
      .selectDistinctOn([schema.atis.icao, schema.atis.type])
      .from(schema.atis)
      .where(where)
      .orderBy(schema.atis.icao, schema.atis.type, desc(schema.atis.issuedAt));
    return rows.map(toRecord);
  },

  async issues(icaos, hours) {
    const t = schema.atis;
    const since = new Date(Date.now() - hours * 3_600_000);
    const fp = sql<string>`regexp_replace(array_to_string(array(select jsonb_array_elements_text(${t.decoded}->'lines')), ' '), '[^A-Z0-9]', '', 'g')`;
    const rows = await db()
      .select({ icao: t.icao, type: t.type, letter: t.letter, issuedAt: t.issuedAt, fingerprint: fp })
      .from(t)
      .where(and(gte(t.issuedAt, since), inArray(t.type, ["ARR", "DEP"]), icaos ? inArray(t.icao, icaos) : undefined));
    return rows.map((r) => ({ ...r, type: r.type as AtisRecord["type"], issuedAt: r.issuedAt.toISOString() }));
  },

  async legs(icaos, sinceMs) {
    const since = new Date(Date.now() - sinceMs);
    const t = schema.flightLegs;
    const where = icaos
      ? and(gte(t.lastSeen, since), or(inArray(t.origin, icaos), inArray(t.destination, icaos)))
      : gte(t.lastSeen, since);
    return (await db().select().from(t).where(where)).map(rowToLeg);
  },

  async legsFor(by) {
    const t = schema.flightLegs;
    const where = by.tail ? eq(t.tail, by.tail) : by.flight ? eq(t.flight, by.flight) : undefined;
    if (!where) return [];
    return (await db().select().from(t).where(where).orderBy(desc(t.firstSeen)).limit(50)).map(rowToLeg);
  },

  async history(icao, hours) {
    const since = new Date(Date.now() - hours * 3_600_000);
    const rows = await db()
      .select()
      .from(schema.atis)
      .where(and(eq(schema.atis.icao, icao), gte(schema.atis.issuedAt, since)))
      .orderBy(desc(schema.atis.issuedAt), sql`${schema.atis.type}`);
    return rows.map(toRecord);
  },
};
