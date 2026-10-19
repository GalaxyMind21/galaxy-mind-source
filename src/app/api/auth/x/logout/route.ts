// POST /api/auth/x/logout · clears the arcade X session. With
// {"unlink": true} it ALSO deletes the stored profile metadata from the
// KV hash — the deletion story for the only quasi-PII this feature
// keeps (X Developer Policy: stored profile data must be removable).
// Board rows keyed x:{userId} then render as unlinked until the row
// ages off its TTL.
//
// POST-only on purpose (the GET→confirm / POST→mutate discipline from
// the unsubscribe audit): a prefetched link must never log someone out.

import { NextResponse } from "next/server";
import {
  X_PROFILE_HASH,
  readXSession,
  sessionClearCookies,
} from "@/lib/arcade-identity";
import { cloudKey } from "@/lib/arcade-cloud";
import { kvDel, kvHDel } from "@/lib/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const secure = url.protocol === "https:";
  const session = readXSession(req.headers.get("cookie"));
  if (session) {
    let unlink = false;
    try {
      const j = (await req.json()) as { unlink?: boolean };
      unlink = j?.unlink === true;
    } catch {
      /* empty body = plain logout */
    }
    if (unlink) {
      await kvHDel(X_PROFILE_HASH, session.userId);
      // the deletion story extends to cloud-saved game progress
      await kvDel(cloudKey(session.userId));
    }
  }
  const res = NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
  for (const c of sessionClearCookies(secure)) res.headers.append("Set-Cookie", c);
  return res;
}
