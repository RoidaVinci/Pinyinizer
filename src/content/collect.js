import { shouldSkipTextNode } from "../guards.js";

export function collectTextNodes(root = document.body) {
  const out = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) { return shouldSkipTextNode(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }
  });
  let n;
  while ((n = walker.nextNode())) out.push(n);
  return out;
}
