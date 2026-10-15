# D-ATIS Board

Open-source D-ATIS (digital ATIS over ACARS) board for airline operations control and dispatch.
It decodes ATIS into runways, approaches, weather and ops flags, tracks every letter change, and
exposes a JSON API.

> **Not for operational use.** D-ATIS only reaches us when an aircraft requests it, so some airports
> will be missing or stale.

Data provided by [Airframes.io](https://airframes.io) and its community of feeders.

## How it works

1. **Ingest** — a Vercel Cron job (`/api/cron/ingest`, every minute) pulls new ACARS messages from the
   Airframes API: all label `A9` (ATIS uplinks) plus `RA`/`HX` that mention ATIS. Raw messages are kept 7 days.
2. **Assemble** — long ATIS arrive in several ACARS blocks; blocks from the same aircraft are joined.
   Repeats of the same ATIS (same airport, type, letter, issue time) are merged; the complete, longest text wins.
3. **Decode** — `src/lib/decoder` turns the text into structured fields: wind, visibility, clouds, ceiling,
   temperature, QNH, transition level, approaches, arrival/departure runways, RWYCC, flight category and ops
   flags (runway closed, LVP, windshear, navaid out, GNSS interference, …).
4. **Diff** — each new letter is compared with the previous one for the same airport and type.

## Screens

- **Board** (`/`) — one row per airport: ARR/DEP letter and age, runways, approach, wind with worst
  crosswind/tailwind against your limits, visibility/ceiling with flight category, QNH, ops flags.
  Rows flash when a letter changes. Add airports by code or paste a route (`LPPT-KJFK ALT KBOS`).
  Boards live in the URL (`/?a=KJFK,KBOS&xw=25&tw=10`), can be saved by name in the browser,
  and `&tv=1` gives a wall display.
- **Airport** (`/a/KJFK`) — decoded ARR and DEP cards, 24h letter timeline, "what changed since" any
  earlier letter, wind components per runway, full text, METAR and TAF.

## API

All JSON, CORS open. API keys and rate limits come later.

| Endpoint | Returns |
|----------|---------|
| `GET /api/v1/atis?icao=KJFK,LIS` | Latest ARR/DEP ATIS per airport (all recent airports without `icao`) |
| `GET /api/v1/atis/{icao}?hours=24` | Current ATIS plus every issue in the window (max 72h), each with its diff |
| `GET /api/v1/airports?q=lisb` | Airport search; `?resolve=LIS-JFK ALT BOS` turns codes into ICAO |
| `GET /api/v1/wx/{icao}` | Latest METAR and TAF |

Without `DATABASE_URL` the app runs on a live in-memory feed straight from Airframes (first load
takes ~30s). That is for development only.

## Develop

```bash
npm install
cp .env.example .env.local   # set DATABASE_URL and CRON_SECRET
npm run db:push              # create tables
npm run dev
npm test
```

Try the decoder on live data without a database:

```bash
npx tsx scripts/dry-run.mts
```

Trigger one ingest locally:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/ingest
```

## Layout

| Path | What |
|------|------|
| `src/lib/decoder/` | Pure ATIS decoder + diff, with tests on real messages |
| `src/lib/airframes/client.ts` | Airframes `/v1/messages` client (paging, 429 retry) |
| `src/lib/ingest/` | Block stitching, merge, and the cron ingest |
| `src/db/schema.ts` | Postgres tables (Drizzle) |

## License

MIT. Airframes data is subject to the [Airframes API terms](https://docs.airframes.io/api/licensing).
