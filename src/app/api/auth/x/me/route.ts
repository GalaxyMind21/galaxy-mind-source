// GET /api/auth/x/me · the viewer's link state, no-store.
//
// This is the ONLY per-viewer identity read. It must never share a
// cacheable response with board data: /api/arcade/scores rides a 30s
// CDN cache, so anything cookie-dependent leaking into it would show
// one viewer's link state to everyone. Static game pages (which cannot
// read the HttpOnly cookie) call this to decide whether to show a
// "linked as @handle" note.

import { NextResponse } from "next/server";
import {
  X_PROFILE_HASH,
  isXIdentityConfigured,
  readXSession,
  type XProfile,
} from "@/lib/arcade-identity";
import { kvHMGetChecked } from "@/lib/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const enabled = isXIdentityConfigured();
  const noStore = { "Cache-Control": "no-store" };
  if (!enabled) {
    return NextResponse.json({ enabled, linked: false }, { headers: noStore });
  }
  const session = readXSession(req.headers.get("cookie"));
  if (!session) {
    return NextResponse.json({ enabled, linked: false }, { headers: noStore });
  }
  // UNLINK DURABILITY (fixed 2026-07-25).
  //
  // Sessions are stateless 180-day HMAC cookies with no server-side
  // revocation, so `readXSession` alone cannot know the account was
  // unlinked. Unlink (POST /api/auth/x/logout {unlink:true}) DELETES the
  // profile field and the cloud-save hash — but a second device holding a
  // live cookie kept reporting linked:true, kept showing "Posting as
  // @handle ✓", and its next cloud sync re-created gm:cloud:save:{id}.
  // The deleted data came back minutes after the deletion request, and
  // would keep coming back for up to 180 days.
  //
  // The profile field is therefore the revocation signal: it is written
  // unconditionally at link time (see the callback), so "session valid but
  // profile absent" means unlinked. This one read propagates the unlink to
  // every cabinet at once with zero extra KV traffic.
  //
  // kvHMGetChecked, NOT kvHMGet: a transient KV read FAILURE must not be
  // read as "unlinked" (that would log everyone out during a blip and, via
  // the cloud route below, could look like a deletion). On read failure we
  // keep linked:true and just omit the display metadata — fail toward the
  // status quo, not toward a false unlink.
  const { ok, values } = await kvHMGetChecked<XProfile>(X_PROFILE_HASH, [
    session.userId,
  ]);
  const profile = values[0];
  if (ok && !profile) {
    return NextResponse.json({ enabled, linked: false }, { headers: noStore });
  }
  return NextResponse.json(
    {
      enabled,
      linked: true,
      handle: profile?.h ?? null,
      avatar: profile?.a ?? null,
    },
    { headers: noStore },
  );
}
