"use client";

/* Node Runner's standalone cabinet (split from /gauntlet · operator
 * request 2026-07-08). Owns the ONE audio hook instance and the
 * bezel; TapeRunner stays in the gauntlet folder because it shares
 * the engine, the audio vocabulary, and the history loader. Exit
 * lands on /gauntlet · the arcade sibling. */

import { useRouter } from "next/navigation";
import { TapeRunner } from "@/app/gauntlet/TapeRunner";
import { useGauntletAudio } from "@/app/gauntlet/useGauntletAudio";

export function RunnerCabinet() {
  const router = useRouter();
  const audio = useGauntletAudio();
  return (
    // Phones (most of our traffic) get a full-bleed, chrome-free game: the
    // bezel + page padding made it feel "windowed" in a webpage. Edge to
    // edge below sm, the framed cabinet returns from sm up (2026-07-10).
    <div className="-mx-4 sm:mx-0 sm:rounded-xl sm:p-[1.5px] sm:bezel-metal sm:nb-seated">
      <div
        className="overflow-hidden sm:rounded-[11px]"
        style={{ background: "linear-gradient(180deg, #16100a 0%, #0a0605 60%)" }}
      >
        <TapeRunner onExit={() => router.push("/arcade")} audio={audio} />
      </div>
    </div>
  );
}
