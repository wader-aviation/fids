import type { DecodedAtis } from "./types";

export interface FieldChange {
  field: "letter" | "arrivalRunways" | "departureRunways" | "approaches" | "wind" | "qnh" | "visibility" | "ceiling" | "flags";
  from: string;
  to: string;
}

export interface AtisDiff {
  changes: FieldChange[];
  /** Sentences present only in the new ATIS. */
  added: string[];
  /** Sentences present only in the old ATIS. */
  removed: string[];
}

const fmtWind = (d: DecodedAtis) =>
  d.wind ? `${d.wind.direction === null ? "VRB" : String(d.wind.direction).padStart(3, "0")}/${d.wind.speedKt}${d.wind.gustKt ? `G${d.wind.gustKt}` : ""}KT` : "";

const SUMMARY: Array<[FieldChange["field"], (d: DecodedAtis) => string]> = [
  ["letter", (d) => d.letter],
  ["arrivalRunways", (d) => d.arrivalRunways.join(" ")],
  ["departureRunways", (d) => d.departureRunways.join(" ")],
  ["approaches", (d) => d.approaches.map((a) => `${a.type}${a.runways.length ? ` ${a.runways.join("/")}` : ""}`).join(", ")],
  ["wind", fmtWind],
  ["qnh", (d) => (d.qnh ? String(d.qnh.hpa) : "")],
  ["visibility", (d) => (d.visibility ? String(d.visibility.meters) : "")],
  ["ceiling", (d) => (d.ceilingFt !== undefined ? String(d.ceilingFt) : "")],
  ["flags", (d) => d.flags.map((f) => f.id).sort().join(" ")],
];

/**
 * US-style ATIS wrap lines mid-sentence and use periods; most others put one item per line
 * with few periods. Split on whichever the text uses.
 */
const sentences = (d: DecodedAtis) => {
  const joined = d.lines.join(" ");
  const periods = (joined.match(/\.(\s|$)/g) ?? []).length;
  const parts = periods >= d.lines.length / 3 ? joined.split(/\.(?:\s+|$)/) : d.lines;
  return parts.map((s) => s.replace(/\s+/g, " ").replace(/\.$/, "").trim()).filter((s) => s.length > 3);
};

export function diffAtis(prev: DecodedAtis, next: DecodedAtis): AtisDiff {
  const changes: FieldChange[] = [];
  for (const [field, get] of SUMMARY) {
    const from = get(prev);
    const to = get(next);
    if (from !== to) changes.push({ field, from, to });
  }
  const a = new Set(sentences(prev));
  const b = new Set(sentences(next));
  return {
    changes,
    added: [...b].filter((s) => !a.has(s)),
    removed: [...a].filter((s) => !b.has(s)),
  };
}
