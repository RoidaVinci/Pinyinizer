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
  const provider = document.querySelector("#provider");
  const glossaryDnt = document.querySelector("#glossaryDnt");
  const status = document.querySelector("#status");

  const settings = await send("CT_GET_SETTINGS");

  // mode
  (settings.mode === "pinyin" ? modePinyin : modeTranslate).checked = true;
  toggleSections(settings.mode);

  // pinyin options
  annotateShowEnglish.checked = !!settings.annotate?.showEnglish;

  // translate options
  enabled.checked = !!settings.enabled;
  targetLangs.value = (settings.targetLangs || ["es", "en"]).join(", ");
  sourceLang.value = settings.sourceLang || "auto";
  excludeLangs.value = (settings.excludeLangs || ["en", "es"]).join(", ");
  provider.value = settings.provider || "http";
  glossaryDnt.value = (settings.glossary?.dnt || []).join(", ");

  modeTranslate.addEventListener("change", () => toggleSections("translate"));
  modePinyin.addEventListener("change", () => toggleSections("pinyin"));

  document.querySelector("#save").addEventListener("click", async () => {
    const payload = {
      mode: modePinyin.checked ? "pinyin" : "translate",
      annotate: {
        ...(settings.annotate || {}),
        showEnglish: annotateShowEnglish.checked
      },
      enabled: enabled.checked,
      targetLangs: targetLangs.value.split(",").map(s => s.trim()).filter(Boolean),
      sourceLang: (sourceLang.value || "auto").trim(),
      excludeLangs: excludeLangs.value.split(",").map(s => s.trim()).filter(Boolean),
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

  function toggleSections(mode) {
    const isPinyin = mode === "pinyin";
    pinyinSection.hidden = !isPinyin;
    translateSection.hidden = isPinyin;
  }
});

function send(type, payload) {
  return new Promise((resolve) => chrome.runtime.sendMessage({ type, payload }, resolve));
}
