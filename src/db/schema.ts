import { bigint, boolean, doublePrecision, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { AtisDiff } from "@/lib/decoder/diff";
import type { DecodedAtis } from "@/lib/decoder";

/** Every Airframes message we pulled. Kept 7 days so the decoder can be re-run. */
export const rawMessages = pgTable(
  "raw_messages",
  {
    id: bigint("id", { mode: "number" }).primaryKey(), // Airframes message id
    label: text("label"),
    tail: text("tail"),
    blockId: text("block_id"),
    sourceType: text("source_type"),
    stationId: integer("station_id"),
    text: text("text").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("raw_messages_received_at_idx").on(t.receivedAt)],
);

/** One row per ATIS issue (airport + type + letter + issue time). */
export const atis = pgTable(
  "atis",
  {
    key: text("key").primaryKey(),
    icao: text("icao").notNull(),
    type: text("type").notNull(), // ARR | DEP | ARR/DEP
    letter: text("letter").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull(),
    sightings: integer("sightings").notNull().default(1),
    truncated: boolean("truncated").notNull(),
    text: text("text").notNull(),
    decoded: jsonb("decoded").$type<DecodedAtis>().notNull(),
    prevKey: text("prev_key"),
    diff: jsonb("diff").$type<AtisDiff>(),
  },
  (t) => [index("atis_icao_issued_idx").on(t.icao, t.issuedAt), index("atis_last_seen_idx").on(t.lastSeen)],
);

export const ingestState = pgTable("ingest_state", {
  id: text("id").primaryKey(),
  lastId: bigint("last_id", { mode: "number" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

/** One flight leg of one aircraft, built from ACARS OOOI and position reports. Kept 3 days. */
export const flightLegs = pgTable(
  "flight_legs",
  {
    key: text("key").primaryKey(), // tail|first-seen minute
    tail: text("tail").notNull(),
    flight: text("flight"),
    origin: text("origin"),
    destination: text("destination"),
    outAt: timestamp("out_at", { withTimezone: true }),
    offAt: timestamp("off_at", { withTimezone: true }),
    onAt: timestamp("on_at", { withTimezone: true }),
    inAt: timestamp("in_at", { withTimezone: true }),
    eta: timestamp("eta", { withTimezone: true }),
    arrivalRunway: text("arrival_runway"),
    lastLat: doublePrecision("last_lat"),
    lastLon: doublePrecision("last_lon"),
    lastAltFt: integer("last_alt_ft"),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("flight_legs_tail_idx").on(t.tail, t.firstSeen),
    index("flight_legs_origin_idx").on(t.origin, t.lastSeen),
    index("flight_legs_destination_idx").on(t.destination, t.lastSeen),
  ],
);
