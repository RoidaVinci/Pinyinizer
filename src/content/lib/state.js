// Shared mutable state for the content script (one instance per frame).

export const state = {
  settings: null,
  langs: { source: "auto", target: null }, // set by translate-mode from page + settings
  isMutating: false,      // suppress our own MutationObserver echoes
  disconnectObserver: null,
};

// Full restoration records for everything we changed:
// Map<TextNode, { text, parent, nextSibling, wrapper }>
export const originals = new Map();

// Nodes we've already processed (WeakSet is reset on revert).
let touchedSet = new WeakSet();
export const touched = {
  has: (n) => touchedSet.has(n),
  add: (n) => touchedSet.add(n),
  reset: () => { touchedSet = new WeakSet(); },
};

export function getMode() {
  return state.settings?.mode || "translate";
}

// The user's preferred target language, independent of any page detection.
export function preferredTarget() {
  return state.settings?.targetLangs?.[0] || "en";
}
