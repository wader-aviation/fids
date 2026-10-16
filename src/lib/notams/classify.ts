import type { FlagSeverity } from "@/lib/decoder";

export type NotamGroup = "runway" | "navaid" | "taxiway" | "lighting" | "obstacle" | "airspace" | "procedure" | "other";

export interface Notam {
  id: string; // e.g. "A1234/26"
  location: string;
  /** Five-letter Q-code, e.g. QMRLC, when the NOTAM has one. */
  qcode: string | null;
  start: string | null;
  /** null = permanent or unknown. */
  end: string | null;
  estimatedEnd: boolean;
  text: string;
  group: NotamGroup;
  severity: FlagSeverity;
  /** Short label for chips: "Runway closed", "ILS out of service". */
  summary: string;
}

const SUBJECT_GROUP: Array<[RegExp, NotamGroup]> = [
  [/^MR|^MD|^MT|^MU|^MW|^MS/, "runway"], // runway, declared distances, threshold, ...
  [/^M[A-Z]/, "taxiway"], // taxiway, apron, parking, movement area
  [/^I[A-Z]|^N[A-Z]|^G[A-Z]/, "navaid"], // ILS, VOR/DME/NDB, GNSS
  [/^L[A-Z]/, "lighting"],
  [/^O[A-Z]/, "obstacle"],
  [/^[RWA][A-Z]/, "airspace"],
  [/^[PSC][A-Z]/, "procedure"],
];

const CONDITION: Record<string, string> = {
  LC: "closed",
  AS: "out of service",
  AU: "not available",
  AK: "back in service",
  AL: "operating with limits",
  LT: "limited",
  CH: "changed",
  HW: "work in progress",
  XX: "",
};

const SUBJECT: Record<string, string> = {
  MR: "Runway",
  MX: "Taxiway",
  MN: "Apron",
  MA: "Movement area",
  MD: "Declared distances",
  MT: "Threshold",
  IC: "ILS",
  IG: "Glide path",
  IL: "Localizer",
  ID: "ILS DME",
  NV: "VOR",
  ND: "DME",
  NB: "NDB",
  GA: "GNSS",
  GW: "GNSS",
  LR: "Runway lights",
  LX: "Taxiway lights",
  LA: "Approach lights",
  OB: "Obstacle",
  OL: "Obstacle lights",
  PI: "Instrument approach",
  PD: "SID",
  PA: "STAR",
  WU: "Drones",
  WE: "Exercises",
  RA: "Airspace",
  RT: "Temporary restricted area",
};

const TEXT_RULES: Array<[RegExp, NotamGroup, FlagSeverity, string]> = [
  [/\b(?:RWY|RUNWAY)\s*\d{1,2}[LRC]?(?:\/\d{1,2}[LRC]?)?\s+(?:CLSD|CLOSED)\b/, "runway", "warn", "Runway closed"],
  [/\b(?:ILS|LOC|GP|GS|GLIDE ?(?:SLOPE|PATH))\b[^.]{0,30}?\b(?:U\/S|UNSERVICEABLE|OTS|OUT OF SERVICE|NOT AVBL)\b/, "navaid", "warn", "ILS out of service"],
  [/\b(?:GNSS|GPS)\b[^.]{0,40}?\b(?:U\/S|UNRELIABLE|INTERFERENCE|JAMMING|OUTAGE|NOT AVBL)\b/, "navaid", "warn", "GNSS unreliable"],
  [/\b(?:VOR|DME|NDB)\b[^.]{0,30}?\b(?:U\/S|UNSERVICEABLE|OTS|OUT OF SERVICE|NOT AVBL)\b/, "navaid", "info", "Navaid out of service"],
  [/\b(?:TWY|TAXIWAY)\b[^.]{0,40}?\b(?:CLSD|CLOSED)\b/, "taxiway", "info", "Taxiway closed"],
  [/\bCRANE|\bOBST|\bTOWER\b/, "obstacle", "info", "Obstacle"],
  [/\bLGT|\bLIGHT/, "lighting", "info", "Lighting"],
];

/** Groups and labels one NOTAM. Uses the Q-code when present, the text otherwise (US domestic NOTAMs have no Q-code). */
export function classify(qcode: string | null, text: string): Pick<Notam, "group" | "severity" | "summary"> {
  const upper = text.toUpperCase();
  if (qcode && /^Q[A-Z]{4}$/.test(qcode)) {
    const subject = qcode.slice(1, 3);
    const condition = qcode.slice(3, 5);
    const group = SUBJECT_GROUP.find(([re]) => re.test(subject))?.[1] ?? "other";
    const warn =
      (subject === "MR" && condition === "LC") ||
      (/^I[CGLD]$/.test(subject) && /^(AS|AU)$/.test(condition)) ||
      (/^G[AW]$/.test(subject) && condition !== "AK");
    const name = SUBJECT[subject] ?? group[0].toUpperCase() + group.slice(1);
    const cond = CONDITION[condition];
    return { group, severity: warn ? "warn" : "info", summary: cond ? `${name} ${cond}` : name };
  }
  for (const [re, group, severity, summary] of TEXT_RULES) {
    if (re.test(upper)) return { group, severity, summary };
  }
  return { group: "other", severity: "info", summary: "Other" };
}

export function isActive(n: Pick<Notam, "start" | "end">, now: Date): boolean {
  const t = now.toISOString();
  return (!n.start || n.start <= t) && (!n.end || n.end >= t);
}

export const GROUP_ORDER: NotamGroup[] = ["runway", "navaid", "taxiway", "lighting", "obstacle", "airspace", "procedure", "other"];
