import { runIngest } from "@/lib/ingest/run";
import { runMovementIngest } from "@/lib/ingest/movements";

export const maxDuration = 60;

// Vercel Cron calls this every minute with `Authorization: Bearer $CRON_SECRET`.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const [atis, movements] = await Promise.allSettled([runIngest(), runMovementIngest()]);
  const out = (r: PromiseSettledResult<unknown>) => (r.status === "fulfilled" ? r.value : { error: String(r.reason) });
  return Response.json({ atis: out(atis), movements: out(movements), ms: Date.now() - started });
}
