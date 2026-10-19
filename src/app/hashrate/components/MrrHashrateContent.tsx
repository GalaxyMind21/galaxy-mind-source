// /hashrate in RENTALS_MODE=mrr_only (the default since 2026-10-17): the sales funnel (operator 2026-10-17).
// Hero → unit list → why us → honest odds → three steps → objection FAQ → final CTA (+ mobile sticky bar), all in
// HashrateFunnel so the selected N drives every CTA and the odds. Availability: lib/mrr-units.ts (public marketplace
// feed, 60 s cache, stale after 15 min). Odds: mempool.space network hashrate (lib/hashrate getNetworkPhs).
// No prices, no hardware model, no rig ids in visible text, no named pool.
import { getUnitSnapshot, unitsView } from "@/lib/mrr-units";
import { getNetworkPhs } from "@/lib/hashrate";
import { supportInfo } from "@/lib/support";
import { SupportLine } from "./SupportLine";
import { HashrateFunnel, type FunnelCopy, type FunnelView } from "./HashrateFunnel";
import {
  MARKETPLACE_REGISTER_URL,
  MARKETPLACE_REGISTER_CTA,
  MARKETPLACE_REFERRAL_NOTE,
  MARKETPLACE_LINK_REL,
  MARKETPLACE_FAQ,
} from "@/lib/marketplace-listing";
import * as C from "@/lib/mrr-page-copy";

export const MRR_FAQ_ALL = [...C.MRR_FAQ_ITEMS, MARKETPLACE_FAQ];

export const FUNNEL_COPY: FunnelCopy = {
  h1: C.MRR_PAGE_H1, sub: C.MRR_HERO_SUB, selectorLabel: C.MRR_SELECTOR_LABEL, dec: C.MRR_SELECTOR_DEC, inc: C.MRR_SELECTOR_INC,
  liveLine: C.MRR_LIVE_LINE, updated: C.MRR_LIVE_UPDATED, noneFree: C.MRR_NONE_FREE, stale: C.MRR_STALE, checkBack: C.MRR_CHECK_BACK_CTA,
  primaryCta: C.MRR_PRIMARY_CTA, primaryNoteOne: C.MRR_PRIMARY_NOTE_ONE, primaryNoteMany: C.MRR_PRIMARY_NOTE_MANY,
  listTitle: C.MRR_LIST_TITLE, unitLabel: C.MRR_UNIT_LABEL, unitCta: C.MRR_UNIT_CTA, unitDone: C.MRR_UNIT_DONE,
  listTip: C.MRR_LIST_TIP, hoursNote: C.MRR_HOURS_NOTE, registerCta: MARKETPLACE_REGISTER_CTA,
  referralNote: MARKETPLACE_REFERRAL_NOTE, newTab: "(opens in a new tab)",
  whyTitle: C.MRR_WHY_TITLE, whyCards: C.MRR_WHY_CARDS,
  oddsTitle: C.MRR_ODDS_TITLE, oddsDay: C.MRR_ODDS_DAY, oddsWeek: C.MRR_ODDS_WEEK, oddsLine: C.MRR_ODDS_LINE,
  oddsNote: C.MRR_ODDS_NOTE, oddsNone: C.MRR_ODDS_NONE,
  flowTitle: C.MRR_FLOW_TITLE, flowSteps: C.MRR_FLOW_STEPS,
  faqTitle: C.MRR_FAQ_TITLE, faq: MRR_FAQ_ALL,
  finalTitle: C.MRR_FINAL_TITLE, agentsLink: C.MRR_AGENTS_LINK,
};

/** Only what the client needs: hrefs and the fetch time. */
export function funnelView(v: ReturnType<typeof unitsView>): FunnelView {
  return v.state === "live" ? { state: "live", at: v.at, free: v.free, freeCount: v.freeCount } : { state: v.state };
}

export default async function MrrHashrateContent() {
  const [snap, networkPhs] = await Promise.all([getUnitSnapshot(), getNetworkPhs().catch(() => null)]);
  const view = funnelView(unitsView(snap, Date.now()));
  const support = supportInfo();
  return (
    <div className="space-y-10" data-mrr-only>
      <HashrateFunnel
        view={view}
        copy={FUNNEL_COPY}
        networkPhs={networkPhs}
        registerUrl={MARKETPLACE_REGISTER_URL}
        rel={MARKETPLACE_LINK_REL}
        agentsHref="/hashrate/agents"
      />
      <SupportLine support={support} />
    </div>
  );
}
