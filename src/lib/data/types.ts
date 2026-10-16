import type { Airport } from "@/lib/airports";
import type { DecodedAtis } from "@/lib/decoder";
import type { AtisDiff } from "@/lib/decoder/diff";
import type { FlightLeg } from "@/lib/movements/types";
import type { AtisIssue } from "./merge-atis";

/** One ATIS issue as served by the API. Dates are ISO strings. */
export interface AtisRecord {
  key: string;
  icao: string;
  type: DecodedAtis["type"];
  letter: string;
  issuedAt: string;
  firstSeen: string;
  lastSeen: string;
  sightings: number;
  truncated: boolean;
  text: string;
  decoded: DecodedAtis;
  prevKey: string | null;
  diff: AtisDiff | null;
}

/** What the board shows for one airport. Unless `split`, `arr` and `dep` are the same single ATIS. */
export interface AirportAtis {
  /** True when the airport broadcasts separate arrival and departure ATIS. */
  split: boolean;
  icao: string;
  airport: Pick<Airport, "iata" | "name" | "city" | "country"> | null;
  arr: AtisRecord | null;
  dep: AtisRecord | null;
}

export interface AtisSource {
  /** Latest record per airport and type, seen within `maxAgeMin`. All airports when `icaos` is null. */
  latest(icaos: string[] | null, maxAgeMin: number): Promise<AtisRecord[]>;
  /** All records for one airport issued in the last `hours`, newest first. */
  history(icao: string, hours: number): Promise<AtisRecord[]>;
  /** ARR/DEP issues of the last `hours` (light form), to tell one ATIS from two. All airports when null. */
  issues(icaos: string[] | null, hours: number): Promise<AtisIssue[]>;
  /** Flight legs touching these airports (all when null), heard within `sinceMs`. */
  legs(icaos: string[] | null, sinceMs: number): Promise<FlightLeg[]>;
  /** "database" or "live" (in-memory, straight from Airframes). */
  readonly kind: "database" | "live";
}
