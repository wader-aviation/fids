// Pulls the last 15 minutes from Airframes and runs assemble + merge without a database.
// Usage: npx tsx scripts/dry-run.mts
import { fetchMessagesSince } from "../src/lib/airframes/client";
import { assemble, merge } from "../src/lib/ingest/assemble";

const since = new Date(Date.now() - 15 * 60_000).toISOString();
const [a9, other] = await Promise.all([
  fetchMessagesSince({ labels: ["A9"], afterId: 0, since, maxPages: 10 }),
  fetchMessagesSince({ labels: ["RA", "HX"], text: "ATIS", afterId: 0, since, maxPages: 3 }),
]);
const all = [...a9.messages, ...other.messages].sort((a, b) => a.id - b.id);
const candidates = assemble(all);
const merged = merge(candidates);
const stitched = candidates.filter((c) => c.sourceIds.length > 1).length;
console.log({ fetched: all.length, complete: a9.complete && other.complete, candidates: candidates.length, stitched, atis: merged.length });
for (const m of merged.sort((a, b) => a.decoded.icao.localeCompare(b.decoded.icao)).slice(0, 25)) {
  const d = m.decoded;
  console.log(
    `${d.icao} ${d.type.padEnd(7)} ${d.letter} ${d.issued ?? "----"}Z x${String(m.sightings).padEnd(3)} ${d.truncated ? "CUT " : "    "}ARR ${d.arrivalRunways.join(",") || "-"} DEP ${d.departureRunways.join(",") || "-"} ${d.flightCategory ?? ""} ${d.flags.filter((f) => f.severity === "warn").map((f) => f.id).join(",")}`,
  );
}
