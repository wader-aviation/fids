import type { AtisHeader, AtisType } from "./types";

// A9 / HX:  "/ATSO1XA.TI2/KSEA ARR ATIS D"  ·  "/MADAAYA.TI2/LEMD ATIS ARR J 0830Z"  ·  "/ATSPTXA.TI2/PHL  ARR ATIS B"
// RA:       "QUWXRO1XA.7-KORD DEP ATIS X"
const PREFIX = /(?:\/[A-Z0-9]{7}\.TI2\/|^QU[A-Z0-9]*\.\d-)/m;
const BODY =
  /^([A-Z]{4}|[A-Z]{3}(?= ))\s+(?:(ARR|DEP)(?:\/(DEP))?\s+)?(?:ARR-|DEP-)?ATIS\s+(?:(ARR|DEP)\s+)?(?:INFO\s+)?([A-Z])\b(?:\s+(\d{4})Z)?/;

/** Returns null when the message is not an ATIS header (e.g. a continuation block). */
export function parseHeader(text: string): AtisHeader | null {
  const prefix = PREFIX.exec(text);
  if (!prefix) return null;
  const start = prefix.index + prefix[0].length;
  const m = BODY.exec(text.slice(start));
  if (!m) return null;

  const [, rawCode, typeA, typeA2, typeB, letter, issued] = m;
  // US ATIS often uses the 3-letter FAA code ("PHL ", "CLT ").
  const icao = rawCode.length === 3 ? `K${rawCode}` : rawCode;

  let type: AtisType = "ARR/DEP";
  if (typeA2) type = "ARR/DEP";
  else if (typeA || typeB) type = (typeA ?? typeB) as AtisType;

  return { icao, type, letter, issued, bodyStart: start + m[0].length };
}
