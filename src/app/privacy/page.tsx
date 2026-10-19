import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { OG_DIRECTORY } from "@/lib/og";

// Privacy policy (2026-07-29). Written against an actual inventory of
// what the code stores, NOT from a template — every claim below maps to
// a real KV key, env-gated feature, or third-party dependency:
//
//   sub:prefs:<email>        lib/subscribe-flow.ts
//   fit-alert:<email>        lib/fit-alert.ts
//   vendor-notify:<handle>:<slug>   api/submit-vendor (90d TTL · legacy vendor-notify:<handle> still read)
//   push:sub:<sha256(url)>   lib/push.ts
//   gm:arcade:xprofiles      lib/arcade-identity.ts  (XProfile = {h,a,t})
//   gm:cloud:save:<userId>   lib/arcade-cloud.ts
//   gm:chop:events:v1        api/chop/stats (capped list, no identifiers)
//   gm:lb:*                  api/arcade/score (public boards · handle + score)
//   ratelimit:<name>:<ip>    lib/rate-limit.ts       (short TTL, transient)
//   submission records       lib/vendor-submissions.ts (no IP stored)
//   gm:submission:notify-failed  lib/submission-notify.ts (capped list,
//                            handle + outcome code + send error · no address)
//   hashrate:open-count      api/cron/hashrate-available (integer count)
//   hashrate:last-notified-day  api/cron/hashrate-available (UTC day)
//   gm:vendor:signals        lib/vendor-queue.ts (probe observations, keyed by public handle)
//   gm:vendor:review-queue   lib/vendor-queue.ts (operator triage of changes)
//   gm:vendor:review-notified lib/vendor-queue.ts (handles already emailed about)
//   vendor:dormant:*         lib/vendor-dormancy.ts (quiet Nostr merchants)
//   gm:badge-outreach:v2     lib/badge-outreach.ts (handles already drafted a
//                            badge DM, so the daily drip does not repeat)
//   gm:badge-launch:v1       lib/badge-outreach-state.ts (7-day window for
//                            the public /badge launch post in daily drafts)
//
// If you add a data-collecting surface, update this page in the SAME
// commit. A privacy policy that drifts is worse than none — it is a
// false statement to users, and connector directories reject on it.
//
// Deliberately NOT claiming compliance with any specific regime
// (GDPR/CCPA/etc). We describe what we do plainly and offer deletion;
// asserting a certification we have not actually undergone would be the
// same category of dishonesty this file exists to avoid.

export const metadata: Metadata = {
  title: "Privacy · Galaxy Mind",
  description:
    "What Galaxy Mind collects, why, and how to delete it. No ads, no data sales, no cross-site tracking. Most of the site works with no data at all.",
  alternates: { canonical: "https://galaxymind.space/privacy" },
  // Declaring openGraph at all REPLACES the root layout's block whole,
  // so title/description/images have to be restated here even though
  // they echo the fields above. Without the block this page inherited
  // the root's `url: SITE_URL` and told every unfurler it was the
  // homepage while its canonical said /privacy (Ahrefs "Open Graph URL
  // not matching canonical", 2026-08-06). Same merge semantics that
  // made lib/og.ts necessary for images.
  openGraph: {
    type: "website",
    title: "Privacy · Galaxy Mind",
    description:
      "What Galaxy Mind collects, why, and how to delete it. No ads, no data sales, no cross-site tracking.",
    url: "https://galaxymind.space/privacy",
    images: OG_DIRECTORY,
  },
};

