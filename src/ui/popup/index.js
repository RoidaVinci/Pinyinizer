document.addEventListener("DOMContentLoaded", async () => {
  const enabled = document.querySelector("#enabled");
  const modeTranslate = document.querySelector("#modeTranslate");
  const modePinyin = document.querySelector("#modePinyin");
  const pinyinProvider = document.querySelector("#pinyinProvider");
  const pinyinSection = document.querySelector("#pinyinSection");
  const translateSection = document.querySelector("#translateSection");
  const annotateShowEnglish = document.querySelector("#annotateShowEnglish");

  const hanziScale = document.querySelector("#hanziScale");
  const pinyinScale = document.querySelector("#pinyinScale");
  const hanziScaleVal = document.querySelector("#hanziScaleVal");
  const pinyinScaleVal = document.querySelector("#pinyinScaleVal");

  const targetLangs = document.querySelector("#targetLangs");
  const sourceLang = document.querySelector("#sourceLang");
  const excludeLangs = document.querySelector("#excludeLangs");

  const prev = await send("CT_GET_SETTINGS");

  (prev.mode === "pinyin" ? modePinyin : modeTranslate).checked = true;
  toggleSections(prev.mode);

  annotateShowEnglish.checked = !!prev.annotate?.showEnglish;
  if (pinyinProvider) pinyinProvider.value = prev.pinyinProvider || "pinyin_pro_local";
  
  // NEW — load scales
  const sHanzi = clampNum(prev.annotate?.hanziScale ?? 0.90, 0.3, 1.2);
  const sPinyin = clampNum(prev.annotate?.pinyinScale ?? 0.53, 0.3, 1.2);
  hanziScale.value = sHanzi;
  pinyinScale.value = sPinyin;
  hanziScaleVal.textContent = sHanzi.toFixed(2);
  pinyinScaleVal.textContent = sPinyin.toFixed(2);

  hanziScale.addEventListener("input", () => hanziScaleVal.textContent = (+hanziScale.value).toFixed(2));
  pinyinScale.addEventListener("input", () => pinyinScaleVal.textContent = (+pinyinScale.value).toFixed(2));

  enabled.checked = !!prev.enabled;
  targetLangs.value = (prev.targetLangs || ["es", "en"]).join(", ");
  if (sourceLang) sourceLang.value = prev.sourceLang || "auto";
  excludeLangs.value = (prev.excludeLangs || ["en", "es"]).join(", ");

  modeTranslate.addEventListener("change", () => toggleSections("translate"));
  modePinyin.addEventListener("change", () => toggleSections("pinyin"));

  document.querySelector("#apply").addEventListener("click", async () => {
    const next = {
      mode: modePinyin.checked ? "pinyin" : "translate",
      pinyinProvider: pinyinProvider ? pinyinProvider.value : (prev.pinyinProvider || "pinyin_pro_local"),
      annotate: {
        ...(prev.annotate || {}),
        showEnglish: annotateShowEnglish.checked,
        hanziScale: clampNum(+hanziScale.value, 0.3, 1.2),
        pinyinScale: clampNum(+pinyinScale.value, 0.3, 1.2)
      },
      enabled: enabled.checked,
      targetLangs: targetLangs.value.split(",").map(s => s.trim()).filter(Boolean),
      sourceLang: sourceLang ? (sourceLang.value || "auto").trim() : prev.sourceLang,
      excludeLangs: excludeLangs.value.split(",").map(s => s.trim()).filter(Boolean)
    };
    await send("CT_SET_SETTINGS", next);

    // RELIABLE apply: message with retries; inject if needed.
    await sendToActiveTab("CT_APPLY_NOW");
    window.close();
  });

  document.querySelector("#undo").addEventListener("click", async () => {
    // RELIABLE undo: message with retries; inject if needed.
    await sendToActiveTab("CT_UNDO");
    window.close();
  });

  function toggleSections(mode) {
    const isPinyin = mode === "pinyin";
    pinyinSection.hidden = !isPinyin;
    translateSection.hidden = isPinyin;
  }
});

function send(type, payload) {
  return new Promise((resolve) =>
    chrome.runtime.sendMessage({ type, payload }, resolve)
  );
}
const clampNum = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

/** Robustly send a message to the active tab's content script.
 *  - Retries a few times (service worker/content script wake-ups).
 *  - If failing, injects the content script and tries once more.
 */
async function sendToActiveTab(type, payload) {
  const tab = await getActiveTab();
  if (!tab?.id) return false;

  // Try up to 3 times quickly
  for (let attempt = 0; attempt < 3; attempt++) {
    const ok = await trySend(tab.id, { type, payload });
    if (ok) return true;
    await delay(150 * (attempt + 1));
  }

  // As a last resort, inject the content script (all frames) and retry once
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ["src/content/index.js"],
    });
  } catch (_) { /* ignore */ }

  return await trySend(tab.id, { type, payload });
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
    } catch (_) {
      resolve(false);
    }
  });
}

const delay = (ms) => new Promise(r => setTimeout(r, ms));
