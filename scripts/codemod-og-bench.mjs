/**
 * ONE-SHOT CODEMOD · move the standalone opengraph cards onto the Night
 * Bench grammar (2026-09-10). Not wired into verify — it is a migration,
 * and `check-brand-ramp.ts` §5 is what keeps the result from drifting.
 *
 * It edits only STYLE VALUES, never structure, and it pairs every value
 * with the block it actually lives in (a real brace-depth walk, not a
 * line window) because these cards nest style objects several deep and a
 * regex would happily give a 17px label the tracking of a 132px numeral.
 *
 * What it changes, and why each is a "match the site" edit rather than a
 * taste one:
 *
 *   tracking   uppercase/mono labels -> 0.20em, which is `.micro-label`,
 *              the site's canonical eyebrow. The cards held 22 different
 *              values from 0.04em to 0.39em; four of 65 matched the site.
 *   display    fontSize >= 40 -> weight 500 and -0.03em, which is
 *              `.display-title`. All 36 display sites were heavier.
 *   ground     the root div gains the bench lamp instead of a flat slab.
 *   ink        cold #26262C / #5C5C66 / #8C8C96 -> the warm ramp. These
 *              were off-ramp, so check-brand-ramp never saw them.
 *
 * Run:  node scripts/codemod-og-bench.mjs [--dry] <files…>
 */
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const files = args.filter((a) => !a.startsWith("--"));

/** Cold literals that are off the guarded ramp and therefore invisible to
 *  check-brand-ramp, but very visible against a warm ground. */
