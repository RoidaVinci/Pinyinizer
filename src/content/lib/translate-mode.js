// Translate mode: replace text nodes in-place with translations.

import { state, preferredTarget } from "./state.js";
import { collectTextNodes, applyTranslations } from "./dom.js";
import { translateRequest } from "./messaging.js";

export async function translateTree(root) {
  try {
    if (!root) return false;

    // Detect the page language from a sample so we can pick a target the
    // page isn't already in, and skip excluded languages entirely.
    const sample = document.body?.innerText?.slice(0, 12000) || "";
    let pageLang = "und";
    try {
      const det = await chrome.i18n.detectLanguage(sample);
      pageLang = det?.languages?.[0]?.language || "und";
    } catch { /* detection is best-effort */ }

    if (state.settings.excludeLangs?.includes(pageLang)) {
      state.langs = null; // marks the page excluded for later mutations too
      return false;
    }

    const order = state.settings.targetLangs || ["es", "en"];
    const target = order.find(l => l !== pageLang) || order[0] || preferredTarget();
    const source = state.settings.sourceLang && state.settings.sourceLang !== "auto"
      ? state.settings.sourceLang
      : pageLang === "und" ? "auto" : pageLang;
    state.langs = { source, target };

    const nodes = collectTextNodes(root);
    if (!nodes.length) return false;
    await translateNodes(nodes);
    return true;
  } catch (e) {
    console.error("[CT] translateTree error", e);
    return false;
  }
}

export async function translateNodes(nodes) {
  if (!state.langs) return; // page language is excluded; leave mutations alone

  // Dedupe identical strings so repeated UI text costs one translation.
  const texts = nodes.map(n => n.nodeValue);
  const indexByText = new Map();
  texts.forEach((t, i) => {
    if (!indexByText.has(t)) indexByText.set(t, []);
    indexByText.get(t).push(i);
  });
  const unique = Array.from(indexByText.keys());

  let translations = unique;
  try {
    const resp = await translateRequest(unique, {
      sourceLang: state.langs.source,
      targetLang: state.langs.target,
      context: { url: location.href },
    });
    if (Array.isArray(resp)) translations = resp;
  } catch (e) {
    console.warn("[CT] translateRequest failed; keeping originals", e);
  }

  const expanded = new Array(nodes.length);
  translations.forEach((tr, j) => {
    for (const idx of indexByText.get(unique[j])) expanded[idx] = tr;
  });
  applyTranslations(nodes, expanded);
  console.debug(`[CT] translated ${nodes.length} nodes`);
}
