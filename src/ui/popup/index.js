document.addEventListener("DOMContentLoaded", async () => {
  const enabled = document.querySelector("#enabled");
  const toggleRow = document.querySelector("#toggleRow");

  const modeTranslate = document.querySelector("#modeTranslate");
  const modePinyin = document.querySelector("#modePinyin");
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

  const sHanzi = clampNum(prev.annotate?.hanziScale ?? 0.90, 0.3, 1.2);
  const sPinyin = clampNum(prev.annotate?.pinyinScale ?? 0.53, 0.3, 1.2);
  hanziScale.value = sHanzi;
  pinyinScale.value = sPinyin;
  hanziScaleVal.textContent = sHanzi.toFixed(2);
  pinyinScaleVal.textContent = sPinyin.toFixed(2);

  hanziScale.addEventListener("input", () => hanziScaleVal.textContent = (+hanziScale.value).toFixed(2));
  pinyinScale.addEventListener("input", () => pinyinScaleVal.textContent = (+pinyinScale.value).toFixed(2));

  enabled.checked = !!prev.enabled;
  reflectToggleUI();

  targetLangs.value = (prev.targetLangs || ["es", "en"]).join(", ");
  if (sourceLang) sourceLang.value = prev.sourceLang || "auto";
  excludeLangs.value = (prev.excludeLangs || ["en", "es"]).join(", ");

  modeTranslate.addEventListener("change", () => toggleSections("translate"));
  modePinyin.addEventListener("change", () => toggleSections("pinyin"));

  // Only OFF auto-applies; ON just saves state (no auto run)
  enabled.addEventListener("change", async () => {
    const nextSettings = { ...prev, enabled: enabled.checked };
    prev.enabled = enabled.checked; // keep snapshot aligned
    reflectToggleUI();

    await send("CT_SET_SETTINGS", nextSettings);
    if (!enabled.checked) {
      await sendToActiveTab("CT_APPLY_NOW");
      window.close();
    }
  });

  document.querySelector("#apply").addEventListener("click", async () => {
    const next = {
      mode: modePinyin.checked ? "pinyin" : "translate",
      pinyinProvider: prev.pinyinProvider || "pinyin_pro_local",
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
    await sendToActiveTab("CT_APPLY_NOW");
    window.close();
  });

  document.querySelector("#undo").addEventListener("click", async () => {
    await sendToActiveTab("CT_UNDO");
    window.close();
  });

  function toggleSections(mode) {
    const isPinyin = mode === "pinyin";
    pinyinSection.hidden = !isPinyin;
    translateSection.hidden = isPinyin;
  }

  function reflectToggleUI() {
    if (!toggleRow) return;
    toggleRow.classList.toggle("is-on", !!enabled.checked);
  }
});

/* existing helpers remain unchanged */
function send(type, payload) {
  return new Promise((resolve) =>
    chrome.runtime.sendMessage({ type, payload }, resolve)
  );
}
const clampNum = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

async function sendToActiveTab(type, payload) {
  const tab = await getActiveTab();
  if (!tab?.id) return false;

  for (let attempt = 0; attempt < 3; attempt++) {
    const ok = await trySend(tab.id, { type, payload });
    if (ok) return true;
    await delay(150 * (attempt + 1));
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ["src/content/index.js"],
    });
  } catch (_) {}
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
    } catch (_) { resolve(false); }
  });
}
const delay = (ms) => new Promise(r => setTimeout(r, ms));
