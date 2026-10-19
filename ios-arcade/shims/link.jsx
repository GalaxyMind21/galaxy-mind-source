import { createElement } from "react";

/** In-app stand-in for next/link. Same-origin paths stay in the web view. */
export default function Link({ href, children, ...rest }) {
  const h = typeof href === "string" ? href : (href && href.pathname) || "/";
  return createElement("a", { href: h, ...rest }, children);
}
