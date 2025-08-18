document.addEventListener("DOMContentLoaded", async () => {
  const enabled = document.querySelector("#enabled");
  const modeTranslate = document.querySelector("#modeTranslate");
  const modePinyin = document.querySelector("#modePinyin");

  const pinyinSection = document.querySelector("#pinyinSection");
  const translateSection = document.querySelector("#translateSection");
  const annotateShowEnglish = document.querySelector("#annotateShowEnglish");

  const targetLangs = document.querySelector("#targetLangs");
  const sourceLang = document.querySelector("#sourceLang");
  const excludeLangs = document.querySelector("#excludeLangs");

  const prev = await send("CT_GET_SETTINGS");

  (prev.mode === "pinyin" ? modePinyin : modeTranslate).checked = true;
  toggleSections(prev.mode);

  annotateShowEnglish.checked = !!prev.annotate?.showEnglish;

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
        showEnglish: annotateShowEnglish.checked
      },
      enabled: enabled.checked,
      targetLangs: targetLangs.value.split(",").map(s => s.trim()).filter(Boolean),
      sourceLang: sourceLang ? (sourceLang.value || "auto").trim() : prev.sourceLang,
      excludeLangs: excludeLangs.value.split(",").map(s => s.trim()).filter(Boolean)
    };
    await send("CT_SET_SETTINGS", next);

    if (
      next.mode !== prev.mode ||
      next.enabled !== prev.enabled ||
      next.sourceLang !== prev.sourceLang ||
      next.targetLangs.join(",") !== (prev.targetLangs || []).join(",")
    ) {
      await send("CT_CLEAR_CACHE");
    }

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

function ensurePinyinStyles() {
  if (document.getElementById("ct-pinyin-styles")) return;
  const css = `
  .ct-ruby { ruby-position: under; }
  .ct-ruby rt { font-size: 0.72em; line-height: 0.9; color: #555; }
  .ct-ruby rb { font-size: 0.92em; }
  `;
  const el = document.createElement("style");
  el.id = "ct-pinyin-styles";
  el.textContent = css;
  document.documentElement.appendChild(el);
}
