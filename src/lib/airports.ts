import data from "@/data/airports.json";

export interface Airport {
  icao: string;
  iata: string;
  name: string;
  city: string;
  country: string;
  countryName: string;
  lat: number;
  lon: number;
}

type Row = [string, string, string, string, string, string, number, number];

const all: Airport[] = (data.rows as Row[]).map(([icao, iata, name, city, country, countryName, lat, lon]) => ({
  icao,
  iata,
  name,
  city,
  country,
  countryName,
  lat,
  lon,
}));
const byIcao = new Map(all.map((a) => [a.icao, a]));
const byIata = new Map(all.filter((a) => a.iata).map((a) => [a.iata, a]));

export function airport(icao: string): Airport | undefined {
  return byIcao.get(icao.toUpperCase());
}

/** Resolves an ICAO or IATA code. Unknown 4-letter codes are kept as-is. */
export function resolveCode(code: string): string | null {
  const c = code.trim().toUpperCase();
  if (/^[A-Z]{4}$/.test(c)) return c;
  if (/^[A-Z]{3}$/.test(c)) return byIata.get(c)?.icao ?? null;
  return null;
}

/**
 * Reads a free-text list of airports or a route: "LPPT-KJFK ALT KBOS,KEWR", "lis jfk bos".
 * Returns unique ICAO codes in order, plus the tokens it could not resolve.
 */
export function parseAirportList(input: string): { icaos: string[]; unknown: string[] } {
  const icaos: string[] = [];
  const unknown: string[] = [];
  for (const token of input.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)) {
    if (["ALT", "ALTN", "DEST", "DEP", "ARR", "VIA", "TO"].includes(token)) continue;
    const icao = resolveCode(token);
    if (icao) {
      if (!icaos.includes(icao)) icaos.push(icao);
    } else unknown.push(token);
  }
  return { icaos, unknown };
}

export function searchAirports(query: string, limit = 8): Airport[] {
  const q = query.trim().toUpperCase();
  if (q.length < 2) return [];
  const exact = byIcao.get(q) ?? byIata.get(q);
  const out: Airport[] = exact ? [exact] : [];
  for (const a of all) {
    if (out.length >= limit) break;
    if (a === exact) continue;
    if (a.icao.startsWith(q) || a.iata === q || a.name.toUpperCase().includes(q) || a.city.toUpperCase().includes(q)) {
      out.push(a);
    }
  }
  return out;
}
