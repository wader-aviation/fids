import type { AtisRecord } from "./types";

/** What the split check needs about one ATIS issue. */
export interface AtisIssue {
  icao: string;
  type: AtisRecord["type"];
  letter: string;
  issuedAt: string;
  /** Body letters and digits only (see `atisFingerprint`). */
  fingerprint: string;
}

/** Letters and digits only, so line breaks and spacing from different printers don't matter. */
export const atisFingerprint = (r: Pick<AtisRecord, "decoded">) => r.decoded.lines.join(" ").replace(/[^A-Z0-9]/g, "");

export const toIssue = (r: AtisRecord): AtisIssue => ({ icao: r.icao, type: r.type, letter: r.letter, issuedAt: r.issuedAt, fingerprint: atisFingerprint(r) });

/** Same ATIS when one text starts with the other (a cut copy of the same message counts as the same). */
function sameText(a: AtisIssue, b: AtisIssue) {
  const fa = a.fingerprint;
  const fb = b.fingerprint;
  const [short, long] = fa.length <= fb.length ? [fa, fb] : [fb, fa];
  return short.length > 0 && long.startsWith(short);
}

const PAIR_WINDOW_MS = 5 * 60_000;

/**
 * True when the airport really broadcasts separate arrival and departure ATIS.
 *
 * The "ARR"/"DEP" word in a D-ATIS uplink only says which one the pilot asked for; many airports
 * (e.g. SBGR) answer both with the same broadcast. So we only split when an ARR and a DEP issued
 * within 5 minutes of each other carry a different letter or different text.
 */
export function hasSeparateAtis(history: AtisIssue[]): boolean {
  const arr = history.filter((r) => r.type === "ARR");
  const dep = history.filter((r) => r.type === "DEP");
  for (const a of arr) {
    const ta = new Date(a.issuedAt).getTime();
    for (const d of dep) {
      if (Math.abs(new Date(d.issuedAt).getTime() - ta) > PAIR_WINDOW_MS) continue;
      if (a.letter !== d.letter || !sameText(a, d)) return true;
    }
  }
  return false;
}

/** Collapses ARR/DEP copies of the same broadcast into one record (the complete, longest copy). */
export function dedupeIssues(history: AtisRecord[]): AtisRecord[] {
  const byIssue = new Map<string, AtisRecord>();
  for (const r of history) {
    const k = `${r.letter}|${r.issuedAt}`;
    const cur = byIssue.get(k);
    if (!cur) {
      byIssue.set(k, r);
      continue;
    }
    const better = cur.truncated !== r.truncated ? !r.truncated : r.text.length > cur.text.length;
    const keep = better ? r : cur;
    byIssue.set(k, { ...keep, sightings: cur.sightings + r.sightings, type: "ARR/DEP" });
  }
  return [...byIssue.values()].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
}

/** Airports (from a mixed list of issues) that broadcast separate arrival and departure ATIS. */
export function splitAirports(issues: AtisIssue[]): Set<string> {
  const by = new Map<string, AtisIssue[]>();
  for (const i of issues) by.set(i.icao, [...(by.get(i.icao) ?? []), i]);
  return new Set([...by].filter(([, list]) => hasSeparateAtis(list)).map(([icao]) => icao));
}
