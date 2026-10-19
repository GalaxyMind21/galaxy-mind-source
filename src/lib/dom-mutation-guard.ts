/**
 * dom-mutation-guard · keeps React alive when something outside React
 * rewrites the DOM under it.
 *
 * THE FAILURE. Browser page translation (Chrome and Edge built-in
 * Translate, Firefox Translations) replaces the text nodes React rendered
 * with <font> wrappers, or moves them inside one. React still holds the
 * old node. On the next re-render (a directory filter, opening a vendor
 * modal, a live number ticking on /stack) it calls
 * parent.removeChild(oldText) or parent.insertBefore(next, oldText), the
 * node is no longer that parent's child, the DOM throws NotFoundError,
 * and app/error.tsx swaps the whole page for "We hit an unexpected
 * error". Upstream: facebook/react#11538, open since 2017.
 *
 * THE EVIDENCE (Vercel Web Analytics, 30 days to 2026-10-06). client_error
 * fired 48 times for 22 visitors. Apart from two chunk-load failures and
 * one "Load failed", every message was one of these two DOM errors
 * (/stack 13 visitors, / 5, /hashrate 1, the games 3). 15 of the 22
 * arrived from bitcoin.org. 21 of the 22 were outside the US and 18 were
 * on Chrome Mobile or Edge (ID, BR, NL, AT, CZ, GR, KR, MX, TH and more),
 * which is the translate-prompt population. 69% of homepage visitors are
 * outside the US.
 *
 * THE GUARD. Patch the two Node.prototype methods so that ONLY the calls
 * that would otherwise throw NotFoundError for a parent mismatch are
 * handled softly:
 *   - removeChild(child) where child.parentNode !== this. If the child
 *     now sits deeper inside this subtree (wrapped by a translator), it
 *     is removed from that real holder, which is what React asked for.
 *     If it is detached, or lives outside this subtree, nothing is
 *     touched. Either way child is returned, as the native method does.
 *   - insertBefore(node, ref) where ref is non-null and
 *     ref.parentNode !== this. Insert before the ancestor of ref that IS
 *     a direct child of this (the wrapper), which keeps document order.
 *     If ref is not inside this at all, append.
 * Every other call, including every call that would succeed and every
 * call that would throw for any other reason, reaches the native method
 * unchanged. Installing twice is a no-op.
 *
 * WHY NOT translate="no". That stops the crash by refusing to translate
 * the site for the two thirds of directory visitors who are outside the
 * US. A shopper who cannot read the directory does not reach a shop
 * either.
 *
 * Pure: takes the prototype as an argument so
 * scripts/test-dom-mutation-guard.ts can drive it with fake nodes and no
 * DOM.
 */

export type DomGuardOp = "removeChild" | "insertBefore";

const INSTALLED = "__gmDomMutationGuard";

type NodeLike = { parentNode: unknown };
type Method = (this: unknown, ...args: unknown[]) => unknown;

function isNodeLike(v: unknown): v is NodeLike {
  return typeof v === "object" && v !== null && "parentNode" in v;
}

/**
 * The ancestor-or-self of `ref` whose parentNode is `parent`, or null
 * when ref is not inside parent at all. Bounded so a cycle in a fake
 * tree cannot spin.
 */
export function directChildContaining(
  parent: unknown,
  ref: unknown,
): unknown {
  let cur: unknown = ref;
  for (let depth = 0; depth < 64 && isNodeLike(cur); depth++) {
    if (cur.parentNode === parent) return cur;
    cur = cur.parentNode;
  }
  return null;
}

export function installDomMutationGuard(
  proto: object,
  onRecover?: (op: DomGuardOp) => void,
): boolean {
  const target = proto as Record<string, unknown>;
  if (target[INSTALLED] === true) return false;
  const nativeRemove = target.removeChild;
  const nativeInsert = target.insertBefore;
  if (
    typeof nativeRemove !== "function" ||
    typeof nativeInsert !== "function"
  ) {
    return false;
  }
  const remove = nativeRemove as Method;
  const insert = nativeInsert as Method;

  target.removeChild = function guardedRemoveChild(
    this: unknown,
    child: unknown,
  ) {
    if (isNodeLike(child) && child.parentNode !== this) {
      if (onRecover) onRecover("removeChild");
      const holder = child.parentNode;
      if (holder != null && directChildContaining(this, holder) !== null) {
        remove.call(holder, child);
      }
      return child;
    }
    return remove.call(this, child);
  };

  target.insertBefore = function guardedInsertBefore(
    this: unknown,
    node: unknown,
    ref: unknown,
  ) {
    if (isNodeLike(ref) && ref.parentNode !== this) {
      if (onRecover) onRecover("insertBefore");
      return insert.call(this, node, directChildContaining(this, ref));
    }
    return insert.call(this, node, ref);
  };

  Object.defineProperty(target, INSTALLED, { value: true });
  return true;
}
