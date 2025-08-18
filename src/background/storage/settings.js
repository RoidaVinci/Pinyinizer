const DEFAULTS = {
  enabled: true,
  provider: "http",      // "mock" | "http"
  sourceLang: "auto",
  targetLangs: ["es", "en"],
  excludeLangs: ["en", "es"],
  batchSize: 200,
  mode: "translate",     // "translate" | "pinyin"
  annotate: {
    showEnglish: false   // when in pinyin mode: keep existing English glosses right after Hanzi
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
