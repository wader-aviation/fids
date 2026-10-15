import type { DecodedAtis, Wind } from "@/lib/decoder";
import { windComponents } from "@/lib/decoder/ops";

export function minutesSince(iso: string, now: number): number {
  return Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
}

export function fmtAge(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h}h${String(min % 60).padStart(2, "0")}` : `${Math.floor(h / 24)}d`;
}

export function fmtZ(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}Z`;
}

export function fmtWind(w?: Wind): string {
  if (!w) return "—";
  if (w.direction === 0 && w.speedKt === 0) return "CALM";
  const dir = w.direction === null ? "VRB" : String(w.direction).padStart(3, "0");
  const vrb = w.variableFrom !== undefined ? ` ${String(w.variableFrom).padStart(3, "0")}V${String(w.variableTo).padStart(3, "0")}` : "";
  return `${dir}/${w.speedKt}${w.gustKt ? `G${w.gustKt}` : ""}KT${vrb}`;
}

export function fmtVis(d: DecodedAtis): string {
  const v = d.visibility;
  if (!v) return "—";
  if (v.cavok) return "CAVOK";
  if (v.meters >= 9999) return "10km+";
  return v.meters >= 5000 ? `${Math.round(v.meters / 1000)}km` : `${v.meters}m`;
}

export function fmtCeil(d: DecodedAtis): string {
  if (d.ceilingFt === undefined) return d.visibility?.cavok || d.clouds.length ? "none" : "—";
  return `${d.ceilingFt.toLocaleString("en-US")}ft`;
}

export function fmtQnh(d: DecodedAtis): string {
  if (!d.qnh) return "—";
  // US/Canada report inHg; show what the pilots hear first.
  return /^[KCP]/.test(d.icao) ? `A${(d.qnh.inHg * 100).toFixed(0)}` : `Q${d.qnh.hpa}`;
}

export interface WorstWind {
  crosswindKt: number;
  crosswindRunway: string;
  tailwindKt: number;
  tailwindRunway: string;
}

/** Worst crosswind and tailwind over the runways in use, using gusts when reported. */
export function worstWind(d: DecodedAtis): WorstWind | null {
  if (!d.wind || d.wind.direction === null) return null;
  const runways = [...new Set([...d.arrivalRunways, ...d.departureRunways])];
  if (!runways.length) return null;
  let worst: WorstWind = { crosswindKt: 0, crosswindRunway: "", tailwindKt: 0, tailwindRunway: "" };
  for (const r of runways) {
    const c = windComponents(d.wind, r);
    if (!c) continue;
    const xw = c.gustCrosswindKt ?? c.crosswindKt;
    const tw = c.gustTailwindKt ?? (c.headwindKt < 0 ? -c.headwindKt : 0);
    if (xw > worst.crosswindKt || !worst.crosswindRunway) worst = { ...worst, crosswindKt: xw, crosswindRunway: r };
    if (tw > worst.tailwindKt) worst = { ...worst, tailwindKt: tw, tailwindRunway: r };
  }
  return worst;
}
