import type { schema } from "@/db";
import type { FlightLeg } from "./types";

type Row = typeof schema.flightLegs.$inferSelect;
type Insert = typeof schema.flightLegs.$inferInsert;

const d = (s: string | null) => (s ? new Date(s) : null);
const s = (x: Date | null) => (x ? x.toISOString() : null);

export function legToRow(l: FlightLeg): Insert {
  return {
    ...l,
    outAt: d(l.outAt),
    offAt: d(l.offAt),
    onAt: d(l.onAt),
    inAt: d(l.inAt),
    eta: d(l.eta),
    lastAltFt: l.lastAltFt === null ? null : Math.round(l.lastAltFt),
    firstSeen: new Date(l.firstSeen),
    lastSeen: new Date(l.lastSeen),
  };
}

export function rowToLeg(r: Row): FlightLeg {
  return {
    ...r,
    outAt: s(r.outAt),
    offAt: s(r.offAt),
    onAt: s(r.onAt),
    inAt: s(r.inAt),
    eta: s(r.eta),
    firstSeen: r.firstSeen.toISOString(),
    lastSeen: r.lastSeen.toISOString(),
  };
}
