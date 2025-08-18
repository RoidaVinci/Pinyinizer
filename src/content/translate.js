import { MARK_ATTR } from "../constants.js";

export function applyTranslations(nodes, translations) {
  nodes.forEach((n, i) => {
    try {
      const el = n.parentElement;
      if (!el) return;
      el.setAttribute(MARK_ATTR, "1");  // mark parent so we don't re-translate repeatedly
      n.nodeValue = translations[i];
    } catch {}
  });
}
