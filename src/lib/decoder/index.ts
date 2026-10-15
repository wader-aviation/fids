import {
  ceilingFrom,
  parseApproaches,
  parseClouds,
  parseIssued,
  parseIssuedDay,
  parseQnh,
  parseRunways,
  parseRwycc,
  parseTemperature,
  parseTransition,
  parseVisibility,
  parseWind,
} from "./body";
import { detectFlags } from "./flags";
import { parseHeader } from "./header";
import { flatten, normalizeText, stripChecksum } from "./normalize";
import { flightCategory } from "./ops";
import type { DecodedAtis } from "./types";

export * from "./types";
export { parseHeader } from "./header";
export { flightCategory, windComponents } from "./ops";

const END_MARKER = /\b(?:END OF (?:ATIS|INFORMATION)(?:\s+[A-Z])?|(?:YOU HAVE|ACK(?:NOWLEDGE)?|CONFIRM|ADVISE|ADZ|ADVS)\b[^.]*\b(?:INFO(?:RMATION)?|ATIS)\s+(?:ARR\s+|DEP\s+)?[A-Z]\.?)\s*$/;

/** Decodes one ACARS ATIS uplink. Returns null when the text has no ATIS header. */
export function decodeAtis(rawText: string): DecodedAtis | null {
  const { text, hadChecksum } = stripChecksum(normalizeText(rawText));
  const header = parseHeader(text);
  if (!header) return null;

  const body = text.slice(header.bodyStart).replace(/^[\s.]+/, "");
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  const flat = flatten(body);

  const clouds = parseClouds(flat);
  const ceilingFt = ceilingFrom(clouds);
  const visibility = parseVisibility(flat);
  const rwycc = parseRwycc(flat);
  const approaches = parseApproaches(flat);
  const runways = parseRunways(flat);

  const arrivalRunways = [...runways.arrival];
  const departureRunways = [...runways.departure];
  if (runways.inUse.length) {
    if (header.type !== "DEP" && !arrivalRunways.length) arrivalRunways.push(...runways.inUse);
    if (header.type !== "ARR" && !departureRunways.length) departureRunways.push(...runways.inUse);
  }
  if (!arrivalRunways.length && header.type !== "DEP") {
    approaches.flatMap((a) => a.runways).forEach((r) => !arrivalRunways.includes(r) && arrivalRunways.push(r));
  }

  const issued = header.issued ?? parseIssued(flat);
  return {
    icao: header.icao,
    type: header.type,
    letter: header.letter,
    issued,
    issuedDay: parseIssuedDay(lines.slice(0, 2).join(" "), issued),
    lines,
    wind: parseWind(flat),
    visibility,
    clouds,
    ceilingFt,
    ...parseTemperature(flat),
    qnh: parseQnh(flat),
    ...parseTransition(flat),
    approaches,
    arrivalRunways,
    departureRunways,
    rwycc,
    flightCategory: flightCategory(ceilingFt, visibility),
    flags: detectFlags(flat, rwycc),
    truncated: !hadChecksum && !END_MARKER.test(flat),
  };
}