const UPDATED = "October 13, 2026";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-lg sm:text-xl font-semibold tracking-tight text-[var(--text-primary)] mb-3">
        {title}
      </h2>
      <div className="space-y-4 text-sm sm:text-base text-[var(--text-secondary)] leading-relaxed">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen flex-1 text-[var(--text-primary)]">
      <SiteHeader />

      <article className="max-w-2xl mx-auto px-6 pt-12 pb-20">
        <div className="micro-label text-[var(--text-tertiary)] mb-3">
          Privacy
        </div>
        <h1 className="display-title mb-6 text-[var(--text-primary)]">
          We collect{" "}
          <span className="text-[var(--accent-ink)] glow-text">
            almost nothing
          </span>
          , and we will tell you exactly what.
        </h1>

        <div className="space-y-5 text-sm sm:text-base text-[var(--text-secondary)] leading-relaxed">
          <p>
            Galaxy Mind is an independent project, not a business built on
            your data. There are no ads, no ad networks, no data brokers,
            and nothing here is sold or shared for marketing. You can use
            the directory, every instrument, and every game without giving
            us anything at all.
          </p>
          <p>
            Everything below describes the real system. If a feature is not
            listed, it does not collect anything.
          </p>
        </div>

        <Section title="Browsing the site">
          <p>
            The site works without an account or login. We do not set
            advertising or cross-site tracking cookies.
          </p>
          <p>
            We use{" "}
            <span className="text-[var(--text-primary)]">
              Vercel Web Analytics and Speed Insights
            </span>{" "}
            for aggregate page-view counts and page-performance timings.
            Vercel states these do not use cookies and do not track
            visitors across sites. We see totals and trends, not people.
          </p>
          <p>
            Some vendor cards fall back to{" "}
            <span className="text-[var(--text-primary)]">unavatar.io</span>{" "}
            to fetch a profile picture we have not yet snapshotted
            ourselves. When that happens your browser makes a request to
            that third party, which will see your IP address as it would
            for any image on the web. Most avatars are served from our own
            domain specifically to avoid this.
          </p>
        </Section>

        <Section title="If you subscribe to email alerts">
          <p>
            We store your email address, your alert preferences, and (if
            you opt into portfolio-change alerts) a snapshot of the
            allocation inputs those alerts are diffed against. Email is
            delivered through <span className="text-[var(--text-primary)]">Resend</span>.
          </p>
          <p>
            Subscriptions are double-opt-in: we send a confirmation link
            and store nothing durable until you click it. Every email
            carries a one-click unsubscribe, and you can change or drop any
            alert type at{" "}
            <Link
              href="/prefs"
              className="text-[var(--accent-ink)] underline underline-offset-4"
            >
              /prefs
            </Link>
            . Unsubscribing removes the contact.
          </p>
          <p>
            We never sell, rent, or share the list, and we do not use it
            for anything but the alerts you asked for. Joining the USA
            fleet waitlist on /hashrate opts you into one extra channel:
            an email when the number of open Galaxy Mind machines goes
            up, at most once a day. Nothing goes out while that count
            stays flat or falls. That is the only hashrate email. You
            can turn it off at /prefs.
          </p>
        </Section>

        <Section title="If you enable browser push alerts">
          <p>
            We store the push subscription your browser generates: an
            endpoint URL issued by your browser vendor and the keys needed
            to encrypt a message to it. That is what a push notification
            requires; it is not tied to an email address or a name.
            Turning the toggle off removes it.
          </p>
        </Section>

        <Section title="If you link an X account in the arcade">
          <p>
            Linking X is entirely optional. Every game works anonymously,
            and the leaderboards accept anonymous entries. If you do link,
            we store your X user ID, the{" "}
            <span className="text-[var(--text-primary)]">@handle</span>{" "}
            and profile image URL as they were at link time, and when you
            linked. Your session is an HttpOnly, signed cookie. We never
            receive your X password, and we cannot post as you.
          </p>
          <p>
            Linked players also get cross-device save sync: game progress
            (records, unlocks, stats) stored against your X user ID so it
            follows your login.
          </p>
          <p>
            <span className="text-[var(--text-primary)]">Unlinking deletes
            all of it</span>: the stored profile and the saved progress.
            That is the whole deletion story for the only
            personally-identifying data the arcade keeps.
          </p>
        </Section>

        <Section title="Anonymous gameplay stats in CHOP">
          <p>
            The arcade game{" "}
            <Link href="/chop" prefetch={false} className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">CHOP</Link>{" "}
            sends two anonymous events: one when the game loads, and one
            when a run ends. They record how the game was played — the
            difficulty, how long the run lasted, hits and misses, the
            grade, and whether the block was finished or abandoned.
          </p>
          <p>
            <span className="text-[var(--text-primary)]">There is no
            identifier of any kind.</span> No account, no cookie, no device
            ID, and never your arcade handle. Durations are rounded to five
            seconds and run counts are grouped into bands before anything
            leaves your device, and only the calendar day is recorded, not
            a timestamp. Two runs by one person are indistinguishable from
            two runs by two people — deliberately, because this measures
            the game and not the players.
          </p>
          <p>
            It exists so the game can be improved by evidence rather than
            guesswork (where people quit, which difficulty they choose,
            whether the tutorial helps). Turn it off any time under{" "}
            <span className="text-[var(--text-primary)]">Settings →
            Anonymous stats</span>{" "}
            in the game; the game then sends nothing. Because the events
            carry no identifier, there is nothing to look up or delete
            afterwards.
          </p>
        </Section>

        <Section title="If you submit a vendor">
          <p>
            We store what you type into the form: the merchant&apos;s
            handle, name, description, category, and any optional details
            like country, website, or Lightning address, plus any note you
            add for the reviewer. This is business information intended for
            publication, and approved entries become part of the public
            directory.
          </p>
          <p>
            The submit form requires an email address. We store it for up
            to 90 days and use it once, to tell you the outcome of your
            submission, whether it was listed or not. If the listing is
            accepted that message includes the verified-bitcoin badge for
            your shop. The address is deleted as soon as that message is
            sent, and it is never added to any mailing list. Operator-added
            listings (not submitted through the form) may have no address.
          </p>
          <p>
            We do not store your IP address with the submission. Rejected
            submissions are kept briefly for audit and then expire.
          </p>
          <p>
            Once a merchant is listed, a nightly job records whether their
            public shop and profile still resolve (
            <code className="text-[var(--text-primary)]">gm:vendor:signals</code>
            ), queues changes for the operator (
            <code className="text-[var(--text-primary)]">gm:vendor:review-queue</code>,{" "}
            <code className="text-[var(--text-primary)]">gm:vendor:review-notified</code>
            ), and may mark a quiet Nostr merchant dormant (
            <code className="text-[var(--text-primary)]">vendor:dormant:*</code>
            ). A daily drip also records which public handles have
            already been drafted a badge DM for the operator to send (
            <code className="text-[var(--text-primary)]">gm:badge-outreach:v2</code>
            ), so the same shop is not messaged twice, plus a short-lived
            flag for the public badge-launch post (
            <code className="text-[var(--text-primary)]">gm:badge-launch:v1</code>
            ). Those records are keyed by the merchant&apos;s public
            handle, never by a visitor, and they never write the public
            verified-at date.
          </p>
          <p>
            The form may be protected by{" "}
            <span className="text-[var(--text-primary)]">
              Cloudflare Turnstile
            </span>
            , a privacy-focused captcha, to keep out automated spam.
          </p>
        </Section>

        <Section title="IP addresses">
          <p>
            Some endpoints are rate-limited to keep floods and abuse from
            running up costs. That works by incrementing a short-lived
            counter keyed to your IP, which expires on its own within the
            rate-limit window. We do not log request histories against it,
            build profiles from it, or use it for analytics.
          </p>
          <p>
            The directory homepage reads the country our host derives from
            your IP for that one request, so a visitor outside the US can
            see which shops ship worldwide or are based nearby. The country
            is not stored or logged, and hiding the tip is remembered only
            in your browser.
          </p>
        </Section>

        <Section title="Data stored on your own device">
          <p>
            Game saves, streaks, dismissed banners, an unfinished shop
            submission on /submit (cleared when you submit or after 14
            days), and similar preferences live in your browser&apos;s
            local storage. They stay on your device unless you have
            linked X and enabled save sync, described above. Clearing your browser data clears them.
          </p>
          <p>
            Arcade leaderboards are different: when you post a score, we
            store the culture handle you typed (or your linked X identity)
            and that score in a capped public board. That is how a
            leaderboard works. Unlinking X deletes the stored profile; an
            anonymous row stays until the board expires.
          </p>
        </Section>

        <Section title="Who else touches the data">
          <p>
            The full list of processors, and nothing beyond it:{" "}
            <span className="text-[var(--text-primary)]">Vercel</span>{" "}
            (hosting, analytics),{" "}
            <span className="text-[var(--text-primary)]">Upstash</span>{" "}
            (the key-value store holding the records above),{" "}
            <span className="text-[var(--text-primary)]">Resend</span>{" "}
            (email delivery),{" "}
            <span className="text-[var(--text-primary)]">Cloudflare</span>{" "}
            (captcha), and{" "}
            <span className="text-[var(--text-primary)]">X</span> (only if
            you choose to link an account).
          </p>
          <p>
            Galaxy Mind never handles payments. We do not take orders, hold
            funds, or process transactions. When you buy from a merchant
            in the directory, that happens entirely between you and them.
            We have no payment details to lose.
          </p>
        </Section>

        <Section title="Deleting your data">
          <p>
            Email: unsubscribe from any message or at{" "}
            <Link
              href="/prefs"
              className="text-[var(--accent-ink)] underline underline-offset-4"
            >
              /prefs
            </Link>
            . Push: turn the toggle off. X identity and game saves: unlink
            in the arcade.
          </p>
          <p>
            For anything else, or if you want confirmation that something
            is gone, message{" "}
            <a
              href="https://x.com/GalaxyMind"
              className="text-[var(--accent-ink)] underline underline-offset-4"
              target="_blank"
              rel="noopener noreferrer"
            >
              @GalaxyMind on X
            </a>{" "}
            or{" "}
            <a
              href="https://njump.me/nprofile1qqspwnkez659yrnzx2fu4kzpngtkak7v3sdpuh6jw83key38xru5wrcny0sdm"
              className="text-[var(--accent-ink)] underline underline-offset-4"
              target="_blank"
              rel="noopener noreferrer"
            >
              on Nostr
            </a>
            . It is one person reading them, so it will not be instant, but
            it will be honest.
          </p>
        </Section>

        <Section title="Children">
          <p>
            Galaxy Mind is not directed at children and we do not knowingly
            collect data from anyone under 13.
          </p>
        </Section>

        <Section title="Changes">
          <p>
            If this policy changes materially, the date below changes with
            it. There is no version where we quietly start collecting more
            than this page describes.
          </p>
          <p className="t-xs font-medium text-[var(--text-tertiary)] pt-2">
            Last updated {UPDATED}
          </p>
        </Section>
      </article>
    </main>
  );
}
