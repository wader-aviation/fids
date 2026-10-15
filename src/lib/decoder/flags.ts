import type { FlagSeverity, OpsFlag } from "./types";

interface Rule {
  id: string;
  label: string;
  severity: FlagSeverity;
  re: RegExp;
}

// Ops-relevant items a dispatcher wants to see without reading the whole ATIS.
const RULES: Rule[] = [
  {
    id: "rwy_closed",
    label: "Runway closed",
    severity: "warn",
    re: /\b(?:RWY|RY|RUNWAY)\s*\d{1,2}[LRC]?(?:\s*\/\s*\d{1,2}[LRC]?)?\s+(?:IS\s+)?(?:CLSD|CLOSED)\b/,
  },
  {
    id: "lvp",
    label: "Low visibility procedures",
    severity: "warn",
    re: /\bLVP\b|\bLVO\b|\bLOW VIS(?:IBILITY)? (?:PROC|PROCEDURES|OPS|OPERATIONS)\b/,
  },
  { id: "cat23", label: "CAT II/III approaches", severity: "info", re: /\bCAT(?:EGORY)?\s?(?:III|II|3|2)\b/ },
  { id: "windshear", label: "Windshear", severity: "warn", re: /\bWIND ?SHEAR\b|\bLLWS\b|\bWS\s+(?:ALL\s+)?RWY\b/ },
  {
    id: "thunderstorm",
    label: "Thunderstorm / CB",
    severity: "warn",
    re: /(?:^|\s)[+-]?(?:VC|RE)?TS(?:RA|GR|SN|GS)?\b|\bTHUNDERSTORMS?\b|\b(?:FEW|SCT|BKN|OVC)\d{3}CB\b/,
  },
  {
    id: "contaminated",
    label: "Runway contaminated",
    severity: "warn",
    re: /\b(?:SNOW|SLUSH|ICE|ICY|STANDING WATER|FROST|COMPACTED)\b/,
  },
  {
    id: "braking",
    label: "Braking action reported",
    severity: "warn",
    re: /\bBRAKING ACTION\b|\bBA\s+(?:POOR|MEDIUM|GOOD)\b/,
  },
  {
    id: "gnss",
    label: "GNSS interference",
    severity: "warn",
    re: /\bGNSS\b[^.]{0,40}?\b(?:INTERFERENCE|JAMMING|U\/S|UNRELIABLE|OUTAGE|NOT AVBL)\b|\bGPS\s+(?:INTERFERENCE|JAMMING|SPOOFING|U\/S|UNRELIABLE|OUTAGE)\b|\bJAMMING\b|\bSPOOFING\b/,
  },
  {
    id: "navaid_us",
    label: "Navaid out of service",
    severity: "warn",
    re: /\b(?:ILS|LOC|GP|GS|GLIDE ?(?:SLOPE|PATH)|VOR|DME|NDB)\b[^.]{0,25}?\b(?:OTS|U\/S|UNSERVICEABLE|OUT OF SERVICE|NOT AVBL|UNAVBL|UNAVAILABLE|INOP)\b/,
  },
  { id: "volcanic_ash", label: "Volcanic ash", severity: "warn", re: /\bVOLCANIC ASH\b|\bVA\b(?=.*\bASH\b)/ },
  { id: "deicing", label: "De-icing", severity: "info", re: /\bDE-?ICING\b|\bANTI-?ICING\b/ },
  { id: "birds", label: "Bird activity", severity: "info", re: /\bBIRDS?\b/ },
  {
    id: "twy_closed",
    label: "Taxiway closed",
    severity: "info",
    re: /\b(?:TWYS?|TAXIWAYS?)\b[^.]{0,40}?\b(?:CLSD|CLOSED)\b/,
  },
  { id: "cranes", label: "Cranes / works", severity: "info", re: /\bCRANES?\b|\bWIP\b|\bWORK IN PROGRESS\b|\bCONSTRUCTION\b/ },
  { id: "wet", label: "Runway wet", severity: "info", re: /\bRWY WET\b|\bWET\/WET\/WET\b|\b100 PCT WET\b/ },
];

export function detectFlags(flat: string, rwycc?: number): OpsFlag[] {
  const flags: OpsFlag[] = [];
  for (const rule of RULES) {
    const m = rule.re.exec(flat);
    if (m) flags.push({ id: rule.id, label: rule.label, severity: rule.severity, match: m[0].trim() });
  }
  if (rwycc !== undefined && rwycc < 5) {
    flags.push({ id: "rwycc_low", label: `Runway condition code ${rwycc}`, severity: "warn", match: `RWYCC ${rwycc}` });
  }
  return flags;
}
