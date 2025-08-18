document.addEventListener("DOMContentLoaded", async () => {
  const enabled = document.querySelector("#enabled");
  const targetLang = document.querySelector("#targetLang");
  const sourceLang = document.querySelector("#sourceLang"); // ← NEW
  const provider = document.querySelector("#provider");
  const glossaryDnt = document.querySelector("#glossaryDnt");
  const status = document.querySelector("#status");

  const settings = await send("CT_GET_SETTINGS");
  enabled.checked = !!settings.enabled;
  targetLang.value = settings.targetLang || "en";
  sourceLang.value = settings.sourceLang || "auto";           // ← NEW
  provider.value = settings.provider || "http";
  glossaryDnt.value = (settings.glossary?.dnt || []).join(", ");

  document.querySelector("#save").addEventListener("click", async () => {
    const payload = {
      enabled: enabled.checked,
      targetLang: (targetLang.value || "en").trim(),
      sourceLang: (sourceLang.value || "auto").trim(),        // ← NEW
      provider: provider.value,
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
