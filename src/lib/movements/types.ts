export type MovementKind = "out" | "off" | "on" | "in" | "pos";

/** One thing we learned about a flight from one ACARS message. */
export interface MovementEvent {
  msgId: number;
  tail: string;
  flight?: string;
  origin?: string;
  destination?: string;
  kind: MovementKind;
  /** When it happened (OOOI time, report time, or receive time). */
  at: Date;
  receivedAt: Date;
  eta?: Date;
  arrivalRunway?: string;
  position?: { lat: number; lon: number; altFt?: number };
}

/** One flight leg of one aircraft, built from many events. Dates are ISO strings. */
export interface FlightLeg {
  key: string;
  tail: string;
  flight: string | null;
  origin: string | null;
  destination: string | null;
  outAt: string | null;
  offAt: string | null;
  onAt: string | null;
  inAt: string | null;
  eta: string | null;
  arrivalRunway: string | null;
  lastLat: number | null;
  lastLon: number | null;
  lastAltFt: number | null;
  firstSeen: string;
  lastSeen: string;
}

export type LegStatus = "taxi-out" | "airborne" | "en-route" | "landed" | "at-gate" | "unknown";
