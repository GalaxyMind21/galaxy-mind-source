/**
 * DESIGN SCORECARD · objective, repeatable measurement of a page's UX quality.
 *
 * WHY THIS EXISTS
 * ---------------
 * The 2026-08-23 redesign brief was "run loops until it is measurably better,
 * not just different". That sentence is unenforceable without a number to beat,
 * and Vercel Web Analytics was never switched on (the `<Analytics />` in
 * layout.tsx and 20+ `track()` call sites have been firing into a void), so
 * there is no behavioural baseline to lean on. This harness is the substitute
 * that works TODAY: every metric here is derivable from the rendered page
 * alone, with no analytics, no field data, and no human judgement.
 *
 * It is deliberately NOT a Lighthouse wrapper. Lighthouse scores performance
 * and a11y; it has nothing to say about the two defects that actually motivated
 * this work — how far a visitor scrolls before reaching the thing the page is
 * FOR, and how much visual vocabulary the page has accumulated. Those are the
 * `contentReach` and `entropy` blocks, and they are the point.
 *
 * USAGE
 *   node scripts/design-scorecard.mjs --url https://galaxymind.space/ --label baseline
 *   node scripts/design-scorecard.mjs --url http://localhost:3137/ --label rebuild
 *   node scripts/design-scorecard.mjs --compare baseline rebuild
 *
 * Writes design-baselines/<label>.json. Commit baselines — a scorecard you
 * cannot diff against last week is a vibe with a JSON extension.
 */

import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT_DIR = new URL("../design-baselines", import.meta.url).pathname;

// Both viewports are measured every run. A redesign that fixes desktop and
// regresses mobile is not an improvement, and mobile is where the bitcoin.org
// referral traffic actually lands (research: "assume mobile, and assume a
// reference-page reading posture").
const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844, dsf: 3, mobile: true },
  { name: "desktop", width: 1440, height: 900, dsf: 2, mobile: false },
];

/**
 * What counts as "the thing this page is for". Reaching it is the headline
 * metric, so it must be named per route rather than guessed: a heuristic that
 * picks the wrong element produces a confidently wrong number, which is worse
 * than no number.
 */
const PRIMARY_CONTENT = {
  "/": "[data-vendor-grid] > *",
  "/stack": "[data-gauge], svg[role='img']",
  "/treasuries": "table tbody tr",
  "/float": "[data-supply-clock], canvas",
  "/map": "canvas, svg",
  "/arcade": "a[href^='/']",
};

function primarySelectorFor(url, override) {
  if (override) return override;
  const path = new URL(url).pathname.replace(/\/$/, "") || "/";
  return PRIMARY_CONTENT[path] ?? "main :is(article, li, tr, [data-item])";
}

