const DEFAULTS = {
  enabled: true,
  provider: "google_free",      // "mock" | "http"
  pinyinProvider: "pinyin_pro_local", // "google_free" | "pinyin_pro_local"
  sourceLang: "zh",
  targetLangs: ["es", "en"],
  excludeLangs: ["en", "es"],
  batchSize: 200,
  mode: "translate",     // "translate" | "pinyin"
  annotate: {
    showEnglish: false,   // keep English glosses after Hanzi
    // NEW — default scales used in pinyin mode when English is NOT shown
    hanziScale: 0.90,     // matches your previous const HANZI_SCALE_NO_EN
    pinyinScale: 0.53     // matches your previous const PINYIN_SCALE_NO_EN
  },
  glossary: {
    dnt: ["Chrome", "API"],
    replace: []         // [["colour","color"]] etc.
  },
  perSite: {}           // domain -> overrides
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULTS, ...(settings || {}) };
}

export async function setSettings(partial) {
  const current = await getSettings();
  const settings = deepMerge(current, partial);
  await chrome.storage.local.set({ settings });
}

function deepMerge(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return b.slice();
  if (isObj(a) && isObj(b)) {
    const out = { ...a };
    for (const k of Object.keys(b)) out[k] = deepMerge(a[k], b[k]);
    return out;
  }
  return b === undefined ? a : b;
}
const isObj = v => v && typeof v === "object" && !Array.isArray(v);
