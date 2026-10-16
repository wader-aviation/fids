import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fixtures from "./__fixtures__/messages.json";
import type { AirframesMessage } from "../airframes/client";
import { decodeMovement, nearest, upcoming } from "./decode";
import { arrivalsTo, departuresFrom, foldEvents, legStatus } from "./legs";
import type { FlightLeg, MovementEvent } from "./types";

const msgs = fixtures as unknown as AirframesMessage[];
const find = (re: RegExp) => {
  const m = msgs.find((x) => re.test(x.text ?? ""));
  assert.ok(m, `fixture ${re}`);
  return m;
};

describe("time helpers", () => {
  const ref = new Date("2026-10-16T15:37:00Z");
  it("picks the nearest day", () => {
    assert.equal(nearest(15 * 3600 + 33 * 60, ref).toISOString(), "2026-10-16T15:33:00.000Z");
    assert.equal(nearest(23 * 3600 + 50 * 60, new Date("2026-10-17T00:10:00Z")).toISOString(), "2026-10-16T23:50:00.000Z");
  });
  it("puts an ETA in the future", () => {
    assert.equal(upcoming(16 * 3600 + 5 * 60, ref).toISOString(), "2026-10-16T16:05:00.000Z");
    assert.equal(upcoming(1 * 3600, ref).toISOString(), "2026-10-17T01:00:00.000Z");
  });
});

describe("decodeMovement", () => {
  it("reads an IN report", () => {
    const e = decodeMovement(find(/^KSFOCYYC1533/));
    assert.ok(e);
    assert.deepEqual([e.kind, e.origin, e.destination, e.at.toISOString().slice(11, 16)], ["in", "KSFO", "CYYC", "15:33"]);
  });
  it("reads an OUT report", () => {
    const e = decodeMovement(find(/^CYVRCYQR1537/));
    assert.deepEqual([e?.kind, e?.origin, e?.destination], ["out", "CYVR", "CYQR"]);
  });
  it("reads label 14 OFF EVENT", () => {
    const e = decodeMovement(find(/14 OFF EVENT\s+\/ KORD KSBA/));
    assert.deepEqual([e?.kind, e?.origin, e?.destination, e?.at.toISOString().slice(11, 19)], ["off", "KORD", "KSBA", "15:34:29"]);
  });
  it("reads label 80 OUTRP", () => {
    const e = decodeMovement(find(/OUTRP\s+0918\/16 CYYC\/CYEG/));
    assert.deepEqual([e?.kind, e?.origin, e?.destination, e?.tail], ["out", "CYYC", "CYEG", "C-FFPA"]);
  });
  it("reads a position with route, ETA and runway", () => {
    const e = decodeMovement(find(/^LDR01,189,D,SWA/));
    assert.deepEqual([e?.kind, e?.origin, e?.destination, e?.arrivalRunway], ["pos", "KDAL", "KFLL", "10L"]);
    assert.ok(e?.position);
  });
  it("drops replayed OOOI messages", () => {
    assert.equal(decodeMovement(find(/^SBGRSBVT0158/)), null); // OFF 01:58 received 15:37
    assert.equal(decodeMovement(find(/14 OFF EVENT\s+\/ KSFO KLAX 14 015521/)), null);
  });
  it("drops replayed position reports", () => {
    assert.equal(decodeMovement(find(/^132336,114760/)), null);
  });
});

const ev = (p: Omit<Partial<MovementEvent>, "at"> & { at: string; kind: MovementEvent["kind"] }): MovementEvent => ({
  msgId: 1,
  tail: "N1",
  receivedAt: new Date(p.at),
  ...p,
  at: new Date(p.at),
});

describe("legs", () => {
  it("carries the route to later messages and follows OOOI", () => {
    const current = new Map<string, FlightLeg>();
    const legs = foldEvents(current, [
      ev({ kind: "out", at: "2026-10-16T10:00:00Z", origin: "KBOS", destination: "KPHL", flight: "AA1" }),
      ev({ kind: "off", at: "2026-10-16T10:12:00Z" }),
      ev({ kind: "pos", at: "2026-10-16T10:40:00Z", eta: new Date("2026-10-16T11:05:00Z"), position: { lat: 40, lon: -74, altFt: 20000 } }),
      ev({ kind: "on", at: "2026-10-16T11:02:00Z" }),
      ev({ kind: "in", at: "2026-10-16T11:09:00Z" }),
    ]);
    assert.equal(legs.length, 1);
    const l = legs[0];
    assert.deepEqual([l.origin, l.destination, l.flight, legStatus(l)], ["KBOS", "KPHL", "AA1", "at-gate"]);
    assert.equal(l.offAt, "2026-10-16T10:12:00.000Z");
    assert.equal(l.eta, "2026-10-16T11:05:00.000Z");
  });

  it("starts a new leg on the next OUT", () => {
    const current = new Map<string, FlightLeg>();
    foldEvents(current, [
      ev({ kind: "off", at: "2026-10-16T10:12:00Z", origin: "KBOS", destination: "KPHL" }),
      ev({ kind: "in", at: "2026-10-16T11:09:00Z" }),
    ]);
    const next = foldEvents(current, [ev({ kind: "out", at: "2026-10-16T12:00:00Z", origin: "KPHL", destination: "KMIA" })]);
    assert.equal(next.length, 1);
    assert.deepEqual([next[0].origin, next[0].destination, legStatus(next[0])], ["KPHL", "KMIA", "taxi-out"]);
  });

  it("ignores a repeated OFF after landing", () => {
    const current = new Map<string, FlightLeg>();
    const legs = foldEvents(current, [
      ev({ kind: "off", at: "2026-10-16T10:12:00Z", origin: "KBOS", destination: "KPHL" }),
      ev({ kind: "on", at: "2026-10-16T11:02:00Z" }),
      ev({ kind: "off", at: "2026-10-16T10:12:00Z", receivedAt: new Date("2026-10-16T11:10:00Z") }),
    ]);
    assert.equal(new Set(legs.map((l) => l.key)).size, 1);
  });

  it("builds departure and arrival lists", () => {
    const current = new Map<string, FlightLeg>();
    const legs = foldEvents(current, [
      ev({ tail: "A", kind: "off", at: "2026-10-16T10:00:00Z", origin: "KBOS", destination: "KPHL" }),
      ev({ tail: "B", kind: "pos", at: "2026-10-16T10:30:00Z", origin: "KMIA", destination: "KBOS", eta: new Date("2026-10-16T11:30:00Z") }),
      ev({ tail: "C", kind: "on", at: "2026-10-16T10:20:00Z", origin: "KJFK", destination: "KBOS" }),
    ]);
    const w = { now: new Date("2026-10-16T10:45:00Z"), pastMs: 3 * 3_600_000 };
    assert.deepEqual(departuresFrom(legs, "KBOS", w).map((l) => l.tail), ["A"]);
    assert.deepEqual(arrivalsTo(legs, "KBOS", w).map((l) => l.tail), ["B", "C"]);
  });
});
