"use client";

/* =====================================================================
 * ArcadeScoreboard · the public board under each arcade cabinet
 * (operator request 2026-07-09).
 *
 * Anonymous by construction: rows are culture handles minted by
 * lib/arcade, never anything a player typed. Your own handle row
 * lights up when you make the top 20, and the "new name" control
 * rerolls your identity (past board rows keep the old name · the
 * board stores handles, not devices).
 *
 * Optional X identity (2026-07-14): when the OAuth env vars are set,
 * a Link X control appears; linked players' rows wear their real
 * @handle + avatar + ✓ (server-verified · only the account owner can
 * post under it). Anonymous play stays the default and the whole
 * affordance hides when the feature is unconfigured.
 * ===================================================================== */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  type ArcadeGame,
  type ArcadeIdentity,
  type Board,
  type BoardRow,
  fetchBoard,
  fetchIdentity,
  getHandle,
  rerollHandle,
  unlinkIdentity,
} from "@/lib/arcade";
import { isLegendaryHandle } from "@/lib/arcade-easter-eggs";
import {
  formatHorizonScore,
  formatRunnerScore,
  formatWenScore,
} from "@/lib/arcade-score";
import { gauntletNumber } from "@/lib/gauntlet-day";

const ACCENT = "#F7931A";

type BoardView = "today" | "all";

function formatScore(game: ArcadeGame, score: number): string {
  if (game === "gauntlet") {
    const v = Math.round(score * 10) / 10;
    return `${v >= 0 ? "+" : ""}${v.toFixed(1)}% vs bot`;
  }
  if (game === "horizon") {
    return formatHorizonScore(score);
  }
  if (game === "wen" || game === "trail") {
    return formatWenScore(score); // plain integer sats on both boards
  }
  return formatRunnerScore(score);
}