// ---------------------------------------------------------------------------
// In-page probe. Everything below runs INSIDE the browser context.
// ---------------------------------------------------------------------------
const PROBE = /* js */ `(primarySel) => {
  const vw = innerWidth, vh = innerHeight;
  const round = n => Math.round(n);
  const docH = document.documentElement.scrollHeight;

  // --- contentReach: how far to the first piece of primary content ---------
  const primary = document.querySelector(primarySel);
  const primaryY = primary
    ? round(primary.getBoundingClientRect().top + scrollY)
    : null;

  const visible = el => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  // --- above-fold composition ----------------------------------------------
  const inFold = [...document.querySelectorAll('a,button,input,select,textarea,[role="button"],[tabindex]:not([tabindex="-1"])')]
    .filter(e => {
      const r = e.getBoundingClientRect();
      return r.top < vh && r.bottom > 0 && visible(e);
    });
  // An interactive element nested inside another (card > save button) is one
  // decision to the user, not two. Counting both inflates the number and would
  // let a redesign "improve" by restructuring nesting rather than simplifying.
  const topLevelInFold = inFold.filter(e => !inFold.some(o => o !== e && o.contains(e)));

  // Items of PRIMARY CONTENT above the fold are the goal, not competition.
  // The first version of this metric counted them, which meant a page scored
  // worse precisely for putting its catalog on the first screen — it was
  // written when nothing but chrome was up there. interactiveCount now
  // measures competing chrome; content is reported separately.
  const primaryRoot = primary
    ? (primary.closest('[data-vendor-grid],[role="list"],ul,ol,section') || primary.parentElement)
    : null;
  const isContent = e => primaryRoot ? primaryRoot.contains(e) : false;
  const chromeInFold = topLevelInFold.filter(e => !isContent(e));
  const contentInFold = topLevelInFold.filter(isContent);

  const primaryInFold = primary
    ? primary.getBoundingClientRect().top < vh
    : false;

  // --- fixed / sticky chrome budget ----------------------------------------
  // Measured while SCROLLED, not at rest: sticky bars that are inert at
  // scrollY 0 are exactly the ones that eat the viewport during real use.
  const chrome = [...document.querySelectorAll('body *')].filter(e => {
    const s = getComputedStyle(e);
    return (s.position === 'fixed' || s.position === 'sticky')
      && visible(e) && e.getBoundingClientRect().height > 4;
  });
  // Only outermost pinned elements — a sticky bar's sticky children are the
  // same pixels counted twice.
  const chromeTop = chrome.filter(e => !chrome.some(o => o !== e && o.contains(e)));
  const chromePx = chromeTop.reduce((a, e) => a + round(e.getBoundingClientRect().height), 0);

  // --- design-system entropy ------------------------------------------------
  // This block is "dated" made quantitative. A design system is a small,
  // deliberate set of choices; entropy counts how far the page has drifted
  // from having one. It is a DRIFT metric, not a quality metric — lower is
  // better only against the same page's own history.
  const els = [...document.querySelectorAll('body *')].filter(visible).slice(0, 4000);
  const bag = k => { const m = new Map(); return { add: v => m.set(v, (m.get(v)||0)+1), map: m }; };
  const sizes = bag(), weights = bag(), tracking = bag(), radii = bag(),
        shadows = bag(), colors = bag(), families = bag();

  let monoUpperChars = 0, totalChars = 0;
  for (const el of els) {
    const s = getComputedStyle(el);
    sizes.add(s.fontSize); weights.add(s.fontWeight); tracking.add(s.letterSpacing);
    radii.add(s.borderRadius); families.add(s.fontFamily.split(',')[0].replace(/["']/g,'').trim());
    if (s.boxShadow && s.boxShadow !== 'none') shadows.add(s.boxShadow);
    colors.add(s.color);
    if (s.backgroundColor && !/rgba\\(0, 0, 0, 0\\)/.test(s.backgroundColor)) colors.add(s.backgroundColor);

    // The specific dating risk the visual-design research named: the uppercase
    // wide-tracked mono microlabel is this site's signature AND its biggest
    // liability. Ratio, not count — the goal is rationing it, not deleting it.
    const own = [...el.childNodes].filter(n => n.nodeType === 3)
      .map(n => n.textContent.trim()).join('');
    if (own.length) {
      totalChars += own.length;
      const isMono = /mono|JetBrains|Courier|ui-monospace/i.test(s.fontFamily);
      const isUpper = s.textTransform === 'uppercase' || own === own.toUpperCase();
      const wideTrack = parseFloat(s.letterSpacing) > 0.5;
      if (isMono && isUpper && wideTrack) monoUpperChars += own.length;
    }
  }

  // --- accessibility --------------------------------------------------------
  const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible);
  const levels = hs.map(h => +h.tagName[1]);
  let skips = 0;
  for (let i = 1; i < levels.length; i++) if (levels[i] - levels[i-1] > 1) skips++;

  // The "stretched link" pattern (a::after{position:absolute;inset:0}) makes the
  // ancestor the real hit area, so measuring the anchor's own text box reports a
  // 60x19 target for what is actually a whole card. getComputedStyle CAN read the
  // pseudo-element, so detect it and credit the offset parent instead.
  const hitRect = el => {
    const r = el.getBoundingClientRect();
    const af = getComputedStyle(el, '::after');
    const stretched = af && af.position === 'absolute' &&
      ['top','right','bottom','left'].every(k => af[k] === '0px' || af[k] === 'auto') &&
      af.content !== 'none';
    if (!stretched) return r;
    const host = el.offsetParent || el.closest('article,li,.card') || el.parentElement;
    return host ? host.getBoundingClientRect() : r;
  };
  const tapTargets = [...document.querySelectorAll('a,button,input,select,[role="button"]')]
    .filter(visible)
    .map(e => { const r = hitRect(e); return { w: r.width, h: r.height,
      label: (e.getAttribute('aria-label') || e.textContent || '').replace(/\\s+/g,' ').trim().slice(0,40) }; });
  const smallTargets = tapTargets.filter(t => t.w < 44 || t.h < 44);

  // WCAG relative luminance + contrast ratio.
  const lum = c => {
    const m = c.match(/[\\d.]+/g); if (!m) return null;
    const [r,g,b] = m.slice(0,3).map(v => { v = +v/255;
      return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); });
    return 0.2126*r + 0.7152*g + 0.0722*b;
  };
  // Walks up for the first non-transparent ancestor background, because text
  // sitting on a transparent card inherits the page ground, not the card.
  const bgOf = el => {
    let n = el;
    while (n && n !== document.documentElement) {
      const bc = getComputedStyle(n).backgroundColor;
      if (bc && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(bc)) return bc;
      n = n.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
  const textEls = els.filter(e =>
    [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 3));
  const contrasts = [];
  for (const el of textEls.slice(0, 600)) {
    const s = getComputedStyle(el);
    const lf = lum(s.color), lb = lum(bgOf(el));
    if (lf == null || lb == null) continue;
    const ratio = (Math.max(lf,lb) + 0.05) / (Math.min(lf,lb) + 0.05);
    const px = parseFloat(s.fontSize);
    const large = px >= 24 || (px >= 18.66 && +s.fontWeight >= 700);
    contrasts.push({ ratio: +ratio.toFixed(2), px, large,
      required: large ? 3 : 4.5,
      text: (el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,44) });
  }
  const failing = contrasts.filter(c => c.ratio < c.required);

  const uniq = b => b.map.size;
  return {
    viewportPx: [vw, vh],
    contentReach: {
      primarySelector: primarySel,
      primaryFound: !!primary,
      pxToPrimary: primaryY,
      screensToPrimary: primaryY != null ? +(primaryY / vh).toFixed(2) : null,
      primaryAboveFold: primaryInFold,
    },
    scale: {
      pageHeightPx: docH,
      screensTall: +(docH / vh).toFixed(1),
      domNodes: document.querySelectorAll('*').length,
    },
    aboveFold: {
      interactiveCount: chromeInFold.length,
      primaryItemsInFold: contentInFold.length,
      interactiveLabels: chromeInFold.slice(0, 30).map(e =>
        (e.getAttribute('aria-label') || e.textContent || e.placeholder || e.tagName)
          .replace(/\\s+/g,' ').trim().slice(0, 40)),
    },
    chrome: {
      pinnedCount: chromeTop.length,
      pinnedPx: chromePx,
      pinnedRatio: +(chromePx / vh).toFixed(3),
      pinned: chromeTop.map(e => ({ h: round(e.getBoundingClientRect().height),
        pos: getComputedStyle(e).position,
        text: (e.textContent||'').replace(/\\s+/g,' ').trim().slice(0, 44) })),
    },
    entropy: {
      fontSizes: uniq(sizes), fontWeights: uniq(weights), letterSpacings: uniq(tracking),
      borderRadii: uniq(radii), boxShadows: uniq(shadows), colors: uniq(colors),
      fontFamilies: uniq(families),
      total: uniq(sizes) + uniq(weights) + uniq(tracking) + uniq(radii) + uniq(shadows),
      monoUppercaseCharRatio: totalChars ? +(monoUpperChars/totalChars).toFixed(3) : 0,
      topFontSizes: [...sizes.map.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12),
    },
    a11y: {
      h1Count: hs.filter(h => h.tagName === 'H1').length,
      headingCount: hs.length,
      headingLevelSkips: skips,
      headingsPer1000px: +((hs.length / docH) * 1000).toFixed(2),
      outline: hs.slice(0, 25).map(h => h.tagName + ' ' + (h.textContent||'').replace(/\\s+/g,' ').trim().slice(0,44)),
      tapTargetsTotal: tapTargets.length,
      tapTargetsUnder44: smallTargets.length,
      smallestTargets: smallTargets.sort((a,b)=>(a.w*a.h)-(b.w*b.h)).slice(0,8)
        .map(t => ({ label: t.label, size: [round(t.w), round(t.h)] })),
      contrastSamples: contrasts.length,
      contrastFailures: failing.length,
      worstContrast: failing.sort((a,b)=>a.ratio-b.ratio).slice(0,8),
    },
  };
}`;

