import type { FlightCategory, Visibility, Wind } from "./types";

const M_PER_SM = 1609.34;

/** FAA flight category from ceiling and visibility. */
export function flightCategory(ceilingFt?: number, visibility?: Visibility): FlightCategory | undefined {
  if (ceilingFt === undefined && !visibility) return undefined;
  const ceil = ceilingFt ?? Infinity;
  const sm = visibility ? visibility.meters / M_PER_SM : Infinity;
  if (ceil < 500 || sm < 1) return "LIFR";
  if (ceil < 1000 || sm < 3) return "IFR";
  if (ceil <= 3000 || sm <= 5) return "MVFR";
  return "VFR";
}

export interface WindComponents {
  runway: string;
  /** Positive = headwind, negative = tailwind. */
  headwindKt: number;
  /** Absolute crosswind. */
  crosswindKt: number;
  /** Same as above but using the gust speed. */
  gustCrosswindKt?: number;
  gustTailwindKt?: number;
}

/**
 * ATIS wind and runway designators are both magnetic, so the designator × 10
 * is good enough (±5°) for a dispatcher's limit check.
 */
export function windComponents(wind: Wind, runway: string): WindComponents | undefined {
  if (wind.direction === null) return undefined;
  const heading = Number(runway.slice(0, 2)) * 10;
  const angle = ((wind.direction - heading) * Math.PI) / 180;
  const head = (speed: number) => Math.round(speed * Math.cos(angle));
  const cross = (speed: number) => Math.abs(Math.round(speed * Math.sin(angle)));
  const out: WindComponents = {
    runway,
    headwindKt: head(wind.speedKt),
    crosswindKt: cross(wind.speedKt),
  };
  if (wind.gustKt) {
    out.gustCrosswindKt = cross(wind.gustKt);
    const gustHead = head(wind.gustKt);
    if (gustHead < 0) out.gustTailwindKt = -gustHead;
  }
  return out;
}