export function ArcadeScoreboard({
  game,
  title,
  daily = false,
  verified = false,
}: {
  game: ArcadeGame;
  title: string;
  // When set, offer a Today / All-time toggle. Today's board is keyed by
  // the daily tape seed (gauntlet number) · the same run for everyone
  // this UTC day, so it's the fair head-to-head. Only the runner boards
  // are daily-seeded today.
  daily?: boolean;
  // Set on the replay-verified boards (WEN + Gauntlet · the API re-sims
  // every submission before it lands · lib/arcade-replay). Renders a
  // small honesty line under the rows.
  verified?: boolean;
}) {
  const pathname = usePathname() ?? "/arcade";
  const [board, setBoard] = useState<Board | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [handle, setHandle] = useState<string | null>(null);
  // Optional X identity · {enabled:false} until the no-store probe
  // answers, so the link affordance never flashes on unconfigured sites.
  const [identity, setIdentity] = useState<ArcadeIdentity>({ enabled: false, linked: false });
  // One-shot feedback for a returning OAuth bounce (?xlink=<reason> set
  // by /api/auth/x/callback) · success needs no note (the linked footer
  // says it), failures deserve one line instead of silence.
  const [linkNote, setLinkNote] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  // Default to Today when daily · the live competition is the hook;
  // the all-time hall of fame is one tap away.
  const [view, setView] = useState<BoardView>(daily ? "today" : "all");

  const aliveRef = useRef(true);
  // Request stamp so only the NEWEST in-flight board may paint
  // (fixed 2026-07-25). aliveRef alone was not enough: toggling
  // Today/All-time fires a second fetch to a DIFFERENT URL (different KV
  // key, different CDN entry), the two are unordered, and the effect
  // re-arms aliveRef to true on every run — so a late response from the
  // view the user just left could overwrite the board they now want.
  // aliveRef stays for the unmount guards (fetchIdentity + the
  // timer-driven load()); this only orders the board writes.
  const reqIdRef = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqIdRef.current;
    const b = await fetchBoard(
      game,
      daily && view === "today" ? gauntletNumber(Date.now()) : undefined,
    );
    if (!aliveRef.current || id !== reqIdRef.current) return;
    setBoard(b);
    setLoaded(true);
  }, [game, daily, view]);

  useEffect(() => {
    aliveRef.current = true;
    setHandle(getHandle());
    void load();
    void fetchIdentity().then((id) => {
      if (aliveRef.current) setIdentity(id);
    });
    // consume the OAuth bounce flag, then scrub it from the URL so a
    // refresh or share never replays the message
    try {
      const params = new URLSearchParams(window.location.search);
      const flag = params.get("xlink");
      if (flag) {
        const NOTES: Record<string, string> = {
          cancelled: "X link cancelled · you are still playing anonymously.",
          expired: "That link attempt expired · tap Link X to try again.",
          failed: "X did not complete the link · try again in a moment.",
          refused: "That X handle can not be shown on the public boards.",
          off: "X linking is not available right now.",
        };
        // hasOwnProperty, NOT a truthy index (fixed 2026-07-25):
        // `?xlink=__proto__` makes NOTES[flag] resolve to
        // Object.prototype and `?xlink=constructor` to Object — both
        // truthy non-strings, so setLinkNote() stored an object and
        // rendering it threw "Objects are not valid as a React child",
        // blanking the whole scoreboard from a URL param. Real flags are
        // all own properties, so this changes nothing for them.
        if (Object.prototype.hasOwnProperty.call(NOTES, flag)) {
          setLinkNote(NOTES[flag]);
        }
        params.delete("xlink");
        const qs = params.toString();
        window.history.replaceState(
          null,
          "",
          window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash,
        );
      }
    } catch {
      /* URL APIs unavailable · skip the note */
    }
    // A finished run posts fire-and-forget, then nudges the board ·
    // one refetch after the CDN's 30s window keeps it feeling live
    // without polling forever. The timer is cleared on unmount so a
    // score event just before navigation can't setState after unmount.
    let timer: number | undefined;
    const onScore = () => {
      timer = window.setTimeout(() => void load(), 1200);
    };
    window.addEventListener("gm:arcade-score", onScore);
    return () => {
      aliveRef.current = false;
      window.clearTimeout(timer);
      window.removeEventListener("gm:arcade-score", onScore);
    };
  }, [load]);

  const rows = board?.rows ?? [];

  return (
    <section
      aria-label={title}
      className="mt-8 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 elevate"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="micro-label text-[var(--accent-ink)]">
          {title}
        </h2>
        {board != null && board.total > 0 && (
          <span className="micro-label text-[var(--text-tertiary)] tabular-nums">
            {board.total} on the board
          </span>
        )}
      </div>

      {daily && (
        <div
          role="tablist"
          aria-label="Leaderboard window"
          className="mb-3 inline-flex rounded-lg border border-[var(--border-subtle)] p-0.5"
        >
          {(
            [
              ["today", "Today"],
              ["all", "All-time"],
            ] as [BoardView, string][]
          ).map(([v, label]) => {
            const active = view === v;
            return (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setView(v);
                  setExpanded(false);
                }}
                className="micro-label rounded-md px-3 py-1 transition-colors"
                style={
                  active
                    ? { background: "rgba(247,147,26,0.14)", color: ACCENT }
                    : { color: "var(--text-tertiary)" }
                }
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {!loaded ? (
        <p className="text-sm text-[var(--text-tertiary)]">Reading the board…</p>
      ) : board == null || board.configured === false ? (
        <p className="text-sm text-[var(--text-tertiary)] leading-relaxed">
          The board is not reachable right now. Scores still count ·
          they post as soon as it wakes.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
          {daily && view === "today"
            ? "Be the first on today's tape. Same run for everyone until UTC midnight · finish one and you take the top slot."
            : "Nobody on the board yet. Finish a run and your handle takes the top slot."}
        </p>
      ) : (
        (() => {
          const COLLAPSED = 5;
          // Always keep the player's own row visible even when collapsed ·
          // seeing where you stand is the whole point. A linked player's
          // row wears their @handle, so match on that first.
          const myName =
            identity.linked && identity.handle ? `@${identity.handle}` : handle;
          const myIdx =
            myName != null ? rows.findIndex((r) => r.name === myName) : -1;
          const visible =
            expanded || rows.length <= COLLAPSED
              ? rows
              : rows.slice(0, COLLAPSED);
          const showMine = !expanded && myIdx >= COLLAPSED;
          return (
            <>
              <ol className="space-y-1">
                {visible.map((r, i) => (
                  <BoardRowLi
                    key={`${r.name}-${i}`}
                    rank={i + 1}
                    row={r}
                    mine={myName != null && r.name === myName}
                    game={game}
                  />
                ))}
                {showMine && (
                  <>
                    <li
                      aria-hidden
                      className="px-3 font-mono t-xs text-[var(--text-tertiary)]"
                    >
                      ···
                    </li>
                    <BoardRowLi
                      rank={myIdx + 1}
                      row={rows[myIdx]}
                      mine
                      game={game}
                    />
                  </>
                )}
              </ol>
              {rows.length > COLLAPSED && (
                <button
                  type="button"
                  onClick={() => setExpanded((e) => !e)}
                  aria-expanded={expanded}
                  className="micro-label mt-2 text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
                >
                  {expanded
                    ? "Show less"
                    : `Show full board · ${board.total} player${board.total === 1 ? "" : "s"} →`}
                </button>
              )}
            </>
          );
        })()
      )}

      {verified && (
        <p className="mt-3 font-mono t-xs uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
          ⛓ Replay-verified · every score here was re-simulated
          server-side before it landed
        </p>
      )}

      {linkNote && (
        <p className="mt-3 t-xs text-[var(--warning)]" role="status">
          {linkNote}
        </p>
      )}

      {handle != null && (
        <div className="mt-4 pt-3 border-t border-[var(--border-subtle)] flex flex-wrap items-baseline justify-between gap-2">
          {identity.linked ? (
            <>
              <span className="t-xs text-[var(--text-tertiary)]">
                Posting as{" "}
                <span className="font-medium text-[var(--text-secondary)]">
                  @{identity.handle ?? "linked"}
                </span>
                {" "}
                <span aria-hidden style={{ color: ACCENT }}>✓</span>
                {" "}· your X handle and avatar appear on public boards.
              </span>
              <button
                type="button"
                onClick={() => {
                  void unlinkIdentity(true).then(() =>
                    setIdentity({ enabled: true, linked: false }),
                  );
                }}
                className="micro-label text-[var(--text-tertiary)] hover:text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
              >
                Unlink X
              </button>
            </>
          ) : (
            <>
              <span className="t-xs text-[var(--text-tertiary)]">
                You play as{" "}
                <span className="font-medium text-[var(--text-secondary)]">
                  {handle}
                </span>
                {" "}· assigned at random{identity.enabled
                  ? ". Playing anonymously keeps everything in this browser."
                  : ", nothing about you leaves this browser."}
              </span>
              <span className="flex items-baseline gap-3">
                {identity.enabled && (
                  <a
                    href={`/api/auth/x/start?return=${encodeURIComponent(pathname)}`}
                    className="micro-label text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
                    title="Claim your board rows with your own X handle · only you can post under it"
                  >
                    Link X ↗
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setHandle(rerollHandle())}
                  className="micro-label text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
                >
                  New name
                </button>
              </span>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function BoardRowLi({
  rank,
  row,
  mine,
  game,
}: {
  rank: number;
  row: BoardRow;
  mine: boolean;
  game: ArcadeGame;
}) {
  // A quiet wink · a few culture-heavy handles glow on the board.
  const legendary = isLegendaryHandle(row.name);
  return (
    <li
      className="flex items-baseline gap-3 rounded-lg px-3 py-1.5"
      style={mine ? { background: "rgba(247,147,26,0.10)" } : undefined}
    >
      <span
        className="font-mono t-xs tabular-nums w-7 shrink-0"
        style={{ color: rank <= 3 ? ACCENT : "var(--text-tertiary)" }}
      >
        {rank}.
      </span>
      {/* Name + score · stacked on phones (the culture handles are long
          and the runner score string is wide, so a single row squeezed
          names to ~60px), single row from sm up. min-w-0 lets the name
          truncate cleanly instead of overflowing (2026-07-10). */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
        <span
          className="flex min-w-0 items-center gap-1.5 truncate text-sm font-medium"
          style={{
            color: mine ? ACCENT : legendary ? "#FFD9A0" : "var(--text-primary)",
            textShadow: legendary ? "0 0 10px rgba(247,147,26,0.7)" : undefined,
          }}
        >
          {row.verified && row.avatar && (
            // eslint-disable-next-line @next/next/no-img-element -- external
            // pbs.twimg.com avatars rot when users change them; a plain img
            // with onError removal degrades to text instead of a broken icon
            <img
              src={row.avatar}
              alt=""
              width={16}
              height={16}
              className="h-4 w-4 shrink-0 rounded-full"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          )}
          <span className="truncate">
            {legendary ? "✦ " : ""}
            {row.name}
            {mine ? " · you" : ""}
          </span>
          {row.verified && (
            <span
              aria-label="X-linked account"
              title="X-linked · only the owner of this X account can post under it"
              className="shrink-0 font-mono t-xs"
              style={{ color: ACCENT }}
            >
              ✓
            </span>
          )}
        </span>
        <span className="shrink-0 font-mono t-xs tabular-nums text-[var(--text-secondary)] sm:ml-auto">
          {formatScore(game, row.score)}
        </span>
      </div>
    </li>
  );
}
