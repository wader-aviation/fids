// Calls the FAA NMS API for a few airports and prints a summary.
// Usage: node --env-file=.env.local --import tsx scripts/nms-check.mts KJFK LPPT
import { fetchNmsNotams } from "../src/lib/notams/nms";
import { isActive } from "../src/lib/notams/classify";

for (const icao of process.argv.slice(2)) {
  try {
    const all = await fetchNmsNotams(icao);
    const active = all.filter((n) => isActive(n, new Date()));
    const count = new Map<string, number>();
    for (const n of active) count.set(n.group, (count.get(n.group) ?? 0) + 1);
    const groups = [...count].map(([g, c]) => `${g}:${c}`);
    console.log(`${icao}: ${all.length} total, ${active.length} active | ${groups.join(" ")}`);
    for (const n of active.filter((x) => x.severity === "warn").slice(0, 4)) console.log(`   ⚠ ${n.summary} | ${n.id} | ${n.text.replace(/\s+/g, " ").slice(0, 110)}`);
  } catch (e) {
    console.log(`${icao}: ERROR ${e instanceof Error ? e.message : e}`);
  }
}
