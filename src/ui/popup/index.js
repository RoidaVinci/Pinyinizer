document.addEventListener("DOMContentLoaded", async () => {
  const enabled = document.querySelector("#enabled");
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

    // No need to clear translation cache for pinyin-only visual changes.
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tab = tabs[0];
      if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "CT_APPLY_NOW" });
    });

    window.close();
  });

  document.querySelector("#undo").addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tab = tabs[0];
      if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "CT_UNDO" });
    });
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
