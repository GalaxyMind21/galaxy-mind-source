// /submit website field · forgiving input, strict output.
//
// The API (lib/submit-guard) only accepts an https:// URL, and that rule
// stays. What changes is the form: a shop owner who types "myshop.com" or
// pastes the http:// link from their X bio used to get a greyed-out
// "Submit for review (1 field left)" button and a small "must be an
// https:// URL" hint, and nothing else. North Idaho Tallow Co. (Oct 17)
// hit exactly that, wrote "It's not letting me submit?" in the note, and
// only got through by pasting its BTCPay checkout URL instead of its shop.
//
// normalizeWebsiteInput() upgrades the obvious cases before the form
// checks or sends anything. It never invents a host: anything that does
// not look like a domain is returned as typed, so the usual validation
// message still shows.

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// host.tld with an optional port/path/query · no spaces, at least one dot,
// a 2+ letter TLD.
const BARE_HOST = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d{1,5})?(?:[/?#]\S*)?$/i;

export function normalizeWebsiteInput(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  if (/^https:\/\//i.test(v)) return "https://" + v.slice(8);
  if (/^http:\/\//i.test(v)) {
    const rest = v.slice(7);
    return rest ? "https://" + rest : v;
  }
  if (v.startsWith("//") && BARE_HOST.test(v.slice(2))) return "https:" + v;
  if (HAS_SCHEME.test(v) && !/^[a-z0-9-]+\.[a-z]/i.test(v)) return v;
  if (BARE_HOST.test(v)) return "https://" + v;
  return v;
}
