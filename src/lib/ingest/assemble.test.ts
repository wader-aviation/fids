import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fixtures from "../decoder/__fixtures__/messages.json";
import type { AirframesMessage } from "../airframes/client";
import { assemble, issuedAtFrom, merge } from "./assemble";

const msg = (m: { id: number; label: string; text: string; timestamp: string; tail: string; blockId: string }): AirframesMessage => ({
  ...m,
  error: 0,
  sourceType: "acars",
});

describe("issuedAtFrom", () => {
  it("uses the receive day", () => {
    assert.equal(issuedAtFrom("1953", new Date("2026-10-15T20:01:00Z")).toISOString(), "2026-10-15T19:53:00.000Z");
  });
  it("goes back a day across midnight", () => {
    assert.equal(issuedAtFrom("2350", new Date("2026-10-16T00:05:00Z")).toISOString(), "2026-10-15T23:50:00.000Z");
  });
});

describe("assemble", () => {
  it("joins a continuation block to its header block", () => {
    const [head, tail] = fixtures.multipart.map(msg);
    const out = assemble([head, tail]);
    assert.equal(out.length, 2);
    const joined = out[1];
    assert.deepEqual(joined.sourceIds, [head.id, tail.id]);
    assert.equal(joined.decoded.truncated, false);
    assert.equal(joined.decoded.qnh?.hpa, 1008);
  });

  it("does not join blocks from another aircraft", () => {
    const [head, tail] = fixtures.multipart.map(msg);
    assert.equal(assemble([head, { ...tail, tail: "OTHER" }]).length, 1);
  });

  it("merges repeats and keeps the complete text", () => {
    const [head, tail] = fixtures.multipart.map(msg);
    const merged = merge(assemble([head, tail]));
    assert.equal(merged.length, 1);
    assert.equal(merged[0].sightings, 2);
    assert.equal(merged[0].decoded.truncated, false);
    assert.equal(merged[0].key, "LTBS|ARR|N|2026-10-15T16:20");
  });
});
