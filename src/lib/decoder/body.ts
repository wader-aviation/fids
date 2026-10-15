import type { Approach, CloudCover, CloudLayer, Qnh, Visibility, Wind } from "./types";

const MPS_TO_KT = 1.94384;
const SM_TO_M = 1609.34;

const toKt = (value: number, unit: string | undefined) =>
  unit && unit.startsWith("MPS") ? Math.round(value * MPS_TO_KT) : value;

const signed = (s: string) => (s.startsWith("M") ? -Number(s.slice(1)) : Number(s));

export function parseIssued(flat: string): string | undefined {
  return /\b(\d{4})Z\b/.exec(flat)?.[1];
}

/** Day of month from a DDHHMM group near the top ("METAR 141650", "YSSY R   152104"). */
export function parseIssuedDay(firstLines: string, hhmm?: string): number | undefined {
  for (const m of firstLines.matchAll(/(?:^|[\s-])(\d{2})(\d{4})Z?(?=\s|$)/g)) {
    const day = Number(m[1]);
    const hh = Number(m[2].slice(0, 2));
    const mm = Number(m[2].slice(2));
    if (day < 1 || day > 31 || hh > 23 || mm > 59) continue;
    if (hhmm && Math.abs(hh * 60 + mm - (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2)))) > 60) continue;
    return day;
  }
  return undefined;
}

export function parseWind(flat: string): Wind | undefined {
  // METAR group: 14004KT, VRB06KT, 36035G45KT, 01010KT 210V270
  const metar = /(?:^|\s)(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)\b(?:\s+(\d{3})V(\d{3})\b)?/.exec(flat);
  if (metar) {
    const [, dir, spd, gust, unit, vFrom, vTo] = metar;
    return {
      direction: dir === "VRB" ? null : Number(dir),
      speedKt: toKt(Number(spd), unit),
      ...(gust && { gustKt: toKt(Number(gust), unit) }),
      ...(vFrom && { variableFrom: Number(vFrom), variableTo: Number(vTo) }),
    };
  }

  // Plain language: "WIND 010 DEG 3 KT", "WIND 360/4MPS", "WIND: 090/10", "WND TDZ 060 DEG 11 KT",
  // "WIND 300 DEG, 2 KT", "WIND VRB 1 KT", "WIND RWY 06 TDZ 010/3MPS", "WIND 130/ 11KT"
  const plain =
    /\b(?:WI?ND|TOUCHDOWN WI?ND):?\s+(?:RWY\s+\d{1,2}[LRC]?\s+)?(?:TDZ\s+)?(\d{3}|VRB)(?:\s*DEG)?\s*(?:[,/]|AT)?\s*(\d{1,3})(?!\d)\s*(KTS?|MPS)?(?:\s*(?:GUSTS?|G)\s*(\d{1,3})\s*(?:KTS?|MPS)?)?/.exec(
      flat,
    );
  if (!plain) {
    // "WIND VRB BTN 260 AND 070 DEG, 1 KT"
    const vrbFirst = /\bWI?ND:?\s+VRB\s+BTN\s+(\d{3})\s+AND\s+(\d{3})(?:\s*DEG)?,?\s+(\d{1,3})\s*(KTS?|MPS)/.exec(flat);
    if (!vrbFirst) return undefined;
    return {
      direction: null,
      speedKt: toKt(Number(vrbFirst[3]), vrbFirst[4]),
      variableFrom: Number(vrbFirst[1]),
      variableTo: Number(vrbFirst[2]),
    };
  }
  const [, dir, spd, unit, gust] = plain;
  const wind: Wind = {
    direction: dir === "VRB" ? null : Number(dir),
    speedKt: toKt(Number(spd), unit),
  };
  if (gust) wind.gustKt = toKt(Number(gust), unit);

  const rest = flat.slice(plain.index + plain[0].length, plain.index + plain[0].length + 40);
  const vrb = /^\s*(?:VRB\s*BTN\s*(\d{3})\D{0,6}?AND\s*(\d{3})|(\d{3})V(\d{3}))/.exec(rest);
  if (vrb) {
    wind.variableFrom = Number(vrb[1] ?? vrb[3]);
    wind.variableTo = Number(vrb[2] ?? vrb[4]);
  }
  return wind;
}

