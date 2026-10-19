// /prefs?token=… · subscriber-facing preferences editor.
//
// Linked from every alert email's footer next to the Unsubscribe
// link · the operator audit flagged "I want to flip one opt-in
// without re-subscribing" as a real UX gap. Until this page, the
// only way an existing subscriber could change a notification
// channel was to sign up again from scratch.
//
// Client-rendered · the token comes from the URL, the page fetches
// /api/prefs?token=… on mount, renders a form, POSTs changes back.
// The /api/prefs route reuses the same stateless HMAC token as
// /unsubscribe so there's no new credential to manage.

import { Suspense } from "react";
import { PrefsClient } from "./PrefsClient";

export const metadata = {
  title: "Alert preferences · Galaxy Mind",
  robots: { index: false, follow: false },
};

export default function PrefsPage() {
  return (
    <main className="min-h-screen flex-1">
      <section className="max-w-2xl mx-auto px-4 sm:px-6 pt-10 sm:pt-12 pb-24">
        <div className="t-xs font-medium text-[var(--text-tertiary)] mb-3">
          Subscription
        </div>
        <h1 className="display-title text-[var(--text-primary)] mb-2">
          Alert preferences.
        </h1>
        <p className="text-[var(--text-secondary)] text-sm sm:text-base leading-relaxed mb-8">
          Pick the channels you actually want. Changes save instantly
          and apply to the next cron run · no re-subscribe needed.
        </p>
        <Suspense
          fallback={
            <p className="text-sm text-[var(--text-tertiary)]">Loading…</p>
          }
        >
          <PrefsClient />
        </Suspense>
      </section>
    </main>
  );
}
