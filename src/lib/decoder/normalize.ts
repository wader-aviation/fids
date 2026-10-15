/**
 * ACARS uplinks end with a 4-hex-digit block check that is not part of the ATIS.
 * It is either alone on the last line, or glued to the last token.
 */
export function stripChecksum(text: string): { text: string; hadChecksum: boolean } {
  const trimmed = text.replace(/\s+$/, "");
  const lines = trimmed.split("\n");
  const last = lines[lines.length - 1].trim();

  if (/^[0-9A-F]{4}$/.test(last)) {
    return { text: lines.slice(0, -1).join("\n").replace(/\s+$/, ""), hadChecksum: true };
  }

  const glued = [
    /(\.)[0-9A-F]{4}$/, // "INFO B.EA8D", "BCFG.AC04"
    /((?:INFO|ATIS|INFORMATION)\s+[A-Z])[0-9A-F]{4}$/, // "INFO Z42BE"
    /(\d{4})(?=[0-9A-F]{4}$)(?=.*[A-F])[0-9A-F]{4}$/, // "QNH: 103058C9"
  ];
  for (const re of glued) {
    if (re.test(trimmed)) return { text: trimmed.replace(re, "$1"), hadChecksum: true };
  }
  return { text: trimmed, hadChecksum: false };
}

/** Uppercase, unify line breaks, drop tabs and blank lines. Keeps line structure. */
export function normalizeText(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\t/g, " ").replace(/ {2,}/g, " ").trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

/**
 * One-line form for regex parsing. Words split over a line break are kept apart
 * (ATIS line breaks are always at word boundaries in practice).
 */
export function flatten(text: string): string {
  return text
    .replace(/\n/g, " ")
    .replace(/\b(RWYS?|RY)(?=\d)/g, "$1 ") // "RWY05L" → "RWY 05L"
    .replace(/(\d{1,2})\s+(RIGHT|LEFT|CENT(?:ER|RE))\b/g, (_, n, s) => `${n}${s[0]}`)
    .replace(/ {2,}/g, " ")
    .trim();
}
