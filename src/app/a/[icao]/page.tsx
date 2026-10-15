import type { Metadata } from "next";
import { Suspense } from "react";
import { AirportView } from "@/components/airport-view";

export async function generateMetadata(props: PageProps<"/a/[icao]">): Promise<Metadata> {
  const { icao } = await props.params;
  return { title: `${icao.toUpperCase()} D-ATIS` };
}

async function Airport({ params }: { params: PageProps<"/a/[icao]">["params"] }) {
  const { icao } = await params;
  return <AirportView icao={icao.toUpperCase()} />;
}

export default function Page(props: PageProps<"/a/[icao]">) {
  return (
    <Suspense fallback={<p className="py-16 text-center text-muted">Loading…</p>}>
      <Airport params={props.params} />
    </Suspense>
  );
}
