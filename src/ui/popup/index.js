document.addEventListener("DOMContentLoaded", async () => {
  const enabled = document.querySelector("#enabled");
  const modeTranslate = document.querySelector("#modeTranslate");
  const modePinyin = document.querySelector("#modePinyin");
  const targetLangs = document.querySelector("#targetLangs");
  const sourceLang = document.querySelector("#sourceLang");
  const excludeLangs = document.querySelector("#excludeLangs");

  const prev = await send("CT_GET_SETTINGS");
  enabled.checked = !!prev.enabled;
  (prev.mode === "pinyin" ? modePinyin : modeTranslate).checked = true;
  targetLangs.value = (prev.targetLangs || ["es", "en"]).join(", ");
  if (sourceLang) sourceLang.value = prev.sourceLang || "auto";
  excludeLangs.value = (prev.excludeLangs || ["en", "es"]).join(", ");

  document.querySelector("#apply").addEventListener("click", async () => {
    const next = {
      enabled: enabled.checked,
      mode: modePinyin.checked ? "pinyin" : "translate",
      targetLangs: targetLangs.value.split(",").map(s => s.trim()).filter(Boolean),
      sourceLang: sourceLang ? (sourceLang.value || "auto").trim() : prev.sourceLang,
      excludeLangs: excludeLangs.value.split(",").map(s => s.trim()).filter(Boolean)
    };
    await send("CT_SET_SETTINGS", next);

    if (
      next.enabled !== prev.enabled ||
      next.mode !== prev.mode ||
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
});


function send(type, payload) {
  return new Promise((resolve) =>
    chrome.runtime.sendMessage({ type, payload }, resolve)
  );
}
