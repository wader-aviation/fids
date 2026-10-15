import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fixtures from "./__fixtures__/messages.json";
import { decodeAtis, windComponents, flightCategory } from "./index";
import { diffAtis } from "./diff";
import { stripChecksum } from "./normalize";
import { readRunwayList } from "./body";

const byIcao = (icao: string) => {
  const m = fixtures.samples.find((s) => s.text.includes(`TI2/${icao}`));
  assert.ok(m, `fixture for ${icao}`);
  const d = decodeAtis(m.text);
  assert.ok(d, `decodes ${icao}`);
  return d;
};

describe("header", () => {
  it("reads A9 header with type before ATIS", () => {
    const d = byIcao("KSEA");
    assert.deepEqual([d.icao, d.type, d.letter, d.issued], ["KSEA", "DEP", "D", "1953"]);
  });
  it("reads type after ATIS and issue time on the header line", () => {
    const d = byIcao("LEMD");
    assert.deepEqual([d.icao, d.type, d.letter, d.issued], ["LEMD", "ARR", "T", "1950"]);
  });
  it("maps a 3-letter FAA code to ICAO", () => {
    const d = byIcao("PHL ");
    assert.equal(d.icao, "KPHL");
  });
  it("reads the RA printer form", () => {
    const d = decodeAtis(fixtures.printer[0].text);
    assert.ok(d);
    assert.match(d.icao, /^[A-Z]{4}$/);
  });
  it("returns null for a continuation block", () => {
    assert.equal(decodeAtis(fixtures.multipart[1].text), null);
  });
});

describe("checksum", () => {
  it("drops a checksum on its own line", () => {
    assert.deepEqual(stripChecksum("CONFIRM ATIS ARR T\n5617"), { text: "CONFIRM ATIS ARR T", hadChecksum: true });
  });
  it("drops a checksum glued after INFO letter", () => {
    assert.equal(stripChecksum("YOU HAVE INFO B.EA8D").text, "YOU HAVE INFO B.");
    assert.equal(stripChecksum("HAVE ATIS INFO Z42BE").text, "HAVE ATIS INFO Z");
  });
  it("drops a checksum glued to the QNH", () => {
    assert.equal(stripChecksum("QNH: 103058C9").text, "QNH: 1030");
  });
  it("keeps a real altimeter at the end of a cut message", () => {
    assert.equal(stripChecksum("BKN250 20/10 A3016").hadChecksum, false);
  });
});

describe("weather", () => {
  it("decodes a US METAR-style body", () => {
    const d = byIcao("KSEA");
    assert.deepEqual(d.wind, { direction: 330, speedKt: 4 });
    assert.equal(d.visibility?.meters, 16093);
    assert.equal(d.temperatureC, 16);
    assert.equal(d.dewpointC, 11);
    assert.equal(d.qnh?.inHg, 30.38);
  });
  it("decodes plain-language wind with variable sector and CAVOK", () => {
    const d = byIcao("LEMD");
    assert.deepEqual(d.wind, { direction: null, speedKt: 1, variableFrom: 100, variableTo: 210 });
    assert.equal(d.visibility?.cavok, true);
    assert.equal(d.qnh?.hpa, 1024);
    assert.equal(d.transitionLevel, "FL140");
  });
  it("converts MPS and negative dew point", () => {
    const d = byIcao("ZBAD");
    assert.equal(d.wind?.speedKt, 6);
    assert.equal(d.wind?.variableFrom, 190);
    assert.equal(d.dewpointC, -2);
  });
  it("reads gusts and clouds in feet with 5 digits", () => {
    const d = byIcao("LTFM");
    assert.deepEqual(d.wind, { direction: 360, speedKt: 35, gustKt: 45 });
    assert.equal(d.ceilingFt, 400);
    assert.equal(d.visibility?.meters, 4000);
  });
  it("reads China TRL in metres", () => {
    assert.equal(byIcao("ZSNJ").transitionLevel, "3600 M");
  });
  it("reads RWYCC as the lowest code", () => {
    assert.equal(byIcao("LTBS").rwycc, 5);
  });
});

describe("runways", () => {
  it("splits arrival and departure runways", () => {
    const d = byIcao("KDCA");
    assert.deepEqual(d.arrivalRunways, ["19"]);
    assert.deepEqual(d.departureRunways, ["19", "15"]);
  });
  it("handles 'RWY 33 RIGHT FOR DEP AND RWY 33 LEFT FOR ARR'", () => {
    const d = byIcao("OERK");
    assert.deepEqual(d.arrivalRunways, ["33L"]);
    assert.deepEqual(d.departureRunways, ["33R"]);
  });
  it("handles 'RWY: 16L AND R FOR ARRS AND DEPS'", () => {
    const d = byIcao("YSSY");
    assert.deepEqual(d.departureRunways, ["16L", "16R"]);
  });
  it("uses RWY IN USE for an ARR ATIS", () => {
    assert.deepEqual(byIcao("LEMD").arrivalRunways, ["32L", "32R"]);
  });
  it("reads approaches with variant letters", () => {
    const d = byIcao("RJTT");
    assert.ok(d.approaches.some((a) => a.type === "ILS Z" && a.runways.includes("34L")));
    assert.deepEqual(d.departureRunways, ["05", "34R"]);
  });
  it("reads runway lists", () => {
    assert.deepEqual(readRunwayList("24L AND 24R AND VFR 24L DEP"), ["24L", "24R"]);
    assert.deepEqual(readRunwayList("34L/34R"), ["34L", "34R"]);
    assert.deepEqual(readRunwayList("9R AND RWY 17 IN USE"), ["09R", "17"]);
  });
});

describe("flags", () => {
  const ids = (icao: string) => byIcao(icao).flags.map((f) => f.id);
  it("flags closed runway, navaid out, cranes", () => {
    const f = ids("KDCA");
    for (const id of ["rwy_closed", "navaid_us", "cranes", "birds"]) assert.ok(f.includes(id), id);
  });
  it("does not flag a clean ATIS", () => {
    assert.deepEqual(ids("ZWWW"), []);
  });
});

describe("ops", () => {
  it("computes crosswind and tailwind", () => {
    assert.deepEqual(windComponents({ direction: 360, speedKt: 35, gustKt: 45 }, "34L"), {
      runway: "34L",
      headwindKt: 33,
      crosswindKt: 12,
      gustCrosswindKt: 15,
    });
    assert.equal(windComponents({ direction: 180, speedKt: 10 }, "36")?.headwindKt, -10);
    assert.equal(windComponents({ direction: null, speedKt: 3 }, "36"), undefined);
  });
  it("computes flight category", () => {
    assert.equal(flightCategory(400, { meters: 4000 }), "LIFR");
    assert.equal(flightCategory(900, { meters: 10000 }), "IFR");
    assert.equal(flightCategory(undefined, { meters: 8000 }), "MVFR");
    assert.equal(flightCategory(5000, { meters: 10000 }), "VFR");
  });
});

describe("diff", () => {
  it("lists runway and sentence changes", () => {
    const a = byIcao("LEMD");
    const b = { ...a, letter: "U", arrivalRunways: ["18L", "18R"], lines: [...a.lines, "RWY 14L CLSD."] };
    const diff = diffAtis(a, b);
    assert.deepEqual(diff.changes.map((c) => c.field), ["letter", "arrivalRunways"]);
    assert.ok(diff.added.includes("RWY 14L CLSD"));
  });
});
