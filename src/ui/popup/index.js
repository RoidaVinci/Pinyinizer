// Popup: quick on/off, mode switch, language chips, Apply/Undo.
// Runs as an ES module so the language list comes from the shared registry
// (src/common/langs.js) instead of a drifting private copy.

import { LANGS, LANG_CODES } from "../../common/langs.js";

document.addEventListener("DOMContentLoaded", async () => {
  // Toggles
  const enabled = document.querySelector("#enabled");
  const toggleRow = document.querySelector("#toggleRow");
  const modeSwitch = document.querySelector("#modeSwitch");
  const modeRow = document.querySelector("#modeRow");
  const englishToggle = document.querySelector("#annotateShowEnglish");
  const englishRow = document.querySelector("#englishRow");

  // Sections
  const translateSection = document.querySelector("#translateSection");
  const pinyinSection = document.querySelector("#pinyinSection");

  // Pinyin sliders
  const hanziScale = document.querySelector("#hanziScale");
  const pinyinScale = document.querySelector("#pinyinScale");
  const hanziScaleVal = document.querySelector("#hanziScaleVal");
  const pinyinScaleVal = document.querySelector("#pinyinScaleVal");

  // Language controls
  const sourceLangSelect = document.querySelector("#sourceLangSelect");
  const targetSelect = document.querySelector("#targetSelect");
  const targetChips = document.querySelector("#targetChips");
  const excludeSelect = document.querySelector("#excludeSelect");
  const excludeChips = document.querySelector("#excludeChips");

  // Buttons
  const applyBtn = document.querySelector("#apply");
  const undoBtn = document.querySelector("#undo");

  fillLangSelect(sourceLangSelect, { includeAuto: true });
  fillLangSelect(targetSelect, { placeholder: "Add target…" });
  fillLangSelect(excludeSelect, { placeholder: "Add exclude…" });

  // Load settings
  const prev = await send("CT_GET_SETTINGS");

  // Enabled state
  enabled.checked = !!prev.enabled;
  reflectToggleUI(toggleRow, enabled.checked);

  // Mode switch — checked = Pinyin, unchecked = Translate
  modeSwitch.checked = prev.mode === "pinyin";
  reflectToggleUI(modeRow, modeSwitch.checked);
  toggleSections(modeSwitch.checked ? "pinyin" : "translate");

  // Show English toggle (Pinyin mode)
  englishToggle.checked = !!prev.annotate?.showEnglish;
  reflectToggleUI(englishRow, englishToggle.checked);

  // Pinyin scales
  const sHanzi = clampNum(prev.annotate?.hanziScale ?? 0.90, 0.3, 1.2);
  const sPinyin = clampNum(prev.annotate?.pinyinScale ?? 0.53, 0.3, 1.2);
  hanziScale.value = sHanzi; hanziScaleVal.textContent = sHanzi.toFixed(2);
  pinyinScale.value = sPinyin; pinyinScaleVal.textContent = sPinyin.toFixed(2);
  hanziScale.addEventListener("input", () => hanziScaleVal.textContent = (+hanziScale.value).toFixed(2));
  pinyinScale.addEventListener("input", () => pinyinScaleVal.textContent = (+pinyinScale.value).toFixed(2));

  // Source (single)
  sourceLangSelect.value = LANG_CODES.includes(prev.sourceLang || "") ? prev.sourceLang : "auto";

  // Target / Exclude (multi chips)
  let targetLangs = sanitizeLangList(prev.targetLangs?.length ? prev.targetLangs : ["es", "en"]);
  let excludeLangs = sanitizeLangList(prev.excludeLangs?.length ? prev.excludeLangs : ["en", "es"]);

  const renderTargets = () => renderChips(targetChips, targetLangs, (lang) => {
    targetLangs = targetLangs.filter(l => l !== lang);
    renderTargets();
  });
  const renderExcludes = () => renderChips(excludeChips, excludeLangs, (lang) => {
    excludeLangs = excludeLangs.filter(l => l !== lang);
    renderExcludes();
  });
  renderTargets();
  renderExcludes();

  targetSelect.addEventListener("change", () => {
    const val = targetSelect.value;
    if (val && !targetLangs.includes(val)) { targetLangs.push(val); renderTargets(); }
    targetSelect.selectedIndex = 0; // reset to placeholder
  });
  excludeSelect.addEventListener("change", () => {
    const val = excludeSelect.value;
    if (val && !excludeLangs.includes(val)) { excludeLangs.push(val); renderExcludes(); }
    excludeSelect.selectedIndex = 0;
  });

  // Behavior: ONLY Off auto-applies; On just saves state
  enabled.addEventListener("change", async () => {
    prev.enabled = enabled.checked;
    reflectToggleUI(toggleRow, enabled.checked);

    await send("CT_SET_SETTINGS", { enabled: enabled.checked });
    if (!enabled.checked) {
      await sendToActiveTab("CT_APPLY_NOW");
      window.close();
    }
  });

  // Mode switch: just flips sections; applied on Apply
  modeSwitch.addEventListener("change", () => {
    reflectToggleUI(modeRow, modeSwitch.checked);
    toggleSections(modeSwitch.checked ? "pinyin" : "translate");
  });

  englishToggle.addEventListener("change", () => {
    reflectToggleUI(englishRow, englishToggle.checked);
  });

  applyBtn.addEventListener("click", async () => {
    await send("CT_SET_SETTINGS", {
      mode: modeSwitch.checked ? "pinyin" : "translate",
      annotate: {
        ...(prev.annotate || {}),
        showEnglish: englishToggle.checked,
        hanziScale: clampNum(+hanziScale.value, 0.3, 1.2),
        pinyinScale: clampNum(+pinyinScale.value, 0.3, 1.2),
      },
      enabled: enabled.checked,
      targetLangs,
      sourceLang: sourceLangSelect.value || "auto",
      excludeLangs,
    });
    await sendToActiveTab("CT_APPLY_NOW");
    window.close();
  });

  undoBtn.addEventListener("click", async () => {
    await sendToActiveTab("CT_UNDO");
    window.close();
  });

  function toggleSections(mode) {
    const isPinyin = mode === "pinyin";
    pinyinSection.hidden = !isPinyin;
    translateSection.hidden = isPinyin;
  }
});

