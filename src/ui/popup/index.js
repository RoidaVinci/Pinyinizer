document.addEventListener("DOMContentLoaded", async () => {
  const enabled = document.querySelector("#enabled");
  const targetLang = document.querySelector("#targetLang");
  const sourceLang = document.querySelector("#sourceLang"); // if you added this field
  // If you have a provider selector in popup, wire it here; otherwise it’s in Options.

  const prev = await send("CT_GET_SETTINGS");
  enabled.checked = !!prev.enabled;
  targetLang.value = prev.targetLang || "es";
  if (sourceLang) sourceLang.value = prev.sourceLang || "auto";

  document.querySelector("#apply").addEventListener("click", async () => {
    const next = {
      enabled: enabled.checked,
      targetLang: (targetLang.value || "es").trim(),
      sourceLang: sourceLang ? (sourceLang.value || "auto").trim() : prev.sourceLang
    };
    await send("CT_SET_SETTINGS", next);

    // if anything that affects cache changed, clear it
    if (next.targetLang !== prev.targetLang || next.sourceLang !== prev.sourceLang || next.enabled !== prev.enabled) {
      await send("CT_CLEAR_CACHE");
    }

    // ping the current tab to re-run
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
