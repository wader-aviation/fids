import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classify, isActive } from "./classify";
import { mapNmsFeature, parseNmsBody } from "./nms";

describe("classify", () => {
  it("uses the Q-code", () => {
    assert.deepEqual(classify("QMRLC", "RWY 04L/22R CLSD"), { group: "runway", severity: "warn", summary: "Runway closed" });
    assert.deepEqual(classify("QICAS", "ILS RWY 27 U/S"), { group: "navaid", severity: "warn", summary: "ILS out of service" });
    assert.deepEqual(classify("QMXLC", "TWY B CLSD"), { group: "taxiway", severity: "info", summary: "Taxiway closed" });
    assert.deepEqual(classify("QOBCE", "CRANE ERECTED"), { group: "obstacle", severity: "info", summary: "Obstacle" });
  });
  it("falls back to the text for US domestic NOTAMs", () => {
    assert.equal(classify(null, "!JFK 10/123 JFK RWY 13R/31L CLSD 2610161200-2610162000").summary, "Runway closed");
    assert.equal(classify(null, "!JFK 10/124 JFK NAV ILS RWY 22L GP OTS").summary, "ILS out of service");
    assert.equal(classify(null, "!JFK 10/125 JFK TWY F CLSD").group, "taxiway");
    assert.equal(classify(null, "SOMETHING ELSE").group, "other");
  });
});

describe("isActive", () => {
  const now = new Date("2026-10-16T12:00:00Z");
  it("checks the validity window", () => {
    assert.equal(isActive({ start: "2026-10-16T10:00:00.000Z", end: "2026-10-16T14:00:00.000Z" }, now), true);
    assert.equal(isActive({ start: "2026-10-16T13:00:00.000Z", end: null }, now), false);
    assert.equal(isActive({ start: null, end: null }, now), true);
  });
});

describe("mapNmsFeature", () => {
  const feature = (notam: Record<string, unknown>, translations?: Array<Record<string, unknown>>) => ({
    properties: { coreNOTAMData: { notam, notamTranslation: translations } },
  });
  it("maps an NMS GeoJSON feature", () => {
    const n = mapNmsFeature(
      feature(
        {
          id: "NOTAM_1",
          series: "A ",
          number: "1234",
          year: "2026",
          type: "N",
          icaoLocation: "LPPT ",
          selectionCode: "QMRLC",
          effectiveStart: "2026-10-16T22:00:00.000Z",
          effectiveEnd: "2026-10-17T05:00:00.000Z",
          estimated: "true",
          text: "RWY 02/20 CLSD DUE TO WIP",
        },
        [{ type: "ICAO", formattedText: "A1234/26 NOTAMN\nE) RWY 02/20 CLSD DUE TO WIP" }],
      ),
    );
    assert.ok(n);
    assert.deepEqual([n.id, n.location, n.qcode, n.summary, n.estimatedEnd], ["A1234/26", "LPPT", "QMRLC", "Runway closed", true]);
    assert.match(n.text, /^A1234\/26 NOTAMN/);
  });
  it("does not repeat the series letter", () => {
    assert.equal(mapNmsFeature(feature({ series: "A", number: "A8258", year: "2026", text: "x" }))?.id, "A8258/26");
  });
  it("treats PERM as no end", () => {
    const n = mapNmsFeature(feature({ number: "10/123", text: "TWY F CLSD", effectiveEnd: "PERM", location: "JFK" }));
    assert.equal(n?.end, null);
    assert.equal(n?.id, "10/123");
  });
  it("skips cancellations and empty features", () => {
    assert.equal(mapNmsFeature(feature({ number: "1", type: "C", text: "x" })), null);
    assert.equal(mapNmsFeature({}), null);
  });
});

describe("parseNmsBody", () => {
  it("never turns a throttle into an empty list", () => {
    assert.throws(() => parseNmsBody(200, '{"fault":{"faultstring":"Spike arrest violation"}}'));
    assert.throws(() => parseNmsBody(429, ""));
    assert.throws(() => parseNmsBody(200, "{}"));
  });
  it("accepts a success envelope", () => {
    assert.deepEqual(parseNmsBody(200, '{"status":"Success","data":{"geojson":[]}}').data, { geojson: [] });
  });
});
