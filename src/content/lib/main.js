// Content-script entry point (ES module, loaded by ../index.js).
// Orchestrates: settings -> initial pass -> MutationObserver -> popup messages.

import { state, getMode } from "./state.js";
import { getSettings } from "./messaging.js";
import { revertAll, raf, raf2, shouldSkipTextNode } from "./dom.js";
import { startMutationObserver } from "./observer.js";
import { translateTree, translateNodes } from "./translate-mode.js";
import { annotateTreeWithLock, annotateNodes, hasPinyinDecorations } from "./pinyin-mode.js";
import { startLiveCaptions, stopLiveCaptions } from "./live-captions.js";

const html = document.documentElement;

async function main() {
  state.settings = await getSettings();
  if (!state.settings?.enabled) return;

  // Let a BFCache restore settle before checking for existing decorations.
  await raf2();
  await applyCurrentMode({ skipIfDecorated: true });

  // SPA navigations re-run translate mode; pinyin mode relies on the observer.
  addEventListener("popstate", onSpaNavigation);
  addEventListener("hashchange", onSpaNavigation);
}

// Single dispatch point for "make the page match the current settings" —
// used by both initial load and the popup's Apply, so the two can't drift.
async function applyCurrentMode({ skipIfDecorated = false } = {}) {
  if (getMode() === "pinyin") {
    ensureObserver(); // catch nodes added while the (slow) initial pass runs
    if (!skipIfDecorated || !hasPinyinDecorations(document)) {
      await annotateTreeWithLock(document.body);
    }
  } else {
    await translateTree(document.body);
    ensureObserver();
    if (state.settings.liveCaptions?.enabled) startLiveCaptions();
  }
}

function onSpaNavigation() {
  if (state.settings?.enabled && getMode() !== "pinyin") translateTree(document.body);
}

function ensureObserver() {
  if (!state.disconnectObserver) {
    state.disconnectObserver = startMutationObserver(handleMutations);
  }
}

function teardown() {
  state.disconnectObserver?.();
  state.disconnectObserver = null;
  stopLiveCaptions();
  revertAll();
}

async function handleMutations(nodes) {
  if (!state.settings?.enabled) return;
  const fresh = nodes.filter(n => !shouldSkipTextNode(n));
  if (!fresh.length) return;
  if (getMode() === "pinyin") await annotateNodes(fresh);
  else await translateNodes(fresh);
}

// Messages from the popup.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "CT_APPLY_NOW") {
    (async () => {
      state.settings = await getSettings();
      teardown();
      if (!state.settings?.enabled) return;

      await raf();
      // Never let stale flags block a fresh pinyin pass.
      try {
        html.removeAttribute("data-ct-pinyin-applied");
        html.removeAttribute("data-ct-pinyin-pending");
      } catch { /* ignore */ }

      await applyCurrentMode();
    })();
  }

  if (msg?.type === "CT_UNDO") {
    teardown();
  }
});

main().catch(err => console.error("[CT] init error", err));
