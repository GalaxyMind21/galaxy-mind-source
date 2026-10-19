/**
 * Vercel Cron entry for the phase2 rentals sweep (every 5 min). Same handler, auth
 * (constant-time CRON_SECRET, checked before the failed-auth limiter) and behaviour as
 * /api/rentals/sweep; this path exists so the cron-health drift guard and dashboard see it.
 */
import { GET as sweep } from "@/app/api/rentals/sweep/route";
import { recordCronRun } from "@/lib/cron-health";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const res = await sweep(req);
  if (res.status === 200) await recordCronRun("rentals-sweep");
  return res;
}
