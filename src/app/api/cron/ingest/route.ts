import { runIngest } from "@/lib/ingest/run";

export const maxDuration = 60;

// Vercel Cron calls this every minute with `Authorization: Bearer $CRON_SECRET`.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const result = await runIngest();
  return Response.json({ ...result, ms: Date.now() - started });
}
