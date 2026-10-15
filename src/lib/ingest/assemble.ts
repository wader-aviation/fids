import type { AirframesMessage } from "@/lib/airframes/client";
import { decodeAtis, type DecodedAtis } from "@/lib/decoder";

export interface AtisCandidate {
  key: string;
  issuedAt: Date;
  receivedAt: Date;
  text: string;
  decoded: DecodedAtis;
  sourceIds: number[];
}

const STITCH_WINDOW_MS = 120_000;

/**
 * Builds the full issue time from "HHMM" and the receive time.
 * ATIS is issued before it is received, so a time that lands in the future belongs to the day before.
 */
export function issuedAtFrom(hhmm: string | undefined, receivedAt: Date): Date {
  if (!hhmm) return new Date(Math.floor(receivedAt.getTime() / 3_600_000) * 3_600_000);
  const d = new Date(receivedAt);
  d.setUTCHours(Number(hhmm.slice(0, 2)), Number(hhmm.slice(2, 4)), 0, 0);
  if (d.getTime() - receivedAt.getTime() > 60 * 60_000) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

export function atisKey(d: Pick<DecodedAtis, "icao" | "type" | "letter">, issuedAt: Date): string {
  return `${d.icao}|${d.type}|${d.letter}|${issuedAt.toISOString().slice(0, 16)}`;
}

const nextBlock = (a: string | null, b: string | null) =>
  !!a && !!b && a.length === 1 && b.length === 1 && b.charCodeAt(0) === a.charCodeAt(0) + 1;

/**
 * Turns raw messages (oldest first) into ATIS candidates.
 * Long ATIS are sent in several ACARS blocks; a block without a header is joined
 * to the previous block from the same aircraft when it follows within 2 minutes.
 */
export function assemble(messages: AirframesMessage[]): AtisCandidate[] {
  const out: AtisCandidate[] = [];
  const lastByTail = new Map<string, { msg: AirframesMessage; text: string; ids: number[] }>();

  for (const msg of messages) {
    if (!msg.text || msg.error) continue;
    const receivedAt = new Date(msg.timestamp);
    let text = msg.text;
    let ids = [msg.id];
    let decoded = decodeAtis(text);

    if (!decoded && msg.tail) {
      const prev = lastByTail.get(msg.tail);
      if (
        prev &&
        receivedAt.getTime() - new Date(prev.msg.timestamp).getTime() <= STITCH_WINDOW_MS &&
        nextBlock(prev.msg.blockId, msg.blockId)
      ) {
        text = `${prev.text}\n${msg.text}`;
        ids = [...prev.ids, msg.id];
        decoded = decodeAtis(text);
      }
    }
    if (!decoded) continue;

    if (msg.tail) lastByTail.set(msg.tail, { msg, text, ids });
    const issuedAt = issuedAtFrom(decoded.issued, receivedAt);
    out.push({ key: atisKey(decoded, issuedAt), issuedAt, receivedAt, text, decoded, sourceIds: ids });
  }
  return out;
}

/** Better = complete over cut, then more text. */
export function isBetter(a: { truncated: boolean; length: number }, b: { truncated: boolean; length: number }): boolean {
  if (a.truncated !== b.truncated) return !a.truncated;
  return a.length > b.length;
}

export interface MergedAtis {
  key: string;
  issuedAt: Date;
  firstSeen: Date;
  lastSeen: Date;
  sightings: number;
  text: string;
  decoded: DecodedAtis;
}

/** Collapses candidates with the same key into one record, keeping the best text. */
export function merge(candidates: AtisCandidate[]): MergedAtis[] {
  const byKey = new Map<string, MergedAtis>();
  for (const c of candidates) {
    const cur = byKey.get(c.key);
    if (!cur) {
      byKey.set(c.key, {
        key: c.key,
        issuedAt: c.issuedAt,
        firstSeen: c.receivedAt,
        lastSeen: c.receivedAt,
        sightings: 1,
        text: c.text,
        decoded: c.decoded,
      });
      continue;
    }
    cur.sightings++;
    if (c.receivedAt < cur.firstSeen) cur.firstSeen = c.receivedAt;
    if (c.receivedAt > cur.lastSeen) cur.lastSeen = c.receivedAt;
    if (isBetter({ truncated: c.decoded.truncated, length: c.text.length }, { truncated: cur.decoded.truncated, length: cur.text.length })) {
      cur.text = c.text;
      cur.decoded = c.decoded;
    }
  }
  return [...byKey.values()];
}
