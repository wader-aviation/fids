import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dedupeIssues, hasSeparateAtis as hasSeparate, toIssue } from "./merge-atis";
import type { AtisRecord } from "./types";

const rec = (type: AtisRecord["type"], letter: string, issuedAt: string, lines: string[], extra: Partial<AtisRecord> = {}): AtisRecord =>
  ({
    key: `X|${type}|${letter}|${issuedAt}`,
    icao: "SBGR",
    type,
    letter,
    issuedAt,
    firstSeen: issuedAt,
    lastSeen: issuedAt,
    sightings: 1,
    truncated: false,
    text: lines.join("\n"),
    decoded: { lines } as AtisRecord["decoded"],
    prevKey: null,
    diff: null,
    ...extra,
  }) as AtisRecord;

const hasSeparateAtis = (h: AtisRecord[]) => hasSeparate(h.map(toIssue));

describe("hasSeparateAtis", () => {
  it("treats ARR and DEP copies of one broadcast as one ATIS (SBGR)", () => {
    const h = [
      rec("ARR", "K", "2026-10-16T20:43:00Z", ["ATIS K", "EXP ILS Q CAT I RWY 10R/ LDG 10R DEP 10L IN USE", "TWY P CLSD BTN RWY 10L AND TWY A"]),
      rec("DEP", "K", "2026-10-16T20:43:00Z", ["ATIS K", "EXP ILS Q CAT I RWY 10R/ LDG", "10R DEP 10L IN USE", "TWY P CLSD BTN RWY 10L AND TWY", "A"]),
      rec("ARR", "M", "2026-10-16T21:21:00Z", ["ATIS M", "EXP ILS"]),
    ];
    assert.equal(hasSeparateAtis(h), false);
  });
  it("accepts a cut copy as the same text", () => {
    const h = [rec("ARR", "K", "2026-10-16T20:43:00Z", ["A B C D"]), rec("DEP", "K", "2026-10-16T20:43:00Z", ["A B"])];
    assert.equal(hasSeparateAtis(h), false);
  });
  it("splits when ARR and DEP differ at the same time", () => {
    const h = [
      rec("ARR", "W", "2026-10-16T21:51:00Z", ["ARRIVALS EXPECT ILS RWY 13L"]),
      rec("DEP", "W", "2026-10-16T21:51:00Z", ["DEPG RWY 13R"]),
    ];
    assert.equal(hasSeparateAtis(h), true);
    assert.equal(hasSeparateAtis([rec("ARR", "A", "2026-10-16T21:51:00Z", ["X"]), rec("DEP", "B", "2026-10-16T21:52:00Z", ["X"])]), true);
  });
});

describe("dedupeIssues", () => {
  it("keeps one record per letter and time, the complete one", () => {
    const out = dedupeIssues([
      rec("ARR", "K", "2026-10-16T20:43:00Z", ["A B"], { truncated: true, sightings: 2 }),
      rec("DEP", "K", "2026-10-16T20:43:00Z", ["A B C"], { sightings: 3 }),
      rec("ARR", "M", "2026-10-16T21:21:00Z", ["M"]),
    ]);
    assert.deepEqual(out.map((r) => [r.letter, r.sightings, r.truncated]), [["M", 1, false], ["K", 5, false]]);
  });
});
