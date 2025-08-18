document.addEventListener("DOMContentLoaded", async () => {
    const enabled = document.querySelector("#enabled");
    const pinyin = document.querySelector("#pinyin");
    const targetLangs = document.querySelector("#targetLangs");
    const sourceLang = document.querySelector("#sourceLang"); // if you added this field
    const excludeLangs = document.querySelector("#excludeLangs");
  // If you have a provider selector in popup, wire it here; otherwise it’s in Options.

  const prev = await send("CT_GET_SETTINGS");
    enabled.checked = !!prev.enabled;
    pinyin.checked = !!prev.pinyin;
    targetLangs.value = (prev.targetLangs || ["es", "en"]).join(", ");
    if (sourceLang) sourceLang.value = prev.sourceLang || "auto";
    excludeLangs.value = (prev.excludeLangs || ["en", "es"]).join(", ");

  document.querySelector("#apply").addEventListener("click", async () => {
    const next = {
        enabled: enabled.checked,
        pinyin: pinyin.checked,
        targetLangs: targetLangs.value.split(",").map(s => s.trim()).filter(Boolean),
        sourceLang: sourceLang ? (sourceLang.value || "auto").trim() : prev.sourceLang,
        excludeLangs: excludeLangs.value.split(",").map(s => s.trim()).filter(Boolean)
    };
    await send("CT_SET_SETTINGS", next);

    // if anything that affects cache changed, clear it
      if (
        next.enabled !== prev.enabled ||
        next.pinyin !== prev.pinyin ||
        next.sourceLang !== prev.sourceLang ||
        next.targetLangs.join(",") !== (prev.targetLangs || []).join(",")
      ) {
        await send("CT_CLEAR_CACHE");
      }

    // ping the current tab to re-run
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
  });

function send(type, payload) {
  return new Promise((resolve) =>
    chrome.runtime.sendMessage({ type, payload }, resolve)
  );
}
