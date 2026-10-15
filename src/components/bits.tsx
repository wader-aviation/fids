import type { FlightCategory, OpsFlag } from "@/lib/decoder";

export function LetterBadge({ letter, size = "md", stale }: { letter?: string; size?: "md" | "xl"; stale?: boolean }) {
  const dims = size === "xl" ? "h-16 w-16 text-4xl" : "h-9 w-9 text-xl";
  return (
    <span
      className={`inline-flex ${dims} shrink-0 items-center justify-center rounded-md border font-mono font-semibold ${
        letter ? (stale ? "border-line text-muted" : "border-accent text-accent") : "border-dashed border-line text-muted"
      }`}
      aria-label={letter ? `Information ${letter}` : "No ATIS"}
    >
      {letter ?? "–"}
    </span>
  );
}

export function CategoryPill({ cat }: { cat?: FlightCategory }) {
  if (!cat) return null;
  return (
    <span className={`inline-flex items-center gap-1 font-mono text-xs font-semibold cat-${cat}`}>
      <span className={`h-2 w-2 rounded-full bgcat-${cat}`} />
      {cat}
    </span>
  );
}

export function FlagChips({ flags, limit }: { flags: OpsFlag[]; limit?: number }) {
  const sorted = [...flags].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "warn" ? -1 : 1));
  const shown = limit ? sorted.slice(0, limit) : sorted;
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((f) => (
        <span
          key={f.id}
          title={f.match}
          className={`rounded border px-1.5 py-0.5 text-[11px] leading-none whitespace-nowrap ${
            f.severity === "warn" ? "border-warn/60 text-warn" : "border-line text-muted"
          }`}
        >
          {f.label}
        </span>
      ))}
      {limit && sorted.length > limit && <span className="text-[11px] text-muted">+{sorted.length - limit}</span>}
    </span>
  );
}
