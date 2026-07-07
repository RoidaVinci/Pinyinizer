// Debounced MutationObserver: batches added/changed text nodes and hands them
// to the active mode. Ignores mutations we cause ourselves (state.isMutating).

import { state } from "./state.js";
import { collectTextNodes, shouldSkipTextNode } from "./dom.js";

const FLUSH_MS = 50;

export function startMutationObserver(onTextNodes) {
  let pending = new Set();
  let flushTimer = null;

  const mo = new MutationObserver((muts) => {
    if (state.isMutating) return;

    for (const m of muts) {
      if (m.type === "childList") {
        m.addedNodes.forEach((n) => {
          if (n.nodeType === Node.TEXT_NODE && !shouldSkipTextNode(n)) pending.add(n);
          else if (n.nodeType === Node.ELEMENT_NODE) collectTextNodes(n).forEach((t) => pending.add(t));
        });
      } else if (m.type === "characterData") {
        if (!shouldSkipTextNode(m.target)) pending.add(m.target);
      }
    }

    if (!flushTimer && pending.size) {
      flushTimer = setTimeout(() => {
        const batch = Array.from(pending);
        pending = new Set();
        flushTimer = null;
        onTextNodes(batch);
      }, FLUSH_MS);
    }
  });

  mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  return () => {
    mo.disconnect();
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  };
}
