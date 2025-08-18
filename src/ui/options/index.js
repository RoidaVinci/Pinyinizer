document.addEventListener("DOMContentLoaded", async () => {
  const enabled = document.querySelector("#enabled");
  const pinyin = document.querySelector("#pinyin");
    const targetLangs = document.querySelector("#targetLangs");
    const sourceLang = document.querySelector("#sourceLang"); // ← NEW
    const excludeLangs = document.querySelector("#excludeLangs");
  const provider = document.querySelector("#provider");
  const targetMode = document.querySelector("#targetMode");
  const glossaryDnt = document.querySelector("#glossaryDnt");
  const status = document.querySelector("#status");

  const settings = await send("CT_GET_SETTINGS");
    enabled.checked = !!settings.enabled;
    pinyin.checked = !!settings.pinyin;
    targetLangs.value = (settings.targetLangs || ["es", "en"]).join(", ");
    sourceLang.value = settings.sourceLang || "auto";           // ← NEW
    excludeLangs.value = (settings.excludeLangs || ["en", "es"]).join(", ");
  provider.value = settings.provider || "http";
  targetMode.value = settings.targetMode || "translate";
  glossaryDnt.value = (settings.glossary?.dnt || []).join(", ");

  document.querySelector("#save").addEventListener("click", async () => {
    const payload = {
        enabled: enabled.checked,
        pinyin: pinyin.checked,
        targetLangs: targetLangs.value.split(",").map(s => s.trim()).filter(Boolean),
        sourceLang: (sourceLang.value || "auto").trim(),        // ← NEW
        excludeLangs: excludeLangs.value.split(",").map(s => s.trim()).filter(Boolean),
        provider: provider.value,
        targetMode: targetMode.value,
      glossary: {
        ...(settings.glossary || {}),
        dnt: glossaryDnt.value.split(",").map(s => s.trim()).filter(Boolean)
      }
    };
    await send("CT_SET_SETTINGS", payload);
    status.textContent = "Saved ✓";
    setTimeout(() => status.textContent = "", 1000);
  });
});

function send(type, payload) {
  return new Promise((resolve) => chrome.runtime.sendMessage({ type, payload }, resolve));
}