export function parseVisibility(flat: string): Visibility | undefined {
  if (/\bCAVOK\b/.test(flat)) return { meters: 10000, orMore: true, cavok: true };

  const sm = /(?:^|\s)(P?)(\d{1,2}(?:\s\d\/\d)?|\d\/\d)SM\b/.exec(flat);
  if (sm) {
    const miles = sm[2]
      .split(" ")
      .reduce((sum, part) => sum + (part.includes("/") ? Number(part[0]) / Number(part[2]) : Number(part)), 0);
    return { meters: Math.round(miles * SM_TO_M), ...((sm[1] || miles >= 10) && { orMore: true }) };
  }

  const km = /\bVIS(?:IBILITY)?:?\s+(?:RWY\s+\S+\s+)?(?:TDZ\s+)?(GT\s+|ABV\s+|GREATER THAN\s+)?(\d{1,2})\s*KM(\s+OR\s+MORE)?\b/.exec(flat);
  if (km) return { meters: Number(km[2]) * 1000, ...((km[1] || km[3] || Number(km[2]) >= 10) && { orMore: true }) };

  const m = /\bVIS(?:IBILITY)?:?\s+(?:RWY\s+\S+\s+)?(?:TDZ\s+)?(\d{3,4})\s*M?\b/.exec(flat);
  if (m) return { meters: Number(m[1]), ...(m[1] === "9999" && { orMore: true }) };

  // METAR group straight after the wind: "26008KT 9999", "01010KT 25KM"
  const afterWind = /(?:KT|MPS)(?:\s+\d{3}V\d{3})?\s+(\d{4}|\d{1,2}KM)\b/.exec(flat);
  if (afterWind) {
    const v = afterWind[1];
    const meters = v.endsWith("KM") ? Number(v.slice(0, -2)) * 1000 : Number(v);
    return { meters, ...((v === "9999" || meters >= 10000) && { orMore: true }) };
  }
  if (/(?:^|\s)9999(?:\s|$)/.test(flat)) return { meters: 10000, orMore: true };
  return undefined;
}

export function parseClouds(flat: string): CloudLayer[] {
  const layers: CloudLayer[] = [];
  const seen = new Set<string>();
  const push = (cover: string, baseFt: number, type?: string) => {
    const key = `${cover}${baseFt}`;
    if (seen.has(key) || Number.isNaN(baseFt)) return;
    seen.add(key);
    layers.push({
      cover: cover as CloudCover,
      baseFt,
      ...((type === "CB" || type === "TCU") && { type }),
    });
  };

  // Explicit units: "SCT 3700 FT", "BKN00400 FT", "FEW01800TCU FT", "SCT 600FT", "FEW 990M"
  const explicit = /\b(FEW|SCT|BKN|OVC|VV)\s*(\d{3,5})\s*(CB|TCU)?\s*(FT|M)\b/g;
  let consumed = flat;
  for (const m of flat.matchAll(explicit)) {
    const value = Number(m[2]);
    push(m[1], m[4] === "M" ? Math.round((value * 3.28084) / 100) * 100 : value, m[3]);
    consumed = consumed.replace(m[0], " ");
  }
  // METAR groups in hundreds of feet: "BKN140", "FEW015CU", "BKN035SC", "VV002"
  for (const m of consumed.matchAll(/(?:^|\s|CIG\s)(FEW|SCT|BKN|OVC|VV)(\d{3})(CB|TCU|[A-Z]{2})?(?=\s|$|=)/g)) {
    push(m[1], Number(m[2]) * 100, m[3]);
  }
  return layers.sort((a, b) => a.baseFt - b.baseFt);
}

export function ceilingFrom(clouds: CloudLayer[]): number | undefined {
  return clouds.find((c) => c.cover === "BKN" || c.cover === "OVC" || c.cover === "VV")?.baseFt;
}

export function parseTemperature(flat: string): { temperatureC?: number; dewpointC?: number } {
  const metar = /(?:^|\s)(M?\d{2})\/(M?\d{2})(?=\s|$)/.exec(flat);
  if (metar) return { temperatureC: signed(metar[1]), dewpointC: signed(metar[2]) };

  const plain = /\b(?:T|TP|TEMP|TMP):?\s*(M?\d{1,2})\b[\s./]*(?:(?:DP|DEW ?POINT)\s*(M?\d{1,2})\b)?/.exec(flat);
  if (!plain) return {};
  return {
    temperatureC: signed(plain[1]),
    ...(plain[2] !== undefined && { dewpointC: signed(plain[2]) }),
  };
}

