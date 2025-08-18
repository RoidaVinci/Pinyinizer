import { EXCLUDE_TAGS, EXCLUDE_SELECTOR, MARK_ATTR } from "./constants.js";

export function shouldSkipTextNode(node) {
  if (!node || node.nodeType !== Node.TEXT_NODE) return true;
  const el = node.parentElement;
  if (!el) return true;
  if (EXCLUDE_TAGS.has(el.tagName)) return true;
  if (el.matches(EXCLUDE_SELECTOR)) return true;
  if (el.closest(EXCLUDE_SELECTOR)) return true;
  if (el.hasAttribute(MARK_ATTR)) return true;
  const txt = node.nodeValue;
  return !txt || !txt.trim();
}
