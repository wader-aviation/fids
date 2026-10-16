import { MessageDecoder } from "@airframes/acars-decoder";
import type { AirframesMessage } from "@/lib/airframes/client";
import type { MovementEvent, MovementKind } from "./types";

/** ACARS labels that carry OOOI events or position reports with route/ETA. */
export const MOVEMENT_LABELS = ["QP", "QQ", "QR", "QS", "10", "11", "12", "14", "15", "16", "20", "21", "22", "44", "4A", "80"];

/** Old messages get replayed by some feeds. An event whose own time is this far from receipt is dropped. */
export const MAX_CLOCK_SKEW_MS = 30 * 60_000;

const DAY = 86_400_000;
const MAX_ETA_AHEAD_MS = 16 * 3_600_000;
const ICAO = /^[A-Z]{4}$/;

let decoder: MessageDecoder | null = null;

/** Seconds-of-day → the date closest to `ref` (yesterday, today or tomorrow). */
export function nearest(secondsOfDay: number, ref: Date): Date {
  const midnight = Math.floor(ref.getTime() / DAY) * DAY;
  const options = [-DAY, 0, DAY].map((o) => midnight + o + secondsOfDay * 1000);
  return new Date(options.reduce((a, b) => (Math.abs(b - ref.getTime()) < Math.abs(a - ref.getTime()) ? b : a)));
}

/** ETA seconds-of-day → the next occurrence after `ref` minus 1h (ETAs can be slightly past). */
export function upcoming(secondsOfDay: number, ref: Date): Date {
  const midnight = Math.floor(ref.getTime() / DAY) * DAY;
  let t = midnight + secondsOfDay * 1000;
  while (t < ref.getTime() - 3_600_000) t += DAY;
  return new Date(t);
}

const hhmm = (s: string) => Number(s.slice(0, 2)) * 3600 + Number(s.slice(2, 4)) * 60;
const hhmmss = (s: string) => hhmm(s) + Number(s.slice(4, 6) || 0);

interface Extra {
  kind?: MovementKind;
  time?: number; // seconds of day
  eta?: number;
  reportTime?: number;
  origin?: string;
  destination?: string;
}

/** Formats the decoder library does not read (yet). */
function extra(label: string, text: string): Extra {
  // Label 14: "/14 OFF EVENT / KORD KSBA 16 153429/TIME 1534"
  const ev = /\/14 (OUT|OFF|ON|IN) EVENT\s*\/\s*([A-Z]{4}) ([A-Z]{4}) \d{2} (\d{6})/.exec(text);
  if (ev) {
    return { kind: ev[1].toLowerCase() as MovementKind, time: hhmmss(ev[4]), origin: ev[2], destination: ev[3] };
  }
  if (label === "80") {
    // "1001 OUTRP 0918/16 CYYC/CYEG .C-FFPA /OUT 1536", "OFFRP ... /OFF 1540", "ETA ... /ETA 1642"
    const out: Extra = {};
    const route = /\/\d{2}\s+([A-Z]{4})\/([A-Z]{4})\s/.exec(text);
    if (route) Object.assign(out, { origin: route[1], destination: route[2] });
    const kind = /\b(OUT|OFF|ON|IN)RP\b/.exec(text)?.[1];
    const time = kind && new RegExp(`/${kind} (\\d{4})`).exec(text)?.[1];
    if (kind && time) Object.assign(out, { kind: kind.toLowerCase(), time: hhmm(time) });
    const eta = /\/ETA (\d{4})/.exec(text)?.[1];
    if (eta) out.eta = hhmm(eta);
    const utc = /\/UTC (\d{6})/.exec(text)?.[1];
    if (utc) out.reportTime = hhmmss(utc);
    return out;
  }
  return {};
}

/**
 * Turns one ACARS message into a movement event, or null when it has nothing useful,
 * has no tail, or is an old message being replayed.
 */
export function decodeMovement(msg: AirframesMessage): MovementEvent | null {
  if (!msg.text || !msg.tail || !msg.label || msg.error) return null;
  decoder ??= new MessageDecoder();
  let raw: Record<string, unknown> = {};
  try {
    const r = decoder.decode({ label: msg.label, text: msg.text });
    if (r?.decoded) raw = r.raw as Record<string, unknown>;
  } catch {
    // keep going with our own parsing
  }
  const x = extra(msg.label, msg.text);
  const receivedAt = new Date(msg.timestamp);

  let kind: MovementKind = "pos";
  let time: number | undefined;
  for (const k of ["out", "off", "on", "in"] as const) {
    if (typeof raw[`${k}_time`] === "number") {
      kind = k;
      time = raw[`${k}_time`] as number;
    }
  }
  if (x.kind && x.time !== undefined) {
    kind = x.kind;
    time = x.time;
  }

  const reportTime = (raw.message_timestamp as number | undefined) ?? x.reportTime;
  const checkTime = time ?? reportTime;
  if (checkTime !== undefined && Math.abs(nearest(checkTime, receivedAt).getTime() - receivedAt.getTime()) > MAX_CLOCK_SKEW_MS) {
    return null; // replay
  }

  const origin = (raw.departure_icao as string | undefined) ?? x.origin;
  const destination = (raw.arrival_icao as string | undefined) ?? x.destination;
  const pos = raw.position as { latitude: number; longitude: number } | undefined;
  const etaSec = (raw.eta_time as number | undefined) ?? x.eta;

  const event: MovementEvent = {
    msgId: msg.id,
    tail: msg.tail.trim().replace(/^\./, ""),
    kind,
    at: time !== undefined ? nearest(time, receivedAt) : reportTime !== undefined ? nearest(reportTime, receivedAt) : receivedAt,
    receivedAt,
  };
  const flight = msg.flightNumber ?? (raw.flight_number as string | undefined);
  if (flight) event.flight = flight.trim();
  if (origin && ICAO.test(origin)) event.origin = origin;
  if (destination && ICAO.test(destination)) event.destination = destination;
  if (etaSec !== undefined && kind !== "on" && kind !== "in") {
    const eta = upcoming(etaSec, receivedAt);
    // Longest flights are ~19h; anything further out is a stale or misread ETA.
    if (eta.getTime() - receivedAt.getTime() <= MAX_ETA_AHEAD_MS) event.eta = eta;
  }
  if (typeof raw.arrival_runway === "string" && /^\d{2}[LRC]?$/.test(raw.arrival_runway)) event.arrivalRunway = raw.arrival_runway;
  if (pos && Number.isFinite(pos.latitude) && Number.isFinite(pos.longitude)) {
    event.position = { lat: pos.latitude, lon: pos.longitude, ...(typeof raw.altitude === "number" && { altFt: raw.altitude }) };
  }

  // A position report that tells us nothing about the route or ETA is still useful (keeps the leg alive),
  // but only if we know which flight; drop empty decodes.
  if (kind === "pos" && !event.origin && !event.destination && !event.eta && !event.position) return null;
  return event;
}
