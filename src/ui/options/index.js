// Options page. Runs as an ES module so it can share the provider registry
// with the service worker (single source of truth for provider metadata).

import { PROVIDER_META, providerMeta } from "../../background/translator/registry.js";
import { LANG_CODES } from "../../common/langs.js";

document.addEventListener("DOMContentLoaded", async () => {
  const $ = (id) => document.getElementById(id);

  const enabledRow = $("enabledRow");
  const enabledSwitch = $("enabledSwitch");
  const modeRow = $("modeRow");
  const modeSwitch = $("modeSwitch");
  const englishRow = $("englishRow");
  const annotateShowEnglish = $("annotateShowEnglish");

  const pinyinSection = $("pinyinSection");
  const translateSection = $("translateSection");

  const pinyinProvider = $("pinyinProvider");
  const hanziScale = $("hanziScale");
  const pinyinScale = $("pinyinScale");
  const hanziScaleVal = $("hanziScaleVal");
  const pinyinScaleVal = $("pinyinScaleVal");

  const provider = $("provider");
  const providerDescription = $("providerDescription");
  const providerConfigEl = $("providerConfig");
  const testProviderBtn = $("testProvider");
  const testResult = $("testResult").querySelector("small");

  const targetLangs = $("targetLangs");
  const sourceLang = $("sourceLang");
  const excludeLangs = $("excludeLangs");
  const glossaryDnt = $("glossaryDnt");
  const liveCaptionsRow = $("liveCaptionsRow");
  const liveCaptionsEnabled = $("liveCaptionsEnabled");

  const saveBtn = $("save");
  const clearCacheBtn = $("clearCache");
  const status = $("status");

  const settings = await send("CT_GET_SETTINGS");

  // Working copy of per-provider config, mutated by the generated inputs.
  const providerConfig = structuredClone(settings.providerConfig || {});

  // ----- toggles -----
  enabledSwitch.checked = !!settings.enabled;
  reflectToggleUI(enabledRow, enabledSwitch.checked);
  enabledSwitch.addEventListener("change", () => reflectToggleUI(enabledRow, enabledSwitch.checked));

  const isPinyin = settings.mode === "pinyin";
  modeSwitch.checked = isPinyin;
  reflectToggleUI(modeRow, isPinyin);
  toggleSections(isPinyin);
  modeSwitch.addEventListener("change", () => {
    reflectToggleUI(modeRow, modeSwitch.checked);
    toggleSections(modeSwitch.checked);
  });

  annotateShowEnglish.checked = !!settings.annotate?.showEnglish;
  reflectToggleUI(englishRow, annotateShowEnglish.checked);
  annotateShowEnglish.addEventListener("change", () =>
    reflectToggleUI(englishRow, annotateShowEnglish.checked));

  liveCaptionsEnabled.checked = !!settings.liveCaptions?.enabled;
  reflectToggleUI(liveCaptionsRow, liveCaptionsEnabled.checked);
  liveCaptionsEnabled.addEventListener("change", () =>
    reflectToggleUI(liveCaptionsRow, liveCaptionsEnabled.checked));

  // ----- pinyin controls -----
  pinyinProvider.value = settings.pinyinProvider || "pinyin_pro_local";
  const sHanzi = clampNum(settings.annotate?.hanziScale ?? 0.90, 0.3, 1.2);
  const sPinyin = clampNum(settings.annotate?.pinyinScale ?? 0.53, 0.3, 1.2);
  hanziScale.value = sHanzi;
  pinyinScale.value = sPinyin;
  hanziScaleVal.textContent = sHanzi.toFixed(2);
  pinyinScaleVal.textContent = sPinyin.toFixed(2);
  hanziScale.addEventListener("input", () => { hanziScaleVal.textContent = (+hanziScale.value).toFixed(2); });
  pinyinScale.addEventListener("input", () => { pinyinScaleVal.textContent = (+pinyinScale.value).toFixed(2); });

  // ----- provider select + generated config forms -----
  for (const meta of PROVIDER_META) {
    const opt = document.createElement("option");
    opt.value = meta.id;
    opt.textContent = meta.label;
    provider.appendChild(opt);
  }
  provider.value = settings.provider || "google_free";
  renderProviderConfig(provider.value);
  provider.addEventListener("change", () => renderProviderConfig(provider.value));

  function renderProviderConfig(id) {
    const meta = providerMeta(id);
    providerDescription.textContent = meta?.description || "";
    providerConfigEl.innerHTML = "";
    if (!meta) return;

    for (const field of meta.configFields) {
      const wrap = document.createElement("div");
      wrap.className = "field";

      const label = document.createElement("span");
      label.textContent = `${meta.label} — ${field.label}`;
      wrap.appendChild(label);

      const input = document.createElement("input");
      input.type = field.type === "password" ? "password" : "text";
      input.placeholder = field.placeholder || field.default || "";
      input.value = providerConfig[id]?.[field.key] ?? "";
      input.addEventListener("input", () => {
        providerConfig[id] = providerConfig[id] || {};
        providerConfig[id][field.key] = input.value.trim();
      });
      wrap.appendChild(input);

      providerConfigEl.appendChild(wrap);
    }
  }

  // ----- test provider -----
  testProviderBtn.addEventListener("click", async () => {
    testResult.textContent = "Testing…";
    // Save config first so the background sees fresh keys/endpoints.
    await send("CT_SET_SETTINGS", { providerConfig });
    const resp = await send("CT_TEST_PROVIDER", {
      provider: provider.value,
      targetLang: (targetLangs.value.split(",")[0] || "es").trim(),
    });
    testResult.textContent = resp?.ok
      ? `✓ "${resp.result}"`
      : `✗ ${resp?.error || "unknown error"}`;
    testResult.style.color = resp?.ok ? "#059669" : "#dc2626";
  });

  // ----- translate controls -----
  targetLangs.value = (settings.targetLangs || ["es", "en"]).join(", ");
  sourceLang.value = settings.sourceLang || "auto";
  excludeLangs.value = (settings.excludeLangs || ["en", "es"]).join(", ");
  glossaryDnt.value = (settings.glossary?.dnt || []).join(", ");

  // ----- save -----
  saveBtn.addEventListener("click", async () => {
    const [targets, badTargets] = splitKnownLangs(csv(targetLangs.value));
    const [excludes, badExcludes] = splitKnownLangs(csv(excludeLangs.value));
    const source = (sourceLang.value || "auto").trim();
    const unknown = [...badTargets, ...badExcludes, ...(LANG_CODES.includes(source) ? [] : [source])];

    await send("CT_SET_SETTINGS", {
      enabled: enabledSwitch.checked,
      mode: modeSwitch.checked ? "pinyin" : "translate",
      pinyinProvider: pinyinProvider.value,
      annotate: {
        ...(settings.annotate || {}),
        showEnglish: annotateShowEnglish.checked,
        hanziScale: clampNum(+hanziScale.value, 0.3, 1.2),
        pinyinScale: clampNum(+pinyinScale.value, 0.3, 1.2),
      },
      provider: provider.value,
      providerConfig,
      targetLangs: targets,
      sourceLang: LANG_CODES.includes(source) ? source : "auto",
      excludeLangs: excludes,
      glossary: {
        ...(settings.glossary || {}),
        dnt: csv(glossaryDnt.value),
      },
      liveCaptions: { enabled: liveCaptionsEnabled.checked },
    });
    flash(unknown.length ? `Saved ✓ (ignored unknown: ${unknown.join(", ")})` : "Saved ✓");
  });

  clearCacheBtn.addEventListener("click", async () => {
    await send("CT_CLEAR_CACHE");
    flash("Cache cleared ✓");
  });

  function toggleSections(isPinyinMode) {
    pinyinSection.hidden = !isPinyinMode;
    translateSection.hidden = isPinyinMode;
  }

  function flash(text) {
    status.textContent = text;
    setTimeout(() => (status.textContent = ""), 1500);
  }
});

// ----- helpers -----
function reflectToggleUI(rowEl, isOn) {
  rowEl?.classList.toggle("is-on", !!isOn);
}

function csv(value) {
  return value.split(",").map(s => s.trim()).filter(Boolean);
}

// [known, unknown] — providers reject codes outside the shared list, so bad
// entries are dropped at save time (and reported) instead of failing later.
function splitKnownLangs(codes) {
  const known = [], unknown = [];
  for (const c of codes) (LANG_CODES.includes(c) ? known : unknown).push(c);
  return [known, unknown];
}

function send(type, payload) {
  return new Promise((resolve) =>
    chrome.runtime.sendMessage({ type, payload }, resolve));
}

const clampNum = (n, lo, hi) =>
  Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
