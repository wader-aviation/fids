// Dev helper: decode a JSON array of Airframes messages and print a summary per message.
// Usage: npx tsx scripts/decode-dump.mts path/to/messages.json [ICAO]
import { readFileSync } from "node:fs";
import { decodeAtis } from "../src/lib/decoder";

const [file, only] = process.argv.slice(2);
const raw = JSON.parse(readFileSync(file, "utf8"));
const messages: Array<{ id: number; label: string; text: string | null }> = Array.isArray(raw) ? raw : raw.samples;
const seen = new Set<string>();
let decoded = 0;
for (const m of messages) {
  const d = m.text ? decodeAtis(m.text) : null;
  if (!d) continue;
  decoded++;
  const key = `${d.icao}${d.type}${d.letter}`;
  if (seen.has(key) || (only && d.icao !== only)) continue;
  seen.add(key);
  const w = d.wind ? `${d.wind.direction ?? "VRB"}/${d.wind.speedKt}${d.wind.gustKt ? `G${d.wind.gustKt}` : ""}` : "-";
  console.log(
    [
      `${d.icao} ${d.type.padEnd(7)} ${d.letter} ${d.issued ?? "----"}`,
      `wind ${w}`,
      `vis ${d.visibility?.meters ?? "-"}`,
      `ceil ${d.ceilingFt ?? "-"}`,
      `T ${d.temperatureC ?? "-"}/${d.dewpointC ?? "-"}`,
      `Q ${d.qnh?.hpa ?? "-"}`,
      `TL ${d.transitionLevel ?? "-"}`,
      `ARR ${d.arrivalRunways.join(",") || "-"}`,
      `DEP ${d.departureRunways.join(",") || "-"}`,
      `APP ${d.approaches.map((a) => `${a.type}:${a.runways.join("/")}`).join(" ") || "-"}`,
      `${d.flightCategory ?? "-"}`,
      d.truncated ? "CUT" : "",
      d.flags.map((f) => f.id).join(","),
    ].join(" | "),
  );
}
console.error(`decoded ${decoded}/${messages.length}, unique ${seen.size}`);
