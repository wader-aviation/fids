"""Builds src/data/airports.json from OurAirports (public domain).
Usage: python3 -I scripts/build-airports.py path/to/airports.csv path/to/countries.csv src/data/airports.json
Keeps large/medium airports with a 4-letter ICAO code, plus any with scheduled service."""
import csv, json, re, sys

airports_csv, countries_csv, out = sys.argv[1:4]
countries = {r["code"]: r["name"] for r in csv.DictReader(open(countries_csv, encoding="utf-8"))}
rows = []
for r in csv.DictReader(open(airports_csv, encoding="utf-8")):
    icao = r["icao_code"] or r["gps_code"] or r["ident"]
    if not re.fullmatch(r"[A-Z]{4}", icao or ""):
        continue
    if r["type"] not in ("large_airport", "medium_airport") and r["scheduled_service"] != "yes":
        continue
    rows.append([icao, r["iata_code"] or "", r["name"], r["municipality"] or "", r["iso_country"],
                 countries.get(r["iso_country"], r["iso_country"]),
                 round(float(r["latitude_deg"]), 3), round(float(r["longitude_deg"]), 3)])
rows.sort()
seen, unique = set(), []
for row in rows:
    if row[0] in seen: continue
    seen.add(row[0]); unique.append(row)
json.dump({"fields": ["icao", "iata", "name", "city", "country", "countryName", "lat", "lon"], "rows": unique},
          open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(len(unique), "airports")
