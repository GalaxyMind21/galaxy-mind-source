"use client";

// SubmitForm · the interactive vendor onboarding form on /submit.
//
// UX flow (the whole point):
//   1. Vendor lands · single big "Paste your handle" input is focused
//   2. They paste their handle (X username, npub1.../nprofile1...,
//      name@domain.tld for NIP-05 or Lightning Address)
//   3. onBlur fires /api/enrich-handle · server queries Nostr relays
//      + LNURL endpoints + NIP-05 well-known files in parallel
//   4. ~1-3s later, fields auto-populate: name, description, Lightning
//      Address, website. Detected platform shows next to handle.
//   5. Vendor reviews + fills in country (searchable) + category (button
//      group). Description editable as plain text. Optional fields
//      hidden under "Add more details" disclosure.
//   6. Submit → POST /api/submit-vendor → success screen with thanks
//
// Why client-component + server-side enrichment: vendors' NIP-05
// domains often don't set CORS, so direct browser → relay/well-known
// fetches break. The /api/enrich-handle proxy on our origin handles
// it cleanly and lets us cache.

import { useEffect, useMemo, useRef, useState } from "react";
import Script from "next/script";
import { track } from "@vercel/analytics";
import {
  COUNTRIES,
  CATEGORY_LABELS,
  type Vendor,
  type VendorCategory,
} from "@/lib/vendors";
import { ISO_COUNTRY_NAMES, flagFor } from "@/lib/iso-countries";
import { VendorCard } from "@/components/VendorCard";
import { SubmitSuccessCrossSell } from "./SubmitSuccessCrossSell";
import { normalizeWebsiteInput } from "@/lib/website-input";
import {
  assessSubmitGuard,
  hasBaitLanguage,
  isConsumerMailHandle,
  mentionsBitcoin,
  normalizeHandle as guardNormalizeHandle,
} from "@/lib/submit-guard";
import { useT } from "@/components/LocaleProvider";

const TURNSTILE_SITE_KEY: string | undefined =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

type EnrichResult = {
  detectedPlatform: "x" | "nostr" | "lightning" | "ambiguous";
  name?: string;
  description?: string;
  lightningAddress?: string;
  website?: string;
  nip05?: string;
  picture?: string;
  source?: "nostr_kind0" | "lnurl_pay" | "none";
  notes?: string[];
};

const CATEGORIES: VendorCategory[] = [
  "apparel",
  "general-goods",
  "hardware",
  "consumables",
  "collectibles",
  "services",
  "books",
];

// Pre-sort countries by label for the dropdown · stable order across
// renders so the user's mental map of "where's Germany in the list"
// doesn't shift.
//
// TWO GROUPS, on purpose (2026-08-20). This list used to be built from
// COUNTRIES alone, which holds ONLY countries that already have a vendor —
// so a merchant from country #21 could not state their country at all.
// /api/submit-vendor has always accepted any /^[A-Z]{2}$/, so the ceiling
// was this dropdown, not the backend.
//
// COUNTRIES is NOT widened to fix it: it also drives the country filter
// pills, the map dots, and generateStaticParams for the 20
// /spend-bitcoin-in/[country] hub pages, and ~250 rows there would stand up
// hundreds of empty hubs. So the in-directory 20 stay on top (the common
// case, one scroll away) and the full ISO table follows underneath.
const IN_DIRECTORY_COUNTRIES = Object.entries(COUNTRIES)
  .map(([code, info]) => ({ code, label: info.label, flag: info.flag }))
  .sort((a, b) => a.label.localeCompare(b.label));

const OTHER_COUNTRIES = Object.entries(ISO_COUNTRY_NAMES)
  .filter(([code]) => !(code in COUNTRIES))
  .map(([code, label]) => ({ code, label, flag: flagFor(code) }))
  .sort((a, b) => a.label.localeCompare(b.label));

// Same normalizeHandle as lib/submit-guard (and the API). Run on
// every keystroke/paste so a novice SEES the fix: a leading "@"
// won't stick, and a pasted x.com/twitter.com URL collapses to the
// username. The server re-normalizes — this is instant feedback.
function normalizeHandle(raw: string): string {
  return guardNormalizeHandle(raw);
}

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; message: string }
  | { kind: "error"; errors: string[] };

// ── In-progress draft (2026-10-05) ──────────────────────────────────
// Shop owners fill this form in pieces: paste the handle, leave to copy
// the checkout URL or an email, come back. On mobile the tab is often
// reloaded or evicted in between, and every field was lost. 30-day
// Vercel data before this shipped: mobile /submit 44 visitors, 6
// auto-fills (11 auto-fill events, so people were re-pasting), 2
// submissions; desktop 52 / 11 / 6. The draft lives only in this
// browser's localStorage, expires after DRAFT_TTL_MS, and is cleared
// on a successful submit. The bitcoin attestation, honeypot, and
// Turnstile token are never stored · the attestation is re-ticked
// on purpose each visit.
const DRAFT_KEY = "gm:submit-draft:v1";
const DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

type SubmitDraft = {
  savedAt: number;
  handle: string;
  platform: "x" | "nostr" | "lightning" | "";
  name: string;
  description: string;
  country: string;
  category: VendorCategory | "";
  founderName: string;
  website: string;
  lightningAddress: string;
  shipsInternational: boolean;
  submitterNote: string;
  notifyEmail: string;
};