// ---------------------------------------------------------------------------

async function measureViewport(browser, url, vp, primarySel) {
  const page = await browser.newPage();
  await page.setViewport({
    width: vp.width, height: vp.height,
    deviceScaleFactor: vp.dsf, isMobile: vp.mobile, hasTouch: vp.mobile,
  });

  // Web-vitals collection must be installed before any document script runs,
  // or the LCP/CLS entries that fire during initial paint are already gone.
  await page.evaluateOnNewDocument(() => {
    window.__vitals = { lcp: 0, cls: 0, longTasks: 0, longTaskMs: 0 };
    new PerformanceObserver(l => {
      for (const e of l.getEntries()) window.__vitals.lcp = Math.max(window.__vitals.lcp, e.startTime);
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver(l => {
      for (const e of l.getEntries()) if (!e.hadRecentInput) window.__vitals.cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver(l => {
      for (const e of l.getEntries()) { window.__vitals.longTasks++; window.__vitals.longTaskMs += e.duration; }
    }).observe({ type: "longtask", buffered: true });
  });

  const t0 = Date.now();
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  const loadMs = Date.now() - t0;

  // FREEZE THE VITALS BEFORE ANY SCRIPTED SCROLL (2026-09-05).
  //
  // LCP is finalised, per spec, at the user's first interaction — and the
  // settle step below scrolls to the bottom of the page. Every large
  // element that enters the viewport on the way down fires a NEW
  // largest-contentful-paint candidate with a later startTime, and the
  // `Math.max` above happily takes it. So the reading was not LCP at all;
  // it was "the largest thing anywhere on the page, timed by when the
  // scroll reached it".
  //
  // Measured on production 2026-09-05: this reported 2,964ms on mobile /
  // with NO throttling, while a 4x-CPU-throttled probe of the same URL saw
  // 864ms cold and 312ms warm with a single LCP candidate, FCP == LCP and
  // CLS 0. An unthrottled run cannot be three times slower than a
  // throttled one — the number was an artifact of the walk, and it scales
  // with page LENGTH, so the tallest pages looked the slowest.
  //
  // CLS has the same exposure and it is worse than it looks: a scripted
  // `window.scrollTo` does NOT set `hadRecentInput`, so any lazy-load
  // shift during the settle walk counts in full against the score. It
  // happens to read 0 today; that is luck, not protection.
  //
  // Long tasks stay cumulative on purpose — main-thread blocking during a
  // scroll is real jank a visitor would feel, not a measurement artifact.
  const vitalsAtPaint = await page.evaluate(
    () => ({ lcp: window.__vitals.lcp, cls: window.__vitals.cls }),
  );

  // Settle: scroll-revealed content must have had its chance to appear, or
  // contentReach measures a page that is still assembling itself.
  await page.evaluate(async () => {
    await new Promise(r => setTimeout(r, 600));
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise(r => setTimeout(r, 400));
  });

  // Chrome is measured mid-page, where sticky bars are actually pinned.
  await page.evaluate(() => window.scrollTo(0, innerHeight * 1.5));
  await new Promise(r => setTimeout(r, 300));
  const chromeProbe = await page.evaluate(`(${PROBE})(${JSON.stringify(primarySel)})`);

  // Everything else is measured from the top, as a visitor first sees it.
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise(r => setTimeout(r, 300));
  const topProbe = await page.evaluate(`(${PROBE})(${JSON.stringify(primarySel)})`);

  // INP proxy: real INP needs field data. This measures the main thread's
  // responsiveness to a synthetic tap on a real control — the same failure it
  // would catch (a filter click that blocks on a 132-card re-render).
  const interaction = await page.evaluate(async () => {
    const btn = document.querySelector('button:not([disabled])');
    if (!btn) return null;
    const t = performance.now();
    btn.click();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return +(performance.now() - t).toFixed(1);
  });

  const vitals = await page.evaluate(() => window.__vitals);
  await page.close();

  return {
    ...topProbe,
    chrome: chromeProbe.chrome, // the scrolled reading is the honest one
    perf: {
      loadMs,
      // From the pre-scroll snapshot, never the post-walk accumulator.
      lcpMs: Math.round(vitalsAtPaint.lcp),
      cls: +vitalsAtPaint.cls.toFixed(4),
      longTasks: vitals.longTasks, longTaskMs: Math.round(vitals.longTaskMs),
      firstInteractionMs: interaction,
    },
  };
}

/** One number per viewport, so a loop can ask "did it improve?" and get an answer. */
function grade(v) {
  const clamp = n => Math.max(0, Math.min(100, n));
  const vh = v.viewportPx[1];
  const s = {
    // Reaching the point of the page. Full marks above the fold, zero at 3 screens.
    reach: v.contentReach.pxToPrimary == null ? 0
      : clamp(100 - ((v.contentReach.pxToPrimary / vh) / 3) * 100),
    // Above-fold decisions. 6 or fewer is clean; 24+ is noise.
    focus: clamp(100 - ((v.aboveFold.interactiveCount - 6) / 18) * 100),
    // Chrome budget. 15% of viewport is fine, 40% is the documented failure case.
    chrome: clamp(100 - ((v.chrome.pinnedRatio - 0.15) / 0.25) * 100),
    // Vocabulary drift. 40 distinct treatments is a system; 120 is accretion.
    entropy: clamp(100 - ((v.entropy.total - 40) / 80) * 100),
    // Accessibility: heading structure, contrast, tap targets.
    a11y: clamp(100
      - (v.a11y.h1Count === 1 ? 0 : 25)
      - v.a11y.headingLevelSkips * 5
      - Math.min(30, v.a11y.contrastFailures * 2)
      - Math.min(20, v.a11y.tapTargetsUnder44)),
    // Core Web Vitals against the documented p75 thresholds.
    perf: clamp(100
      - Math.max(0, (v.perf.lcpMs - 2500) / 25)
      - Math.max(0, (v.perf.cls - 0.1) * 500)
      - Math.max(0, (v.perf.longTaskMs - 200) / 20)),
  };
  const round = o => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, Math.round(x)]));
  return { ...round(s), overall: Math.round(Object.values(s).reduce((a, b) => a + b) / 6) };
}

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : d;
};

