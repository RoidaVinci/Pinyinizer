// Settings schema, defaults, persistence and migrations.
//
// Everything lives under chrome.storage.local key "settings" as a single
// object. Readers always get DEFAULTS deep-merged with what is stored, so new
// fields are safe to add here without a migration.

import { providerConfigDefaults } from "../translator/registry.js";

export const DEFAULTS = {
  enabled: true,

  // "translate" | "pinyin"
  mode: "translate",

  // Translation provider id — see src/background/translator/registry.js
  provider: "google_free",

  // Pinyin provider id — see src/background/annotator/index.js
  pinyinProvider: "pinyin_pro_local",

  sourceLang: "auto",
  targetLangs: ["es", "en"],
  excludeLangs: ["en", "es"],

  annotate: {
    showEnglish: false,
    hanziScale: 0.90,
    pinyinScale: 0.53,
  },

  glossary: {
    dnt: ["Chrome", "API"], // do-not-translate tokens
    replace: [],            // [["colour", "color"], ...]
  },

  // Experimental: translate <video> subtitle cues (TextTracks) in real time.
  liveCaptions: {
    enabled: false,
  },

  // Per-provider configuration (API keys, endpoints, model names), derived
  // from the registry so each field's default is defined exactly once.
  providerConfig: providerConfigDefaults(),
};

// Provider ids that were renamed; applied on read so old installs keep working.
const PROVIDER_ALIASES = {
  http: "libretranslate",
};

// Merged settings are memoized per worker lifetime: batch messages arrive
// constantly and re-reading + re-merging storage for each one is waste.
// Invalidated by storage.onChanged (fires for writes from any context).
let cached = null;
if (globalThis.chrome?.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) cached = null;
  });
}

export async function getSettings() {
  if (cached) return cached;
  const { settings } = await chrome.storage.local.get("settings");
  const merged = deepMerge(DEFAULTS, settings || {});
  merged.provider = PROVIDER_ALIASES[merged.provider] || merged.provider;
  cached = merged;
  return merged;
}

export async function setSettings(partial) {
  const current = await getSettings();
  const settings = deepMerge(current, partial);
  cached = null;
  await chrome.storage.local.set({ settings });
}

// Merge b over a. Arrays are replaced wholesale (not concatenated) so lists
// like targetLangs can be shrunk from the UI.
export function deepMerge(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return b.slice();
  if (isObj(a) && isObj(b)) {
    const out = { ...a };
    for (const k of Object.keys(b)) out[k] = deepMerge(a[k], b[k]);
    return out;
  }
  return b === undefined ? a : b;
}

const isObj = v => v && typeof v === "object" && !Array.isArray(v);
