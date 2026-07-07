// DOM utilities: which text nodes to touch, how to collect them, and how to
// modify/restore them without losing the original page.

import { originals, touched } from "./state.js";

const EXCLUDE_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT"]);
const EXCLUDE_SELECTOR = "pre, code, textarea, input, select, option, [contenteditable]";

export function shouldSkipTextNode(node) {
  if (!node || node.nodeType !== Node.TEXT_NODE) return true;
  if (touched.has(node)) return true;

  const el = node.parentElement;
  if (!el) return true;
  if (EXCLUDE_TAGS.has(el.tagName)) return true;
  if (el.matches(EXCLUDE_SELECTOR)) return true;
  if (el.closest(EXCLUDE_SELECTOR)) return true;

  // Never descend into our own wrappers/ruby.
  if (el.closest("[data-ct]")) return true;
  if (el.closest(".ct-ruby")) return true;

  const txt = node.nodeValue;
  return !txt || !txt.trim();
}

export function collectTextNodes(root = document.body) {
  const out = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return shouldSkipTextNode(node)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  let n;
  while ((n = walker.nextNode())) out.push(n);
  return out;
}

// Swap a text node for a wrapper element, recording enough to undo it.
// Returns false if the node vanished mid-flight (dynamic pages).
export function replaceTextNode(node, wrapper) {
  const parent = node?.parentNode;
  if (!parent) return false;

  if (!originals.has(node)) {
    originals.set(node, { text: node.nodeValue, parent, nextSibling: node.nextSibling, wrapper: null });
  }

  try {
    parent.insertBefore(wrapper, node);
  } catch {
    return false; // parent changed in between
  }
  try { node.remove(); } catch { /* already gone */ }

  const rec = originals.get(node);
  if (rec && !rec.wrapper) rec.wrapper = wrapper;

  touched.add(node);
  return true;
}

// In-place text replacement (translate mode), also recorded for undo.
export function applyTranslations(nodes, translations) {
  nodes.forEach((n, i) => {
    try {
      if (!n) return;
      if (!originals.has(n)) {
        originals.set(n, { text: n.nodeValue, parent: n.parentNode, nextSibling: n.nextSibling, wrapper: null });
      }
      n.nodeValue = translations[i];
      touched.add(n);
    } catch { /* node died mid-update; skip */ }
  });
}

// Undo everything: remove wrappers, restore original text, reattach nodes.
export function revertAll() {
  originals.forEach((rec, node) => {
    try {
      if (rec?.wrapper?.parentNode) {
        try { rec.wrapper.remove(); } catch { /* ignore */ }
      }
      if (typeof rec?.text === "string") node.nodeValue = rec.text;

      const p = rec?.parent;
      if (p && !node.parentNode) {
        try {
          if (rec.nextSibling && rec.nextSibling.parentNode === p) {
            p.insertBefore(node, rec.nextSibling);
          } else {
            p.appendChild(node);
          }
        } catch { /* parent is gone; nothing to restore into */ }
      }
    } catch { /* keep restoring the rest */ }
  });
  originals.clear();
  touched.reset();

  try {
    const html = document.documentElement;
    html.removeAttribute("data-ct-pinyin-applied");
    html.removeAttribute("data-ct-pinyin-pending");
  } catch { /* ignore */ }
}

// Timing helpers
export function raf() { return new Promise(r => requestAnimationFrame(r)); }
export async function raf2() { await raf(); await raf(); }