async function run() {
  mkdirSync(OUT_DIR, { recursive: true });

  const compare = process.argv.indexOf("--compare");
  if (compare > -1) return doCompare(process.argv[compare + 1], process.argv[compare + 2]);

  const url = arg("url");
  const label = arg("label");
  if (!url || !label) {
    console.error("usage: --url <url> --label <name> [--primary <selector>]");
    console.error("       --compare <labelA> <labelB>");
    process.exit(1);
  }
  const primarySel = primarySelectorFor(url, arg("primary"));

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb"],
  });

  const result = { label, url, primarySelector: primarySel, measuredAt: new Date().toISOString(), viewports: {} };
  for (const vp of VIEWPORTS) {
    process.stderr.write(`  measuring ${vp.name}…\n`);
    const v = await measureViewport(browser, url, vp, primarySel);
    result.viewports[vp.name] = { ...v, score: grade(v) };
  }
  await browser.close();

  writeFileSync(join(OUT_DIR, `${label}.json`), JSON.stringify(result, null, 2));
  report(result);
  console.log(`\nwrote design-baselines/${label}.json`);
}

function report(r) {
  console.log(`\n${"═".repeat(64)}\n  ${r.label}  ·  ${r.url}\n${"═".repeat(64)}`);
  for (const [name, v] of Object.entries(r.viewports)) {
    console.log(`\n▸ ${name}  (${v.viewportPx.join("×")})   OVERALL ${v.score.overall}/100`);
    console.log(`  reach ${v.score.reach}  focus ${v.score.focus}  chrome ${v.score.chrome}  entropy ${v.score.entropy}  a11y ${v.score.a11y}  perf ${v.score.perf}`);
    console.log(`  · ${v.contentReach.pxToPrimary}px (${v.contentReach.screensToPrimary} screens) to primary content` +
                `${v.contentReach.primaryAboveFold ? "  ✓ above fold" : "  ✗ below fold"}`);
    console.log(`  · ${v.aboveFold.interactiveCount} interactive elements above the fold`);
    console.log(`  · ${v.chrome.pinnedPx}px pinned chrome (${(v.chrome.pinnedRatio*100).toFixed(0)}% of viewport)`);
    console.log(`  · page ${v.scale.screensTall} screens tall, ${v.scale.domNodes} DOM nodes`);
    console.log(`  · entropy ${v.entropy.total} (${v.entropy.fontSizes} sizes, ${v.entropy.fontWeights} weights, ${v.entropy.borderRadii} radii, ${v.entropy.boxShadows} shadows)`);
    console.log(`  · mono-uppercase text ratio ${(v.entropy.monoUppercaseCharRatio*100).toFixed(1)}%`);
    console.log(`  · headings ${v.a11y.headingCount} (h1×${v.a11y.h1Count}, ${v.a11y.headingLevelSkips} skips), ${v.a11y.contrastFailures} contrast failures, ${v.a11y.tapTargetsUnder44} small tap targets`);
    console.log(`  · LCP ${v.perf.lcpMs}ms  CLS ${v.perf.cls}  longtasks ${v.perf.longTaskMs}ms`);
  }
}