/* ---------- helpers ---------- */

function fillLangSelect(select, { includeAuto = false, placeholder = null } = {}) {
  if (placeholder) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = placeholder;
    opt.disabled = true;
    opt.selected = true;
    select.appendChild(opt);
  }
  for (const { code, label } of LANGS) {
    if (code === "auto" && !includeAuto) continue;
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = `${code} — ${label}`;
    select.appendChild(opt);
  }
}

function reflectToggleUI(rowEl, isOn) {
  if (!rowEl) return;
  rowEl.classList.toggle("is-on", !!isOn);
}

function sanitizeLangList(arr) {
  const out = [];
  (arr || []).forEach(l => {
    const v = String(l || "").trim();
    if (LANG_CODES.includes(v) && !out.includes(v)) out.push(v);
  });
  return out;
}

function renderChips(container, values, onRemove) {
  container.innerHTML = "";
  values.forEach(v => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = v;
    const x = document.createElement("span");
    x.className = "x";
    x.textContent = "×";
    x.addEventListener("click", () => onRemove(v));
    chip.appendChild(x);
    container.appendChild(chip);
  });
}

function send(type, payload) {
  return new Promise((resolve) =>
    chrome.runtime.sendMessage({ type, payload }, resolve)
  );
}
const clampNum = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

/** Robustly send a message to the active tab's content script. */
async function sendToActiveTab(type, payload) {
  const tab = await getActiveTab();
  if (!tab?.id) return false;

  for (let attempt = 0; attempt < 3; attempt++) {
    const ok = await trySend(tab.id, { type, payload });
    if (ok) return true;
    await delay(150 * (attempt + 1));
  }

  // No listener yet (tab opened before install, or a failed load): inject the
  // bootstrap, then retry — the module entry loads asynchronously, so one
  // immediate send isn't enough.
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ["src/content/index.js"],
    });
  } catch (_) { /* chrome:// pages etc. */ }

  for (let attempt = 0; attempt < 3; attempt++) {
    const ok = await trySend(tab.id, { type, payload });
    if (ok) return true;
    await delay(150 * (attempt + 1));
  }
  return false;
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs?.[0]));
  });
}
function trySend(tabId, msg) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, msg, () => {
        const err = chrome.runtime.lastError;
        resolve(!err);
      });
    } catch (_) { resolve(false); }
  });
}
const delay = (ms) => new Promise(r => setTimeout(r, ms));
