// Pulls recent movement messages from Airframes and prints the resulting departure/arrival lists.
// Usage: npx tsx scripts/movements-dry-run.mts [minutes=30] [ICAO ...]
import { fetchMessagesSince } from "../src/lib/airframes/client";
import { decodeMovement, MOVEMENT_LABELS } from "../src/lib/movements/decode";
import { arrivalsTo, departuresFrom, foldEvents, legStatus } from "../src/lib/movements/legs";
import type { FlightLeg } from "../src/lib/movements/types";

const [minArg, ...airports] = process.argv.slice(2);
const minutes = Number(minArg ?? 30);
const since = new Date(Date.now() - minutes * 60_000).toISOString();
const { messages, complete } = await fetchMessagesSince({ labels: MOVEMENT_LABELS, afterId: 0, since, maxPages: 40 });
const events = messages.map(decodeMovement).filter((e) => e !== null);
const legs = foldEvents(new Map<string, FlightLeg>(), events);
const withRoute = legs.filter((l) => l.origin && l.destination).length;
console.log({ messages: messages.length, complete, events: events.length, legs: legs.length, withRoute });

const count = new Map<string, number>();
for (const l of legs) for (const a of [l.origin, l.destination]) if (a) count.set(a, (count.get(a) ?? 0) + 1);
console.log("busiest:", [...count].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([a, n]) => `${a}:${n}`).join(" "));

const w = { now: new Date(), pastMs: 3 * 3_600_000 };
const hm = (s: string | null) => (s ? s.slice(11, 16) : "  -  ");
for (const icao of airports.length ? airports : [...count].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([a]) => a)) {
  console.log(`\n== ${icao} DEPARTURES`);
  for (const l of departuresFrom(legs, icao, w)) console.log(`${(l.flight ?? "").padEnd(8)} ${l.tail.padEnd(8)} → ${l.destination ?? "????"} out ${hm(l.outAt)} off ${hm(l.offAt)} ${legStatus(l)}`);
  console.log(`== ${icao} ARRIVALS`);
  for (const l of arrivalsTo(legs, icao, w)) console.log(`${(l.flight ?? "").padEnd(8)} ${l.tail.padEnd(8)} ← ${l.origin ?? "????"} eta ${hm(l.eta)} on ${hm(l.onAt)} in ${hm(l.inAt)} ${legStatus(l)} ${l.arrivalRunway ?? ""}`);
}
