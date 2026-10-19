// Invariants for lib/dom-mutation-guard. Fake nodes, no DOM.
// The guard may only change calls that would otherwise throw a
// parent-mismatch NotFoundError. Everything else must reach the native
// method untouched, and the root layout must keep mounting it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  directChildContaining,
  installDomMutationGuard,
  type DomGuardOp,
} from "../src/lib/dom-mutation-guard";

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` · ${detail}` : ""}`);
  }
}

function throws(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

// Minimal DOM-shaped node with the same throw rules as the real methods.
class FakeNode {
  name: string;
  parentNode: FakeNode | null = null;
  childNodes: FakeNode[] = [];
  constructor(name: string) {
    this.name = name;
  }
  appendChild(child: FakeNode): FakeNode {
    return this.insertBefore(child, null);
  }
  removeChild(child: FakeNode): FakeNode {
    const i = this.childNodes.indexOf(child);
    if (i < 0) throw new Error("NotFoundError: not a child of this node");
    this.childNodes.splice(i, 1);
    child.parentNode = null;
    return child;
  }
  insertBefore(node: FakeNode, ref: FakeNode | null): FakeNode {
    if (ref !== null && ref.parentNode !== this) {
      throw new Error("NotFoundError: reference is not a child of this node");
    }
    if (node.parentNode) node.parentNode.removeChild(node);
    const at =
      ref === null ? this.childNodes.length : this.childNodes.indexOf(ref);
    this.childNodes.splice(at, 0, node);
    node.parentNode = this;
    return node;
  }
}

const order = (n: FakeNode) => n.childNodes.map((c) => c.name).join(",");

// What a translator does to a text node React still owns: put a <font>
// where it was and take the original out.
function translateAway(parent: FakeNode, text: FakeNode): FakeNode {
  const font = new FakeNode("font");
  parent.insertBefore(font, text);
  parent.removeChild(text);
  return font;
}

// The other shape: the original node is moved INSIDE a <font> wrapper.
function wrapInFont(parent: FakeNode, text: FakeNode): FakeNode {
  const font = new FakeNode("font");
  parent.insertBefore(font, text);
  font.appendChild(text);
  return font;
}

console.log("── dom-mutation-guard · fixture sanity, unguarded ─");
{
  const p = new FakeNode("p");
  const t = new FakeNode("t");
  p.appendChild(t);
  translateAway(p, t);
  assert(
    "unguarded removeChild of a translated-away node throws",
    throws(() => p.removeChild(t)),
  );
  assert(
    "unguarded insertBefore a translated-away anchor throws",
    throws(() => p.insertBefore(new FakeNode("n"), t)),
  );
}

const recovered: DomGuardOp[] = [];
console.log("── dom-mutation-guard · install ───────────────────");
{
  assert(
    "first install patches the prototype",
    installDomMutationGuard(FakeNode.prototype, (op) => {
      recovered.push(op);
    }) === true,
  );
  assert(
    "second install is a no-op",
    installDomMutationGuard(FakeNode.prototype) === false,
  );
  assert(
    "a prototype without the methods is left alone",
    installDomMutationGuard({}) === false,
  );
}

console.log("── dom-mutation-guard · native paths untouched ────");
{
  const p = new FakeNode("p");
  const a = new FakeNode("a");
  const b = new FakeNode("b");
  p.appendChild(a);
  p.appendChild(b);
  const c = new FakeNode("c");
  assert("insertBefore a real child returns the node", p.insertBefore(c, b) === c);
  assert("insertBefore a real child keeps order", order(p) === "a,c,b", order(p));
  assert("removeChild a real child returns it", p.removeChild(c) === c);
  assert("removeChild a real child detaches it", order(p) === "a,b" && c.parentNode === null);
  assert("insertBefore null appends", p.insertBefore(c, null) === c && order(p) === "a,b,c");
  assert("no recovery fired on healthy calls", recovered.length === 0, recovered.join(","));
  assert(
    "a non-node removeChild still throws natively",
    throws(() => p.removeChild(null as unknown as FakeNode)),
  );
  assert("a native throw is not counted as a recovery", recovered.length === 0);
}

console.log("── dom-mutation-guard · translated-away text ──────");
{
  const p = new FakeNode("p");
  const label = new FakeNode("label");
  const t = new FakeNode("t");
  const tail = new FakeNode("tail");
  p.appendChild(label);
  p.appendChild(t);
  p.appendChild(tail);
  translateAway(p, t);
  const box: { out: unknown } = { out: null };
  assert("removeChild does not throw", !throws(() => (box.out = p.removeChild(t))));
  assert("removeChild returns the child", box.out === t);
  assert("removeChild leaves the translated tree alone", order(p) === "label,font,tail", order(p));
  assert("removeChild recovery is reported", recovered[recovered.length - 1] === "removeChild");
  const n = new FakeNode("n");
  assert("insertBefore does not throw", !throws(() => p.insertBefore(n, t)));
  assert("insertBefore a detached anchor appends", order(p) === "label,font,tail,n", order(p));
  assert("insertBefore recovery is reported", recovered[recovered.length - 1] === "insertBefore");
}

console.log("── dom-mutation-guard · wrapped text ──────────────");
{
  const p = new FakeNode("p");
  const a = new FakeNode("a");
  const t = new FakeNode("t");
  const b = new FakeNode("b");
  p.appendChild(a);
  p.appendChild(t);
  p.appendChild(b);
  const font = wrapInFont(p, t);
  assert("fixture: t now lives inside font", t.parentNode === font && order(p) === "a,font,b");
  assert("directChildContaining finds the wrapper", directChildContaining(p, t) === font);
  assert(
    "directChildContaining is null for a stranger",
    directChildContaining(p, new FakeNode("x")) === null,
  );
  const n = new FakeNode("n");
  p.insertBefore(n, t);
  assert("insertBefore lands before the wrapper, keeping order", order(p) === "a,n,font,b", order(p));
  const r = p.removeChild(t);
  assert("removeChild of a wrapped node returns it", r === t);
  assert("removeChild takes the node out of its real holder", t.parentNode === null && font.childNodes.length === 0);
  assert("removeChild leaves the rest of the tree in order", order(p) === "a,n,font,b", order(p));
}

console.log("── dom-mutation-guard · foreign subtree ───────────");
{
  const p = new FakeNode("p");
  const q = new FakeNode("q");
  const x = new FakeNode("x");
  q.appendChild(x);
  assert("removeChild of a node in another tree does not throw", !throws(() => p.removeChild(x)));
  assert("removeChild never reaches into another tree", x.parentNode === q && order(q) === "x");
}

console.log("── dom-mutation-guard · wiring drift ──────────────");
{
  const layout = readFileSync(join(process.cwd(), "src", "app", "layout.tsx"), "utf8");
  assert("root layout imports the guard", layout.includes('from "@/components/DomMutationGuard"'));
  assert("root layout mounts <DomMutationGuard />", layout.includes("<DomMutationGuard />"));
  const comp = readFileSync(
    join(process.cwd(), "src", "components", "DomMutationGuard.tsx"),
    "utf8",
  );
  assert(
    "component installs on Node.prototype",
    comp.includes("installDomMutationGuard(") && comp.includes("Node.prototype"),
  );
  assert("install is not deferred into an effect", !comp.includes("useEffect"));
}

console.log(`\n${fail === 0 ? "✓" : "✗"} ${pass} passed · ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
