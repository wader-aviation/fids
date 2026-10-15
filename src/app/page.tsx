import { Suspense } from "react";
import { Board } from "@/components/board";

export default function Home() {
  return (
    <Suspense fallback={<p className="py-16 text-center text-muted">Loading board…</p>}>
      <Board />
    </Suspense>
  );
}
