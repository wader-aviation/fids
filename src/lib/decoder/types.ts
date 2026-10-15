export type AtisType = "ARR" | "DEP" | "ARR/DEP";

export interface AtisHeader {
  icao: string;
  type: AtisType;
  letter: string;
  /** "HHMM" UTC as written in the header, when present. */
  issued?: string;
  /** Offset in the normalized text where the body starts. */
  bodyStart: number;
}

export interface Wind {
  /** Degrees magnetic, or null when variable. */
  direction: number | null;
  speedKt: number;
  gustKt?: number;
  variableFrom?: number;
  variableTo?: number;
}

export interface Visibility {
  meters: number;
  /** True when reported as "10 KM OR MORE", "9999", "P6SM" and similar. */
  orMore?: boolean;
  cavok?: boolean;
}

export type CloudCover = "FEW" | "SCT" | "BKN" | "OVC" | "VV";

export interface CloudLayer {
  cover: CloudCover;
  baseFt: number;
  type?: "CB" | "TCU";
}

export interface Qnh {
  hpa: number;
  inHg: number;
}

export interface Approach {
  /** E.g. "ILS Z", "RNAV", "VISUAL". */
  type: string;
  runways: string[];
}

export type FlightCategory = "VFR" | "MVFR" | "IFR" | "LIFR";

export type FlagSeverity = "warn" | "info";

export interface OpsFlag {
  id: string;
  label: string;
  severity: FlagSeverity;
  /** The text that triggered the flag. */
  match: string;
}

export interface DecodedAtis {
  icao: string;
  type: AtisType;
  letter: string;
  /** "HHMM" UTC. */
  issued?: string;
  /** Day of month of the issue, when the ATIS states it ("METAR 141650", "ATIS YSSY R 152104"). */
  issuedDay?: number;
  /** Body lines, cleaned, for display. */
  lines: string[];
  wind?: Wind;
  visibility?: Visibility;
  clouds: CloudLayer[];
  ceilingFt?: number;
  temperatureC?: number;
  dewpointC?: number;
  qnh?: Qnh;
  transitionLevel?: string;
  transitionAltitudeFt?: number;
  approaches: Approach[];
  arrivalRunways: string[];
  departureRunways: string[];
  /** Lowest runway condition code seen (RWYCC), 0–6. */
  rwycc?: number;
  flightCategory?: FlightCategory;
  flags: OpsFlag[];
  /** True when the message looks cut (no end marker / checksum). */
  truncated: boolean;
}