export function parseQnh(flat: string): Qnh | undefined {
  const hpa = /\bQNH:?\s*Q?(\d{3,4})(?!\d)|(?:^|\s)Q(\d{4})(?!\d)/.exec(flat);
  if (hpa) {
    const value = Number(hpa[1] ?? hpa[2]);
    return { hpa: value, inHg: Math.round((value / 33.8639) * 100) / 100 };
  }
  const inHg = /(?:^|\s|\/)A(\d{4})(?!\d)|\bALTIMETER\s+(\d{4})(?!\d)/.exec(flat);
  if (inHg) {
    const value = Number(inHg[1] ?? inHg[2]) / 100;
    return { hpa: Math.round(value * 33.8639), inHg: value };
  }
  return undefined;
}

export function parseTransition(flat: string): { transitionLevel?: string; transitionAltitudeFt?: number } {
  const out: { transitionLevel?: string; transitionAltitudeFt?: number } = {};
  const tl = /\b(?:(?:TRL|TLVL|TRANS(?:ITION)?[ -]LEVEL):?\s*|TL:?\s+)(FL\s*)?(\d{2,4})\b/.exec(flat);
  if (tl) {
    const value = tl[2];
    // China gives the transition level in metres ("TRL 3600").
    out.transitionLevel = value.length === 4 ? `${value} M` : `FL${value.padStart(3, "0")}`;
  }
  const ta = /\b(?:TA|TRANS(?:ITION)? ALT(?:ITUDE)?):?\s*(\d{3,5})\b/.exec(flat);
  if (ta) out.transitionAltitudeFt = Number(ta[1]);
  return out;
}

// ---------------------------------------------------------------- runways

const RWY_WORD = /^(?:RWYS?|RYS?|RUNWAYS?|IFR|VFR|AND|OR|&|ALSO)$/;
const DESIGNATOR = /^(\d{1,2})([LRC])?$/;

export function padRunway(n: string, side = ""): string | null {
  const num = Number(n);
  if (num < 1 || num > 36) return null;
  return `${String(num).padStart(2, "0")}${side}`;
}

/** Reads a runway list like "19, 15", "34L/34R", "16L AND R", "24L AND 24R AND VFR 24L". */
export function readRunwayList(text: string): string[] {
  const tokens = text.split(/[\s,/]+|(?<=\d[LRC]?)(?=&)|&/).filter(Boolean);
  const out: string[] = [];
  let lastNumber: string | null = null;
  for (const raw of tokens) {
    const t = raw.replace(/[.:;]$/, "");
    const d = DESIGNATOR.exec(t);
    if (d) {
      const rwy = padRunway(d[1], d[2]);
      if (!rwy) break;
      if (!out.includes(rwy)) out.push(rwy);
      lastNumber = d[1];
      if (raw.endsWith(".") || raw.endsWith(";")) break;
      continue;
    }
    if (lastNumber && /^[LRC]$/.test(t)) {
      const rwy = padRunway(lastNumber, t);
      if (rwy && !out.includes(rwy)) out.push(rwy);
      continue;
    }
    if (RWY_WORD.test(t)) continue;
    break;
  }
  return out;
}

const LIST = String.raw`((?:(?:RWYS?|IFR|VFR|AND|OR|&)?[\s,/&]*\d{1,2}[LRC]?\b(?:\s+(?:AND\s+)?[LRC]\b)?[\s,/&]*)+)`;

