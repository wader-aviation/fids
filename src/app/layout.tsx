import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "FIDS", template: "%s · FIDS" },
  description: "Open-source flight information board: departures, arrivals, decoded D-ATIS, METAR/TAF and NOTAMs from open data.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <header className="border-b border-line">
          <nav className="mx-auto flex max-w-[1500px] items-center gap-4 px-4 py-3">
            <Link href="/" className="font-mono text-sm font-semibold tracking-wide">
              FIDS
            </Link>
            <span className="text-xs text-muted">Flights, ATIS and conditions from open data</span>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-5">{children}</main>
        <footer className="border-t border-line">
          <div className="mx-auto max-w-[1500px] px-4 py-4 text-xs text-muted">
            <p>
              <strong className="text-warn">Not for operational use.</strong> D-ATIS only reaches us when an aircraft requests
              it, so airports can be missing or out of date. Always confirm with official sources.
            </p>
            <p className="mt-1">
              Data provided by{" "}
              <a href="https://airframes.io" className="underline hover:text-fg">
                Airframes.io
              </a>{" "}
              and its community of feeders. Weather from aviationweather.gov. Airports from OurAirports. Open source (MIT).
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
