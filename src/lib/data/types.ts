import type { Airport } from "@/lib/airports";
import type { DecodedAtis } from "@/lib/decoder";
import type { AtisDiff } from "@/lib/decoder/diff";

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

/** What the board shows for one airport. Combined ATIS fill both columns. */
export interface AirportAtis {
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
  /** "database" or "live" (in-memory, straight from Airframes). */
  readonly kind: "database" | "live";
}