function doCompare(a, b) {
  const load = l => {
    const p = join(OUT_DIR, `${l}.json`);
    if (!existsSync(p)) { console.error(`missing design-baselines/${l}.json`); process.exit(1); }
    return JSON.parse(readFileSync(p, "utf8"));
  };
  const A = load(a), B = load(b);
  console.log(`\n${"═".repeat(64)}\n  ${a}  →  ${b}\n${"═".repeat(64)}`);

  // Direction matters per metric: some are better lower, some higher.
  const LOWER_BETTER = new Set(["pxToPrimary", "interactive", "pinnedRatio", "entropy",
    "monoUpper", "screensTall", "domNodes", "contrastFails", "smallTargets", "lcpMs", "cls"]);
  let regressions = 0;

  for (const vp of Object.keys(B.viewports)) {
    const x = A.viewports[vp], y = B.viewports[vp];
    if (!x) continue;
    console.log(`\n▸ ${vp}`);
    const rows = [
      ["OVERALL", x.score.overall, y.score.overall, "overall"],
      ["pxToPrimary", x.contentReach.pxToPrimary, y.contentReach.pxToPrimary, "pxToPrimary"],
      ["interactive", x.aboveFold.interactiveCount, y.aboveFold.interactiveCount, "interactive"],
      ["pinnedRatio", x.chrome.pinnedRatio, y.chrome.pinnedRatio, "pinnedRatio"],
      ["entropy", x.entropy.total, y.entropy.total, "entropy"],
      ["monoUpper", x.entropy.monoUppercaseCharRatio, y.entropy.monoUppercaseCharRatio, "monoUpper"],
      ["screensTall", x.scale.screensTall, y.scale.screensTall, "screensTall"],
      ["contrastFails", x.a11y.contrastFailures, y.a11y.contrastFailures, "contrastFails"],
      ["smallTargets", x.a11y.tapTargetsUnder44, y.a11y.tapTargetsUnder44, "smallTargets"],
      ["lcpMs", x.perf.lcpMs, y.perf.lcpMs, "lcpMs"],
      ["cls", x.perf.cls, y.perf.cls, "cls"],
    ];
    // Noise floor, measured 2026-08-23 by running one unchanged page three times:
    // LCP varied 12ms (mobile) / 24ms (desktop) run-to-run, and CLS jitters in the
    // third decimal. Timing metrics therefore need a deadband or the gate reports
    // variance as regression. Structural metrics (px, counts, entropy) are exact
    // and get NO tolerance — those are the ones that must never quietly slip.
    const DEADBAND = { lcpMs: 60, cls: 0.005 };
    for (const [name, av, bv, key] of rows) {
      if (av == null || bv == null) continue;
      const d = bv - av;
      const tol = DEADBAND[key] ?? 0;
      const better = LOWER_BETTER.has(key) ? d < 0 : d > 0;
      const same = Math.abs(d) <= Math.max(tol, 1e-9);
      if (!same && !better) regressions++;
      const mark = same ? "  ·" : better ? "  ✓" : "  ✗";
      const pct = av !== 0 ? ` (${d > 0 ? "+" : ""}${((d / Math.abs(av)) * 100).toFixed(0)}%)` : "";
      console.log(`${mark} ${name.padEnd(15)} ${String(av).padStart(9)} → ${String(bv).padStart(9)}${pct}`);
    }
  }
  console.log(`\n${regressions === 0
    ? "✓ no regressions — every measured axis held or improved"
    : `✗ ${regressions} regression(s) — not yet measurably better`}`);
  process.exitCode = regressions === 0 ? 0 : 1;
}

run().catch(e => { console.error(e); process.exit(1); });
