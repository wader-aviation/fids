import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
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