function readDraft(): SubmitDraft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<SubmitDraft>;
    if (typeof d.savedAt !== "number" || Date.now() - d.savedAt > DRAFT_TTL_MS) {
      window.localStorage.removeItem(DRAFT_KEY);
      return null;
    }
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    const platform = ["x", "nostr", "lightning"].includes(str(d.platform))
      ? (d.platform as SubmitDraft["platform"])
      : "";
    const category = (CATEGORIES as string[]).includes(str(d.category))
      ? (d.category as VendorCategory)
      : "";
    return {
      savedAt: d.savedAt,
      handle: str(d.handle),
      platform,
      name: str(d.name),
      description: str(d.description).slice(0, 300),
      country: /^[A-Z]{2}$/.test(str(d.country)) ? str(d.country) : "",
      category,
      founderName: str(d.founderName).slice(0, 60),
      website: str(d.website),
      lightningAddress: str(d.lightningAddress),
      shipsInternational: d.shipsInternational === true,
      submitterNote: str(d.submitterNote).slice(0, 500),
      notifyEmail: str(d.notifyEmail).slice(0, 254),
    };
  } catch {
    return null;
  }
}

function clearDraft() {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Storage blocked (private mode, quota) · nothing to clear.
  }
}

export function SubmitForm() {
  const { t } = useT();
  // Form fields
  const [handle, setHandle] = useState("");
  const [platform, setPlatform] = useState<"x" | "nostr" | "lightning" | "">("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [country, setCountry] = useState("");
  const [category, setCategory] = useState<VendorCategory | "">("");

  // Optional · revealed via disclosure
  const [showOptional, setShowOptional] = useState(false);
  const [founderName, setFounderName] = useState("");
  const [website, setWebsite] = useState("");
  const [lightningAddress, setLightningAddress] = useState("");
  const [shipsInternational, setShipsInternational] = useState(false);
  const [submitterNote, setSubmitterNote] = useState("");
  // Required outcome mailbox (2026-08-23). One-shot vendor-notify
  // key, never a list, never published. Independent of alerts.
  const [notifyEmail, setNotifyEmail] = useState("");
  // Honeypot · real users never fill this; bots that auto-fill all
  // inputs do. The server silently drops submissions with this set.
  const [honeypot, setHoneypot] = useState("");
  // Required attestation · the directory's product is bitcoin
  // checkout, not "a shop exists". Server re-checks the boolean.
  const [acceptsBitcoin, setAcceptsBitcoin] = useState(false);

  // Turnstile (lazy-loaded like the subscribe forms). We only render
  // the widget once the user has engaged with the form (on first focus
  // of a main field or on submit attempt). This keeps the third-party
  // script cost off the critical path for casual visitors.
  const [turnstileActivated, setTurnstileActivated] = useState(false);
  const [turnstileReady, setTurnstileReady] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);

  // Render (or re-render) the explicit Turnstile widget when it becomes
  // ready and the container exists. This is the same explicit-render
  // pattern used by AlertSubscribe and InlineSubscribePrompt.
  useEffect(() => {
    if (
      !TURNSTILE_SITE_KEY ||
      !turnstileActivated ||
      !turnstileReady ||
      !turnstileContainerRef.current ||
      turnstileWidgetIdRef.current
    ) {
      return;
    }

    if (typeof window === "undefined" || !(window as any).turnstile) return;

    try {
      turnstileWidgetIdRef.current = (window as any).turnstile.render(
        turnstileContainerRef.current,
        {
          sitekey: TURNSTILE_SITE_KEY,
          theme: "dark",
          size: "flexible",
          callback: (token: string) => setTurnstileToken(token),
          "error-callback": () => setTurnstileToken(null),
          "expired-callback": () => setTurnstileToken(null),
        }
      );
    } catch {
      // Widget failed to render; user can still try to submit and will
      // get a clear error from the server if Turnstile is required.
    }
  }, [turnstileActivated, turnstileReady]);

  // ── Draft restore + autosave ──────────────────────────────────────
  // `draftHydrated` gates the save effect so the empty first render
  // never overwrites a stored draft before the restore has run.
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  useEffect(() => {
    const d = readDraft();
    if (d) {
      setHandle(d.handle);
      setPlatform(d.platform);
      setName(d.name);
      setDescription(d.description);
      setCountry(d.country);
      setCategory(d.category);
      setFounderName(d.founderName);
      setWebsite(d.website);
      setLightningAddress(d.lightningAddress);
      setShipsInternational(d.shipsInternational);
      setSubmitterNote(d.submitterNote);
      setNotifyEmail(d.notifyEmail);
      if (
        d.founderName ||
        d.lightningAddress ||
        d.shipsInternational ||
        d.submitterNote
      ) {
        setShowOptional(true);
      }
      setDraftRestored(true);
      track("vendor_submit_draft_restored", { hasHandle: d.handle.length > 0 });
    }
    setDraftHydrated(true);
  }, []);

  useEffect(() => {
    if (!draftHydrated) return;
    const draft: SubmitDraft = {
      savedAt: Date.now(),
      handle,
      platform,
      name,
      description,
      country,
      category,
      founderName,
      website,
      lightningAddress,
      shipsInternational,
      submitterNote,
      notifyEmail,
    };
    const empty =
      !handle.trim() &&
      !name.trim() &&
      !description.trim() &&
      !country &&
      !category &&
      !founderName.trim() &&
      !website.trim() &&
      !lightningAddress.trim() &&
      !shipsInternational &&
      !submitterNote.trim() &&
      !notifyEmail.trim();
    try {
      if (empty) window.localStorage.removeItem(DRAFT_KEY);
      else window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Storage blocked (private mode, quota) · the form still works.
    }
  }, [
    draftHydrated,
    handle,
    platform,
    name,
    description,
    country,
    category,
    founderName,
    website,
    lightningAddress,
    shipsInternational,
    submitterNote,
    notifyEmail,
  ]);

  function startOver() {
    clearDraft();
    setHandle("");
    setPlatform("");
    setName("");
    setDescription("");
    setCountry("");
    setCategory("");
    setFounderName("");
    setWebsite("");
    setLightningAddress("");
    setShipsInternational(false);
    setSubmitterNote("");
    setNotifyEmail("");
    setAcceptsBitcoin(false);
    setShowOptional(false);
    setEnrichState({ kind: "idle" });
    lastEnrichedHandle.current = "";
    setDraftRestored(false);
    track("vendor_submit_draft_cleared");
  }

  // Enrichment + submission state
  const [enrichState, setEnrichState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "done"; result: EnrichResult }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });

  // Move keyboard/screen-reader focus onto the outcome banner when a
  // submit resolves (WCAG 4.1.3) · the error box renders ABOVE the
  // submit button the user just activated, and the success screen
  // unmounts the whole form (focus would otherwise fall to <body>).
  const outcomeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (submitState.kind === "error" || submitState.kind === "success") {
      outcomeRef.current?.focus();
    }
  }, [submitState.kind]);

  // ── Auto-enrichment on handle blur ────────────────────────────────
  // Debounced trigger · firing on every keystroke would hammer the
  // server. We only enrich when the handle field loses focus AND it
  // looks complete.
  const lastEnrichedHandle = useRef("");

  async function runEnrichment(h: string) {
    if (!h || h === lastEnrichedHandle.current) return;
    lastEnrichedHandle.current = h;
    setEnrichState({ kind: "loading" });
    try {
      const r = await fetch("/api/enrich-handle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: h }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const result = (await r.json()) as EnrichResult;
      setEnrichState({ kind: "done", result });

      // Set platform if not ambiguous
      if (result.detectedPlatform !== "ambiguous") {
        setPlatform(result.detectedPlatform);
      }

      // Smart-fill empty fields only · never overwrite what the user typed
      if (result.name && !name) setName(result.name);
      if (result.description && !description) setDescription(result.description);
      if (result.lightningAddress && !lightningAddress) {
        setLightningAddress(result.lightningAddress);
        setShowOptional(true);
      }
      if (result.website && !website) {
        setWebsite(result.website);
      }

      track("vendor_submit_enriched", {
        platform: result.detectedPlatform,
        source: result.source ?? "none",
      });
    } catch (e) {
      setEnrichState({
        kind: "error",
        message: e instanceof Error ? e.message : "enrichment failed",
      });
    }
  }

  // ── Live card preview ─────────────────────────────────────────────
  // The submitter sees the REAL VendorCard (the extracted shared
  // component the homepage grid renders) filled from their form state.
  // Two payoffs: motivation ("that's MY shop in the directory") and
  // self-serve QA · a truncated name or overlong description is
  // visible before it ever reaches the review queue.
  //
  // The avatar handle is DEBOUNCED (500ms) rather than live · the
  // card's Avatar hits unavatar.io/x/<handle>, and firing a request
  // per keystroke would spray partial-handle lookups at a third
  // party. Text fields update instantly (no network cost).
  const [previewHandle, setPreviewHandle] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setPreviewHandle(handle.trim()), 500);
    return () => clearTimeout(t);
  }, [handle]);
  // Stable "today" timestamp · computed once so the preview card's
  // NEW badge + "Verified <today>" strip render like a fresh listing.
  const [previewVerifiedAt] = useState(() => Math.floor(Date.now() / 1000));

  const previewVendor: Vendor = useMemo(() => {
    const enrichedPicture =
      enrichState.kind === "done" ? enrichState.result.picture : undefined;
    return {
      handle: previewHandle || "yourhandle",
      ...(platform ? { platform } : {}),
      name: name.trim() || "Your brand name",
      description:
        description.trim() ||
        "Your short, honest description appears here · what you make and who it is for.",
      category: (category || "apparel") as VendorCategory,
      addedAt: 100000,
      verifiedAt: previewVerifiedAt,
      // Preview only · a would-be listing is "listed" the moment it is
      // previewed, so the card renders its NEW badge exactly as a real
      // approved listing would.
      listedAt: previewVerifiedAt,
      ...(country ? { country } : {}),
      ...(enrichedPicture ? { pictureUrl: enrichedPicture } : {}),
    };
  }, [
    previewHandle,
    platform,
    name,
    description,
    category,
    country,
    previewVerifiedAt,
    enrichState,
  ]);

  // Only show the preview once the form is "alive" · a ghost card
  // over a pristine form is noise, but the moment they've typed
  // anything identifying, the mirror starts paying rent.
  const previewAlive =
    handle.trim().length > 0 ||
    name.trim().length > 0 ||
    description.trim().length > 0;

  // Per-field validation state · used both to disable submit AND to
  // show a specific checklist of what's still missing. The previous
  // generic "fill the required fields" hint didn't tell the user
  // WHICH field was the holdup · this fixes that by enumerating.
  const requiredChecks = useMemo(() => {
    const descLen = description.trim().length;
    return [
      {
        key: "handle",
        label: t("submit.needHandle"),
        ok: handle.trim().length > 0,
        hint: handle.trim().length === 0 ? t("submit.hintEmpty") : null,
      },
      {
        key: "name",
        label: t("submit.needName"),
        ok: name.trim().length > 0,
        hint: name.trim().length === 0 ? t("submit.hintEmpty") : null,
      },
      {
        key: "description",
        label: t("submit.needDescription"),
        ok: descLen >= 30 && descLen <= 300,
        hint:
          descLen === 0
            ? t("submit.hintEmpty")
            : descLen < 30
              ? t("submit.hintNeedChars", { n: 30 - descLen })
              : descLen > 300
                ? t("submit.hintTooLong", { n: descLen - 300 })
                : null,
      },
      {
        key: "category",
        label: t("submit.needCategory"),
        ok: category !== "",
        hint: category === "" ? t("submit.hintPick") : null,
      },
      {
        key: "country",
        label: t("submit.needCountry"),
        ok: country !== "",
        hint: country === "" ? t("submit.hintPick") : null,
      },
      {
        key: "website",
        label: t("submit.needWebsite"),
        ok: /^https:\/\/.+/i.test(normalizeWebsiteInput(website)),
        hint:
          website.trim().length === 0
            ? t("submit.hintEmpty")
            : /^https:\/\/.+/i.test(normalizeWebsiteInput(website))
              ? null
              : t("submit.hintHttps"),
      },
      {
        key: "handle-shape",
        label: t("submit.needHandleShape"),
        ok:
          handle.trim().length === 0 ||
          (!isConsumerMailHandle(guardNormalizeHandle(handle.trim())) &&
            !(
              (platform === "x" || platform === "") &&
              handle.trim().includes("@")
            )),
        hint: handle.trim().includes("@")
          ? isConsumerMailHandle(guardNormalizeHandle(handle.trim()))
            ? t("submit.hintGmail")
            : t("submit.hintNip05")
          : null,
      },
      {
        key: "bitcoin",
        label: t("submit.needBitcoin"),
        ok: descLen < 30 || mentionsBitcoin(description),
        hint:
          descLen >= 30 && !mentionsBitcoin(description)
            ? t("submit.hintBitcoin")
            : null,
      },
      {
        key: "not-bait",
        label: t("submit.needNotBait"),
        ok: descLen < 30 || !hasBaitLanguage(description),
        hint:
          descLen >= 30 && hasBaitLanguage(description)
            ? t("submit.hintBait")
            : null,
      },
      {
        key: "attest",
        label: t("submit.needAttest"),
        ok: acceptsBitcoin,
        hint: acceptsBitcoin ? null : t("submit.hintCheck"),
      },
      {
        key: "email",
        label: t("submit.needEmail"),
        ok:
          notifyEmail.trim().length > 0 &&
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notifyEmail.trim()),
        hint:
          notifyEmail.trim().length === 0
            ? t("submit.hintEmpty")
            : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notifyEmail.trim())
              ? null
              : t("submit.hintInvalid"),
      },
    ];
  }, [
    t,
    handle,
    name,
    description,
    category,
    country,
    website,
    platform,
    acceptsBitcoin,
    notifyEmail,
  ]);

  const missing = requiredChecks.filter((c) => !c.ok);
  const isReadyToSubmit = missing.length === 0;

  // Activate Turnstile on first real user engagement (or on submit attempt).
  // This mirrors the lazy pattern used everywhere else on the site.
  function activateTurnstile() {
    if (TURNSTILE_SITE_KEY && !turnstileActivated) {
      setTurnstileActivated(true);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // The button stays clickable while fields are missing (a greyed-out
    // button that does nothing read as "it's not letting me submit").
    // Say what is missing instead; the outcome banner takes focus (see
    // outcomeRef above) and sits right over the button.
    if (!isReadyToSubmit) {
      setSubmitState({
        kind: "error",
        errors: missing.map((c) => (c.hint ? `${c.label}: ${c.hint}` : c.label)),
      });
      track("vendor_submit_blocked", { field: missing[0]?.key ?? "unknown" });
      return;
    }
    const websiteOut = normalizeWebsiteInput(website);
    if (websiteOut !== website) setWebsite(websiteOut);

    // Ensure Turnstile is active before we submit (if configured).
    // If the widget hasn't rendered yet, we activate it here — the
    // user will see it appear and can complete it before retrying.
    activateTurnstile();

    // If Turnstile is configured but we don't have a token yet,
    // block the submit and let the widget render.
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setSubmitState({
        kind: "error",
        errors: ["Please complete the security check above."],
      });
      return;
    }

    const instant = assessSubmitGuard({
      handle: handle.trim(),
      platform: platform || undefined,
      name: name.trim(),
      description: description.trim(),
      category,
      country: country || undefined,
      lightningAddress: lightningAddress.trim() || undefined,
      website: websiteOut || undefined,
      founderName: founderName.trim() || undefined,
      shipsInternational: shipsInternational || undefined,
      submitterNote: submitterNote.trim() || undefined,
      notifyEmail: notifyEmail.trim() || undefined,
      acceptsBitcoinAtCheckout: acceptsBitcoin,
    });
    if (!instant.ok) {
      setSubmitState({ kind: "error", errors: instant.errors });
      return;
    }

    setSubmitState({ kind: "submitting" });
    try {
      const r = await fetch("/api/submit-vendor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle: handle.trim(),
          platform: platform || undefined,
          name: name.trim(),
          description: description.trim(),
          category,
          country: country || undefined,
          lightningAddress: lightningAddress.trim() || undefined,
          website: websiteOut || undefined,
          founderName: founderName.trim() || undefined,
          shipsInternational: shipsInternational || undefined,
          submitterNote: submitterNote.trim() || undefined,
          notifyEmail: notifyEmail.trim() || undefined,
          acceptsBitcoinAtCheckout: acceptsBitcoin,
          _hpot: honeypot,
          ...(turnstileToken ? { turnstileToken } : {}),
        }),
      });
      const data = (await r.json()) as {
        ok?: boolean;
        message?: string;
        errors?: string[];
        error?: string;
      };
      if (!r.ok || !data.ok) {
        setSubmitState({
          kind: "error",
          errors: data.errors ?? [data.error ?? `HTTP ${r.status}`],
        });
        track("vendor_submit_failed", { reason: data.error ?? "unknown" });
        return;
      }
      clearDraft();
      setDraftRestored(false);
      setSubmitState({
        kind: "success",
        message:
          data.message ?? "Submission received. We review within 24-48 hours.",
      });
      track("vendor_submit_success", { platform });
    } catch (e) {
      setSubmitState({
        kind: "error",
        errors: [e instanceof Error ? e.message : "submit failed"],
      });
    }
  }

  // Success screen replaces the form so we don't double-submit. The
  // success state is a high-intent moment · we surface a richer
  // cross-sell (Buying Gauge + recently-added vendor strip) via the
  // SubmitSuccessCrossSell component below to convert the submitter
  // into a daily-return visitor instead of letting them bounce off.
  if (submitState.kind === "success") {
    // Pre-filled share copy · the highest-intent moment in the entire
    // funnel is right NOW, when the vendor has just confirmed they
    // want in. Tier 2 retention: prompt them to tell their audience.
    // A vendor RT is the single largest organic-growth lever the
    // directory has · their followers are warm, on-brand, and primed
    // to discover the directory through someone they already follow.
    // We link to galaxymind.space (live now) rather than the future
    // /v/[slug] (404 until approval) so the share works the moment
    // they click.
    const xShareText =
      `I just submitted to @GalaxyMind, the human-verified directory of merchants who take bitcoin. ` +
      `galaxymind.space`;
    const xShareUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(xShareText)}`;
    const nostrShareText =
      `I just submitted to Galaxy Mind, the human-verified directory of merchants who take bitcoin. ` +
      `galaxymind.space\n\n#bitcoin #circulareconomy`;
    return (
      <div
        ref={outcomeRef}
        role="status"
        tabIndex={-1}
        className="rounded-xl border-2 border-[var(--accent)]/50 bg-[var(--accent)]/5 p-6 sm:p-8"
      >
        <div className="t-xs font-medium text-[var(--accent-ink)] mb-3">
          ✓ Submission received
        </div>
        <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-3 leading-tight">
          Thanks · we&apos;ll review within 24-48 hours.
        </h2>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-3">
          {submitState.message}
        </p>
        <p className="text-xs text-[var(--text-tertiary)] leading-relaxed mb-6">
          We email the outcome to the address you gave, listed or not. If
          you are listed that mail includes the verified-bitcoin badge
          for your shop.
        </p>

        {/* Vendor reshare prompt · the directory's primary flywheel.
            We do NOT auto-post anything; these are one-click hand-offs
            to the vendor's own X / Nostr client with pre-filled copy
            they can edit. Plain voice, no em dash, no hashtag stuffing
            on the X variant (X penalises that). */}
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 sm:p-5 mb-4">
          <div className="font-mono t-xs uppercase tracking-[0.2em] text-[var(--text-tertiary)] mb-2">
            Tell your customers
          </div>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-4">
            Your audience is the people most likely to want to spend
            bitcoin with you · one post primes them to find you when
            you go live.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <a
              href={xShareUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => track("vendor_submit_share_x")}
              className="micro-label flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md border border-[var(--accent)] text-[var(--accent-ink)] hover:bg-[var(--accent)]/10 transition-colors"
            >
              Post on X →
            </a>
            <button
              type="button"
              onClick={() => {
                if (typeof navigator !== "undefined" && navigator.clipboard) {
                  navigator.clipboard.writeText(nostrShareText).catch(() => {});
                }
                track("vendor_submit_share_nostr_copied");
              }}
              className="micro-label flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--accent)]/40 hover:text-[var(--accent-ink)] transition-colors"
            >
              Copy Nostr note
            </button>
          </div>
        </div>

        <SubmitSuccessCrossSell />
      </div>
    );
  }

  return (
    // lg+: two columns · form left, sticky live-preview rail right.
    // Below lg the rail is hidden and an inline preview renders inside
    // the form after the last required field (see below) so mobile
    // submitters get the same mirror without a layout fork.
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-10 lg:items-start">
    <form
      onSubmit={handleSubmit}
      // noValidate: the "Still need" checklist and handleSubmit's message
      // are the validation UI. Native bubbles (required email, url type)
      // fired first and our explanation never showed.
      noValidate
      className="space-y-6 min-w-0"
      autoComplete="off"
    >
      {draftRestored && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-4 py-3 text-sm text-[var(--text-secondary)]"
        >
          <span>{t("submit.draftRestored")}</span>
          <button
            type="button"
            onClick={startOver}
            className="micro-label inline-flex items-center min-h-11 px-3 rounded-md border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--accent)]/40 hover:text-[var(--accent-ink)] transition-colors"
          >
            {t("submit.draftClear")}
          </button>
        </div>
      )}

      {/* Handle · the hero field. Big, prominent, focuses on load. */}
      <div>
        <label
          htmlFor="handle"
          className="block t-xs font-medium text-[var(--text-tertiary)] mb-2"
        >
          {t("submit.handle")}{" "}
          <span className="text-[var(--accent-ink)] normal-case tracking-normal">
            *
          </span>{" "}
          <span className="text-[var(--text-tertiary)] normal-case tracking-normal">
            {t("submit.handleHint")}
          </span>
        </label>
        <div className="flex gap-2">
          <input
            id="handle"
            type="text"
            value={handle}
            onChange={(e) => setHandle(normalizeHandle(e.target.value))}
            onBlur={() => runEnrichment(handle.trim())}
            placeholder="bitcointile1   ·   npub1…   ·   name@domain.tld"
            autoFocus
            className="flex-1 min-w-0 px-4 py-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] focus:border-[var(--accent)] focus:outline-none focus:lit-active transition-all text-[var(--text-primary)] font-mono text-base"
          />
          <button
            type="button"
            onClick={() => runEnrichment(handle.trim())}
            disabled={!handle.trim() || enrichState.kind === "loading"}
            className="micro-label px-4 rounded-lg border border-[var(--accent)]/50 text-[var(--accent-ink)] hover:bg-[var(--accent)]/10 hover:lit-active transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            title="Auto-fill from your public profile"
          >
            {enrichState.kind === "loading" ? "..." : t("submit.autofill")}
          </button>
        </div>
        <div className="mt-2 flex items-center gap-3 min-h-[16px] t-xs">
          {enrichState.kind === "loading" && (
            <span className="text-[var(--text-tertiary)]">
              <span className="inline-block animate-pulse">●</span> fetching
              your profile...
            </span>
          )}
          {enrichState.kind === "done" && (
            <>
              <span className="text-[var(--accent-ink)]">
                Detected:{" "}
                {enrichState.result.detectedPlatform === "ambiguous"
                  ? "Nostr or Lightning · pick below"
                  : enrichState.result.detectedPlatform}
              </span>
              {enrichState.result.source === "nostr_kind0" && (
                <span className="text-[var(--text-secondary)] normal-case tracking-normal">
                  ✓ pulled from Nostr profile
                </span>
              )}
              {enrichState.result.source === "lnurl_pay" && (
                <span className="text-[var(--text-secondary)] normal-case tracking-normal">
                  ✓ LNURL-pay endpoint alive
                </span>
              )}
              {enrichState.result.notes && enrichState.result.notes.length > 0 && (
                <span className="text-[var(--text-tertiary)] normal-case tracking-normal">
                  {enrichState.result.notes[0]}
                </span>
              )}
            </>
          )}
        </div>
        {/* name@domain with no platform used to default to X and
            that is the Kinka hole. A NIP-05 must be claimed as Nostr.
            Lightning is a payment field, not an identity. */}
        {(handle.includes("@") ||
          (enrichState.kind === "done" &&
            enrichState.result.detectedPlatform === "ambiguous")) && (
            <div className="mt-3">
              <div className="t-xs text-[var(--text-tertiary)] mb-1.5">
                This looks like name@domain · pick Nostr if it is a NIP-05
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setPlatform("nostr")}
                  className={`px-3 py-1.5 rounded-md text-xs font-mono uppercase tracking-widest border transition-colors ${
                    platform === "nostr"
                      ? "border-[var(--accent)] text-[var(--accent-ink)] bg-[var(--accent)]/10"
                      : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--text-tertiary)]"
                  }`}
                >
                  Nostr (NIP-05)
                </button>
              </div>
              <p className="mt-1.5 t-xs text-[var(--text-tertiary)] leading-relaxed">
                A Lightning Address is for payments, so put it under extra
                details, not as the handle. Gmail / Hotmail / etc. is never
                an identity.
              </p>
            </div>
          )}
      </div>

      {/* Display name */}
      <div>
        <label
          htmlFor="name"
          className="block t-xs font-medium text-[var(--text-tertiary)] mb-2"
        >
          {t("submit.name")}{" "}
          <span className="text-[var(--accent-ink)] normal-case tracking-normal">
            *
          </span>
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          placeholder="Soap Miner"
          className="w-full px-4 py-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] focus:border-[var(--accent)] focus:outline-none transition-colors text-[var(--text-primary)]"
        />
      </div>

      {/* Description */}
      <div>
        <label
          htmlFor="description"
          className="block t-xs font-medium text-[var(--text-tertiary)] mb-2"
        >
          {t("submit.description")}{" "}
          <span className="text-[var(--accent-ink)] normal-case tracking-normal">
            *
          </span>{" "}
          <span className="text-[var(--text-tertiary)] normal-case tracking-normal">
            {t("submit.descriptionHint")}
          </span>
        </label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onFocus={activateTurnstile}
          maxLength={300}
          rows={3}
          placeholder="Handmade beef tallow soap. Bitcoin and lightning at checkout, shipped from Ohio."
          className="w-full px-4 py-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] focus:border-[var(--accent)] focus:outline-none transition-colors text-[var(--text-primary)] resize-none"
        />
        <div className="mt-1 t-xs text-[var(--text-tertiary)] flex justify-between">
          <span>
            {description.length < 30
              ? `${30 - description.length} more chars needed`
              : `${description.length}/300 chars`}
          </span>
        </div>
      </div>

      {/* Country */}
      <div>
        <label
          htmlFor="country"
          className="block t-xs font-medium text-[var(--text-tertiary)] mb-2"
        >
          {t("submit.country")}{" "}
          <span className="text-[var(--accent-ink)] normal-case tracking-normal">
            *
          </span>
        </label>
        <select
          id="country"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className="w-full px-4 py-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] focus:border-[var(--accent)] focus:outline-none transition-colors text-[var(--text-primary)] font-mono"
        >
          <option value="">{t("submit.selectCountry")}</option>
          <optgroup label={t("submit.inDirectory")}>
            {IN_DIRECTORY_COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.label}
              </option>
            ))}
          </optgroup>
          <optgroup label={t("submit.everywhereElse")}>
            {OTHER_COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.label}
              </option>
            ))}
          </optgroup>
        </select>
      </div>

      {/* Website · required so nightly shop probes and the map/hubs
          have something to check. CLI can still skip with a reason. */}
      <div>
        <label
          htmlFor="website"
          className="block t-xs font-medium text-[var(--text-tertiary)] mb-2"
        >
          {t("submit.website")}{" "}
          <span className="text-[var(--accent-ink)] normal-case tracking-normal">
            *
          </span>
        </label>
        <input
          id="website"
          // Text input with a url keyboard, not the native url input type: its
          // check blocked "myshop.com" with a browser bubble before our own
          // (friendlier) handling ever ran. normalizeWebsiteInput adds the
          // https:// on blur and again at submit.
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          onBlur={() => {
            const next = normalizeWebsiteInput(website);
            if (next !== website) setWebsite(next);
          }}
          onFocus={activateTurnstile}
          placeholder="https://your-shop.com"
          className="w-full px-4 py-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] focus:border-[var(--accent)] focus:outline-none transition-colors text-[var(--text-primary)]"
        />
        <p className="mt-1 t-xs text-[var(--text-tertiary)] leading-relaxed">
          {t("submit.websiteHint")}
        </p>
        {/* Multi-shop (2026-10) · one handle may own several listings;
            each shop is its own submission. Same handle + a new site
            goes to a human with an ownership check. */}
        <p
          data-testid="submit-multi-shop-hint"
          className="mt-1 t-xs text-[var(--text-tertiary)] leading-relaxed"
        >
          {t("submit.multiShop")}
        </p>
      </div>

      {/* Category */}
      <div>
        <div className="block t-xs font-medium text-[var(--text-tertiary)] mb-2">
          {t("submit.category")}{" "}
          <span className="text-[var(--accent-ink)] normal-case tracking-normal">
            *
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              // 44px tap floor on a required-to-proceed control (UX
              // audit 2026-07-13 · was ~32px); inline-flex + min-h
              // centers the label in the taller box.
              className={`inline-flex items-center px-3 py-2 min-h-11 rounded-md font-mono text-xs uppercase tracking-widest border transition-colors ${
                category === c
                  ? "border-[var(--accent)] text-[var(--accent-ink)] bg-[var(--accent)]/10"
                  : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--text-tertiary)]"
              }`}
            >
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
      </div>

      {/* Outcome email · required (2026-08-23). Buried under extra
          details it was never seen; optional it was skipped; listed
          shops then never got the verified-bitcoin badge mail. */}
      <div>
        <label
          htmlFor="notifyEmail"
          className="block t-xs font-medium text-[var(--text-tertiary)] mb-2"
        >
          {t("submit.emailLabel")}{" "}
          <span className="text-[var(--accent-ink)] normal-case tracking-normal">
            *
          </span>{" "}
          <span className="text-[var(--text-tertiary)] normal-case tracking-normal">
            {t("submit.emailHint")}
          </span>
        </label>
        <input
          id="notifyEmail"
          type="email"
          required
          value={notifyEmail}
          onChange={(e) => setNotifyEmail(e.target.value)}
          maxLength={254}
          placeholder="you@example.com"
          className="w-full px-4 py-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] focus:border-[var(--accent)] focus:outline-none transition-colors text-[var(--text-primary)]"
        />
        <p className="mt-1 t-xs text-[var(--text-tertiary)] leading-relaxed">
          {t("submit.emailBody")}
        </p>
      </div>

      {/* Inline live preview · mobile/tablet only (the lg+ rail is a
          sibling of the form). Sits right after the last required
          field · the natural "ta-da" moment once the card has
          something to show. */}
      {previewAlive && (
        <div className="lg:hidden">
          <div className="t-xs font-medium text-[var(--text-tertiary)] mb-2">
            {t("submit.preview")}{" "}
            <span className="text-[var(--accent-ink)] normal-case tracking-normal">
              {t("submit.previewSub")}
            </span>
          </div>
          <div role="list" className="max-w-sm">
            <VendorCard vendor={previewVendor} index={0} />
          </div>
        </div>
      )}

      {/* Optional fields disclosure */}
      <div className="pt-2 border-t border-[var(--border-subtle)]">
        <button
          type="button"
          onClick={() => setShowOptional(!showOptional)}
          className="t-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--accent-ink)] transition-colors"
        >
          {showOptional ? t("submit.moreDetailsHide") : t("submit.moreDetailsAdd")}{" "}
          <span className="normal-case tracking-normal">
            {t("submit.moreDetailsHint")}
          </span>
        </button>

        {showOptional && (
          <div className="space-y-5 mt-5">
            <div>
              <label
                htmlFor="founderName"
                className="block t-xs text-[var(--text-tertiary)] mb-1"
              >
                {t("submit.founder")}
              </label>
              <input
                id="founderName"
                type="text"
                value={founderName}
                onChange={(e) => setFounderName(e.target.value)}
                maxLength={60}
                placeholder="Sarah"
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] focus:border-[var(--accent)] focus:outline-none text-[var(--text-primary)] text-sm"
              />
            </div>
            <div>
              <label
                htmlFor="lightningAddress"
                className="block t-xs text-[var(--text-tertiary)] mb-1"
              >
                {t("submit.lightning")}
              </label>
              <input
                id="lightningAddress"
                type="text"
                value={lightningAddress}
                onChange={(e) => setLightningAddress(e.target.value)}
                placeholder="you@walletofsatoshi.com"
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] focus:border-[var(--accent)] focus:outline-none text-[var(--text-primary)] text-sm font-mono"
              />
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  checked={shipsInternational}
                  onChange={(e) => setShipsInternational(e.target.checked)}
                  className="accent-[var(--accent)]"
                />
                {t("submit.shipsIntl")}
              </label>
            </div>
            <div>
              <label
                htmlFor="note"
                className="block t-xs text-[var(--text-tertiary)] mb-1"
              >
                {t("submit.note")}
              </label>
              <textarea
                id="note"
                value={submitterNote}
                onChange={(e) => setSubmitterNote(e.target.value)}
                maxLength={500}
                rows={2}
                placeholder={t("submit.notePlaceholder")}
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] focus:border-[var(--accent)] focus:outline-none text-[var(--text-primary)] text-sm resize-none"
              />
            </div>
          </div>
        )}
      </div>

      <label className="flex items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 cursor-pointer">
        <input
          id="acceptsBitcoin"
          type="checkbox"
          checked={acceptsBitcoin}
          onChange={(e) => setAcceptsBitcoin(e.target.checked)}
          className="mt-1 accent-[var(--accent)]"
        />
        <span>
          <span className="block text-sm text-[var(--text-primary)]">
            {t("submit.attest")}
          </span>
          <span className="mt-1 block t-xs text-[var(--text-tertiary)] leading-relaxed">
            {t("submit.attestHint")}
          </span>
        </span>
      </label>

      {/* Honeypot · hidden via CSS, accessible to bots that don't
          read computed styles. Real users never see this. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: "-9999px",
          width: 1,
          height: 1,
          overflow: "hidden",
        }}
      >
        <label htmlFor="_hpot">Leave this empty</label>
        <input
          id="_hpot"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
        />
      </div>

      {/* Submit row */}
      <div className="pt-4">
        {submitState.kind === "error" && (
          <div
            ref={outcomeRef}
            role="alert"
            tabIndex={-1}
            className="mb-4 rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/5 p-3"
          >
            <div className="micro-label text-[var(--warning)] mb-1">
              ⚠ {t("submit.couldnt")}
            </div>
            <ul className="text-sm text-[var(--text-secondary)] space-y-1 list-disc list-inside">
              {submitState.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}
        {!isReadyToSubmit && (
          <div id="submit-still-need" className="mb-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)]/60 p-4">
            <div className="t-xs font-medium text-[var(--text-tertiary)] mb-2">
              {t("submit.stillNeed")}
            </div>
            <ul className="space-y-1 text-sm">
              {requiredChecks.map((c) => (
                <li
                  key={c.key}
                  className={`flex items-baseline gap-2 ${
                    c.ok
                      ? "text-[var(--text-tertiary)]"
                      : "text-[var(--text-primary)]"
                  }`}
                >
                  <span
                    aria-hidden
                    className={
                      c.ok ? "text-[#4ADE80]" : "text-[var(--accent-ink)]"
                    }
                  >
                    {c.ok ? "✓" : "•"}
                  </span>
                  <span className={c.ok ? "line-through opacity-60" : ""}>
                    {c.label}
                  </span>
                  {c.hint && (
                    <span className="text-[var(--accent-ink)] font-mono text-xs">
                      · {c.hint}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {/* Turnstile widget · lazy rendered when the user engages the form.
            We only pay the third-party script + iframe cost for people who
            actually intend to submit. Matches the pattern used on all other
            public forms on the site. */}
        {TURNSTILE_SITE_KEY && turnstileActivated && (
          <>
            {!turnstileReady && (
              <Script
                src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
                strategy="lazyOnload"
                onReady={() => setTurnstileReady(true)}
              />
            )}
            <div ref={turnstileContainerRef} className="my-2" />
          </>
        )}

        <button
          type="submit"
          disabled={submitState.kind === "submitting"}
          aria-describedby={isReadyToSubmit ? undefined : "submit-still-need"}
          onClick={activateTurnstile}
          className="w-full px-5 py-3 rounded-lg bg-[var(--accent)] text-black font-mono text-sm uppercase tracking-[0.25em] font-semibold hover:bg-[var(--accent-hover)] hover:lit-primary transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none"
        >
          {submitState.kind === "submitting"
            ? t("submit.submitting")
            : isReadyToSubmit
              ? t("submit.submitReview")
              : missing.length === 1
                ? t("submit.submitLeftOne")
                : t("submit.submitLeft", { n: missing.length })}
        </button>
      </div>
    </form>

    {/* Sticky live-preview rail · lg+ only. The submitter watches
        their directory card assemble itself while they type. Width
        (340px) matches a real homepage grid tile so proportions ·
        name truncation, description wrap · are honest. */}
    <aside className="hidden lg:block sticky top-24" aria-label="Live preview of your vendor card">
      <div className="t-xs font-medium text-[var(--text-tertiary)] mb-3">
        {t("submit.preview")}{" "}
        <span className="text-[var(--accent-ink)] normal-case tracking-normal">
          {t("submit.previewSub")}
        </span>
      </div>
      {previewAlive ? (
        <div role="list">
          <VendorCard vendor={previewVendor} index={0} />
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 p-6 text-sm text-[var(--text-tertiary)] leading-relaxed">
          Start typing your handle and this becomes your directory
          card · exactly as visitors will see it.
        </div>
      )}
      <p className="mt-3 t-xs text-[var(--text-tertiary)] leading-relaxed">
        Updates as you type. The NEW badge shows for your first 14
        days after approval.
      </p>
    </aside>
    </div>
  );
}