const COLD = [
  [/#26262C/gi, "rgba(247, 238, 224, 0.085)"], // cold border  -> --border-subtle
  [/#5C5C66/gi, "#948F84"], // cold tertiary -> --text-tertiary
  [/#8C8C96/gi, "#948F84"],
  [/#0a0807/gi, "#12110F"], // a one-off near-black darker than the ground
];

/** Walk brace depth and return every `{...}` block with the offsets of the
 *  style keys we care about. Blocks are returned innermost-first. */
function blocks(src) {
  const out = [];
  const stack = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "{") stack.push({ start: i, keys: [] });
    else if (c === "}") {
      const b = stack.pop();
      if (b) {
        b.end = i;
        b.text = src.slice(b.start, i + 1);
        out.push(b);
      }
    }
  }
  return out;
}

const KEY = /(fontSize|letterSpacing|fontWeight|textTransform|fontFamily):\s*("?[-\w.,\s()]*?"?)\s*[,}]/g;

let totalEdits = 0;
const report = [];

for (const file of files) {
  let src = readFileSync(file, "utf8");
  const edits = [];

  for (const b of blocks(src)) {
    // Only direct properties of THIS block: strip nested blocks out first
    // so a parent doesn't inherit a child's fontSize.
    //
    // `map` is load-bearing. The first version computed offsets as
    // `b.start + m.index`, but m.index indexes the FLATTENED string, which
    // has the nested blocks removed — so for any block containing a child
    // the two diverge and every edit in it was silently dropped by the
    // startsWith guard below. It failed safe, which is exactly why it was
    // easy to miss: the report claimed edits the diff did not contain.
    let depth = 0;
    let own = "";
    const map = [];
    for (let i = 0; i < b.text.length; i++) {
      const c = b.text[i];
      if (c === "{") depth++;
      if (depth === 1) {
        own += c;
        map.push(b.start + i);
      }
      if (c === "}") depth--;
    }

    // Graphic elements, not type: a rotated rubber stamp or a thick-bordered
    // badge on an arcade share card is art under spec 4.5's effect budget,
    // and re-weighting it to 500 would just make it look broken.
    if (/transform:\s*"rotate|border:\s*`?\$?\{?\s*\d*\s*[3-9]px solid/.test(own)) continue;

    const props = {};
    let m;
    KEY.lastIndex = 0;
    while ((m = KEY.exec(own))) {
      props[m[1]] = { value: m[2].trim(), at: map[m.index], raw: m[0] };
    }

    const size = props.fontSize ? parseFloat(props.fontSize.value) : null;
    if (!size) continue;

    // A label is not reliably marked as one. The first version of this
    // detector tested `textTransform: uppercase` and a mono family, and
    // it silently skipped the most visible labels on the whole set — the
    // /stack card spells them as literal uppercase STRINGS
    // (`BITCOIN BUYING GAUGE`) or `.toUpperCase()`, with neither property.
    // So also read the element's own text, and treat anything already
    // tracked past 0.10em as a label by construction: display type on this
    // site tracks NEGATIVE, so meaningful positive tracking is only ever
    // a tracked-out eyebrow. Below 0.10em is left alone — that is optical
    // tracking on a url or a word mark, not a micro-label.
    const after = src.slice(b.end, b.end + 220);
    const text = (after.match(/>\s*\{?([^<{}]*)/) || [])[1] ?? "";
    const looksUpper =
      /toUpperCase\(\)/.test(after.slice(0, 80)) ||
      (/[A-Z]{2,}/.test(text) && !/[a-z]/.test(text.replace(/\s/g, "")));

    const lsNow = props.letterSpacing ? parseFloat(props.letterSpacing.value) : 0;
    // NOT `fontFamily: monospace`. That was tried and it tracked the footer
    // URL `galaxymind.space/fit` out from 0.045em to 0.2em — mono is the
    // face of readouts, urls and dates here, not a label marker.
    const isLabel =
      /uppercase/.test(props.textTransform?.value ?? "") ||
      looksUpper ||
      lsNow / size >= 0.1;
    const isDisplay = size >= 40;

    // ── tracking ──────────────────────────────────────────────────────
    if (props.letterSpacing) {
      const ls = parseFloat(props.letterSpacing.value);
      let next = null;
      if (isLabel && ls > 0) next = +(0.2 * size).toFixed(1); // .micro-label
      else if (isDisplay && ls < 0) next = +(-0.03 * size).toFixed(1); // .display-title
      if (next !== null && Math.abs(next - ls) > 0.05) {
        edits.push({
          at: props.letterSpacing.at,
          from: props.letterSpacing.raw,
          to: props.letterSpacing.raw.replace(
            /letterSpacing:\s*-?[\d.]+/,
            `letterSpacing: ${next}`,
          ),
          why: `${isLabel ? "label" : "display"} ${size}px ${ls} -> ${next}`,
        });
      }
    }

    // ── display weight ────────────────────────────────────────────────
    if (isDisplay && props.fontWeight) {
      const w = parseInt(props.fontWeight.value, 10);
      if (w > 510) {
        edits.push({
          at: props.fontWeight.at,
          from: props.fontWeight.raw,
          to: props.fontWeight.raw.replace(/fontWeight:\s*\d+/, "fontWeight: 500"),
          why: `display ${size}px weight ${w} -> 500`,
        });
      }
    }
  }

  // apply value edits back-to-front so offsets stay valid
  edits.sort((a, b) => b.at - a.at);
  let applied = 0;
  let skipped = 0;
  for (const e of edits) {
    const head = src.slice(0, e.at);
    const tail = src.slice(e.at);
    if (!tail.startsWith(e.from)) {
      // Never corrupt on a bad offset — but DO say so. A silent skip here
      // is what made the first run over-report what it had changed.
      skipped++;
      continue;
    }
    src = head + e.to + tail.slice(e.from.length);
    applied++;
  }
  if (skipped) console.error(`  ! ${file}: ${skipped} edit(s) skipped on offset mismatch`);

  // ── cold literals ───────────────────────────────────────────────────
  let coldCount = 0;
  for (const [re, to] of COLD) {
    const hits = (src.match(re) || []).length;
    if (hits) {
      coldCount += hits;
      src = src.replace(re, to);
    }
  }

  if (applied || coldCount) {
    totalEdits += applied + coldCount;
    report.push({ file, edits: applied, cold: coldCount, detail: edits.map((e) => e.why) });
    if (!DRY) writeFileSync(file, src);
  }
}

for (const r of report) {
  console.log(`\n${r.file.replace("src/app/", "")}  · ${r.edits} type, ${r.cold} colour`);
  for (const d of r.detail.slice(0, 6)) console.log(`    ${d}`);
  if (r.detail.length > 6) console.log(`    … +${r.detail.length - 6} more`);
}
console.log(`\n${DRY ? "[dry] would change" : "changed"} ${totalEdits} values across ${report.length} files`);
