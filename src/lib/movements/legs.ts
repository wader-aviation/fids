import type { FlightLeg, LegStatus, MovementEvent } from "./types";

const MIN = 60_000;
const HOUR = 60 * MIN;
/** A leg with no news for this long is finished. */
export const LEG_IDLE_MS = 18 * HOUR;
/** After landing, wait this long for an IN before closing. */
const AFTER_ON_MS = 2 * HOUR;
/** OOOI repeats within this window are the same event. */
const SAME_EVENT_MS = 5 * MIN;

const iso = (d: Date) => d.toISOString();
const t = (s: string | null) => (s ? new Date(s).getTime() : null);

export function newLeg(e: MovementEvent): FlightLeg {
  return {
    key: `${e.tail}|${iso(e.receivedAt).slice(0, 16)}`,
    tail: e.tail,
    flight: null,
    origin: null,
    destination: null,
    outAt: null,
    offAt: null,
    onAt: null,
    inAt: null,
    eta: null,
    arrivalRunway: null,
    lastLat: null,
    lastLon: null,
    lastAltFt: null,
    firstSeen: iso(e.receivedAt),
    lastSeen: iso(e.receivedAt),
  };
}

const OOOI = { out: "outAt", off: "offAt", on: "onAt", in: "inAt" } as const;

/** True when the event cannot belong to the aircraft's current leg. */
export function startsNewLeg(leg: FlightLeg, e: MovementEvent): boolean {
  const now = e.receivedAt.getTime();
  if (now - t(leg.lastSeen)! > LEG_IDLE_MS) return true;

  // A repeat of an OOOI event we already have is not news.
  if (e.kind !== "pos") {
    const have = t(leg[OOOI[e.kind]]);
    if (have !== null && Math.abs(have - e.at.getTime()) < SAME_EVENT_MS) return false;
  }
  if (e.origin && e.destination && leg.origin && leg.destination && (e.origin !== leg.origin || e.destination !== leg.destination)) {
    return true;
  }
  const inAt = t(leg.inAt);
  if (inAt !== null && e.at.getTime() > inAt + 15 * MIN) return true;
  const onAt = t(leg.onAt);
  if (onAt !== null && (e.kind === "out" || e.kind === "off" || now > onAt + AFTER_ON_MS)) return true;
  if (e.kind === "out" && leg.offAt) return true;
  return false;
}

/** Applies an event to a leg in place. First OOOI time wins; ETA and position follow the latest message. */
export function applyEvent(leg: FlightLeg, e: MovementEvent): void {
  if (e.flight) leg.flight = e.flight;
  if (e.origin && !leg.origin) leg.origin = e.origin;
  if (e.destination && !leg.destination) leg.destination = e.destination;
  if (e.kind !== "pos" && !leg[OOOI[e.kind]]) leg[OOOI[e.kind]] = iso(e.at);
  if (e.eta && !leg.onAt) leg.eta = iso(e.eta);
  if (e.arrivalRunway) leg.arrivalRunway = e.arrivalRunway;
  if (e.position && iso(e.receivedAt) >= leg.lastSeen) {
    leg.lastLat = e.position.lat;
    leg.lastLon = e.position.lon;
    if (e.position.altFt !== undefined) leg.lastAltFt = e.position.altFt;
  }
  if (iso(e.receivedAt) > leg.lastSeen) leg.lastSeen = iso(e.receivedAt);
}

/**
 * Folds events (any order) into legs. `current` holds each tail's most recent leg, if known.
 * Returns every leg that was created or changed.
 */
export function foldEvents(current: Map<string, FlightLeg>, events: MovementEvent[]): FlightLeg[] {
  const changed = new Map<string, FlightLeg>();
  const sorted = [...events].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime() || a.msgId - b.msgId);
  for (const e of sorted) {
    let leg = current.get(e.tail);
    if (!leg || startsNewLeg(leg, e)) {
      leg = newLeg(e);
      current.set(e.tail, leg);
    }
    applyEvent(leg, e);
    changed.set(leg.key, leg);
  }
  return [...changed.values()];
}

export function legStatus(leg: FlightLeg): LegStatus {
  if (leg.inAt) return "at-gate";
  if (leg.onAt) return "landed";
  if (leg.offAt) return "airborne";
  if (leg.outAt) return "taxi-out";
  if ((leg.lastAltFt ?? 0) > 1000 || leg.eta) return "en-route";
  return "unknown";
}

export interface BoardWindow {
  now: Date;
  /** How far back finished movements are shown. */
  pastMs: number;
}

const within = (s: string | null, now: number, pastMs: number) => s !== null && now - new Date(s).getTime() <= pastMs;

/** Departures from `icao`: left in the window, or still on the ground / just airborne. */
export function departuresFrom(legs: FlightLeg[], icao: string, w: BoardWindow): FlightLeg[] {
  const now = w.now.getTime();
  return legs
    .filter((l) => l.origin === icao)
    .filter((l) => within(l.offAt ?? l.outAt, now, w.pastMs) || (!l.offAt && !l.onAt && within(l.lastSeen, now, HOUR)))
    .sort((a, b) => (b.offAt ?? b.outAt ?? b.firstSeen).localeCompare(a.offAt ?? a.outAt ?? a.firstSeen));
}

/** Arrivals to `icao`: landed in the window, or inbound and heard recently. */
export function arrivalsTo(legs: FlightLeg[], icao: string, w: BoardWindow): FlightLeg[] {
  const now = w.now.getTime();
  return legs
    .filter((l) => l.destination === icao)
    .filter((l) => {
      if (l.onAt || l.inAt) return within(l.onAt ?? l.inAt, now, w.pastMs);
      if (!within(l.lastSeen, now, 2 * HOUR)) return false;
      return !l.eta || new Date(l.eta).getTime() > now - HOUR;
    })
    .sort((a, b) => {
      // Inbound first by ETA, then landed newest first.
      const ka = a.onAt ?? a.inAt;
      const kb = b.onAt ?? b.inAt;
      if (!ka && !kb) return (a.eta ?? a.lastSeen).localeCompare(b.eta ?? b.lastSeen);
      if (!ka) return -1;
      if (!kb) return 1;
      return kb.localeCompare(ka);
    });
}