export function parseRunways(flat: string): { arrival: string[]; departure: string[]; inUse: string[] } {
  const arrival: string[] = [];
  const departure: string[] = [];
  const inUse: string[] = [];
  const add = (target: string[], list: string[]) => list.forEach((r) => !target.includes(r) && target.push(r));

  const patterns: Array<[RegExp, Array<string[]>]> = [
    [new RegExp(String.raw`\b(?:LDG|LNDG|LANDING)\s+AND\s+DEP\w*\s+(?:RWYS?|RYS?|RUNWAYS?)\s*` + LIST, "g"), [arrival, departure]],
    [new RegExp(String.raw`\b(?:LDG|LNDG|LANDING|ARRIVALS?|ARRS?),?\s+(?:RWYS?|RYS?|RUNWAYS?)\b\s*` + LIST, "g"), [arrival]],
    [new RegExp(String.raw`\b(?:DEPG|DEPS?|DEPARTING|DEPARTURES?|TKOF|TAKE-?OFF)\s+(?:RWYS?|RYS?|RUNWAYS?)\b\s*` + LIST, "g"), [departure]],
    [new RegExp(String.raw`\b(?:RWYS?|RYS?|RUNWAYS?):?\s*` + LIST + String.raw`FOR\s+(?:ARRS?|ARRIVALS?|LDG|LANDING)\s+AND\s+DEPS?\b`, "g"), [arrival, departure]],
    [new RegExp(String.raw`\b(?:RWYS?|RYS?|RUNWAYS?):?\s*` + LIST + String.raw`FOR\s+(?:ARRS?|ARRIVALS?|LDG|LANDING)\b`, "g"), [arrival]],
    [new RegExp(String.raw`\b(?:RWYS?|RYS?|RUNWAYS?):?\s*` + LIST + String.raw`FOR\s+(?:DEPS?|DEPARTURES?|TKOF|TAKE-?OFF)\b`, "g"), [departure]],
    [new RegExp(String.raw`\b(?:RWYS?|RYS?|RUNWAYS?)\s+IN\s+USE:?\s*` + LIST, "g"), [inUse]],
    [new RegExp(String.raw`\b(?:RWYS?|RYS?|RUNWAYS?)\s*` + LIST + String.raw`IN\s+USE\b`, "g"), [inUse]],
    [new RegExp(String.raw`\bRWY:\s*` + LIST, "g"), [inUse]],
  ];

  for (const [re, targets] of patterns) {
    for (const m of flat.matchAll(re)) {
      const list = readRunwayList(m[1]);
      targets.forEach((t) => add(t, list));
    }
  }
  return { arrival, departure, inUse };
}

export function parseApproaches(flat: string): Approach[] {
  const re =
    /\b(RIVER VISUAL|ILS ?DME|ILS|RNAV|RNP|GLS|LOC|VOR|NDB|VISUAL)((?:\s?(?:[VWXYZK]|DME|GPS|CAT(?:EGORY)?\s?(?:III|II|I|[123])))*)\b(?:,?\s+(?:AND\s+CHARTED\s+VISUAL\s+)?(?:APCHS?|APPROACH(?:ES)?))?,?(?:\s*(?:TO\s+)?(?:RWYS?|RYS?|RUNWAYS?)\s*|\s+)((?:\d{1,2}[LRC]?\b[\s,/&]*(?:AND\s+|&\s*)?)+)?/g;
  const out: Approach[] = [];
  for (const m of flat.replace(/\bI L S\b/g, "ILS").replace(/APCHRWY/g, "APCH RWY").matchAll(re)) {
    // "ILS RWY 27R OTS" is an outage, not an approach in use.
    const after = flat.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 6);
    if (/^\s*(OTS|U\/S|INOP)/.test(after)) continue;
    const type = `${m[1].replace(/\s+/g, " ").replace("ILSDME", "ILS DME")}${m[2] ? ` ${m[2].trim()}` : ""}`.trim();
    const runways = m[3] ? readRunwayList(m[3]) : [];
    if (!runways.length && !/APCH|APPROACH/.test(m[0])) continue;
    const existing = out.find((a) => a.type === type);
    if (existing) runways.forEach((r) => !existing.runways.includes(r) && existing.runways.push(r));
    else out.push({ type, runways });
  }
  return out;
}

export function parseRwycc(flat: string): number | undefined {
  const codes: number[] = [];
  for (const m of flat.matchAll(/\b(?:RWYCC|SFC COND|RWY COND(?:ITION)? CODES?):?\s*([0-6](?:\s*[.,/\s]\s*[0-6]){0,2})(?!\d)/g)) {
    m[1].split(/[.,/\s]+/).forEach((c) => codes.push(Number(c.trim())));
  }
  return codes.length ? Math.min(...codes) : undefined;
}
