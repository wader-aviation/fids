/** Small inline icons. They take the current text colour. */

export function WindsockIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 21V3" />
      <path d="M4 4l15 2.5v6L4 15z" />
      <path d="M9 4.8v9.4M14 5.7v7.6" />
    </svg>
  );
}

export function PlaneIcon({ className = "h-5 w-5", direction = "dep" }: { className?: string; direction?: "dep" | "arr" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden style={{ transform: direction === "arr" ? "rotate(90deg)" : undefined }}>
      <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" transform={direction === "dep" ? "rotate(-35 12 12)" : undefined} />
    </svg>
  );
}

export function BackIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

export function ChevronIcon({ className = "h-4 w-4", open }: { className?: string; open?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
