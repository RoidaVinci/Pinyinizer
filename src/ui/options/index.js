document.addEventListener("DOMContentLoaded", async () => {
  // Toggles
  const enabledRow = document.getElementById("enabledRow");
  const enabledSwitch = document.getElementById("enabledSwitch");
  const modeRow = document.getElementById("modeRow");
  const modeSwitch = document.getElementById("modeSwitch");
  const englishRow = document.getElementById("englishRow");
  const annotateShowEnglish = document.getElementById("annotateShowEnglish");

  // Sections
  const pinyinSection = document.getElementById("pinyinSection");
  const translateSection = document.getElementById("translateSection");

  // Pinyin controls
  const pinyinProvider = document.getElementById("pinyinProvider");
  const hanziScale = document.getElementById("hanziScale");
  const pinyinScale = document.getElementById("pinyinScale");
  const hanziScaleVal = document.getElementById("hanziScaleVal");
  const pinyinScaleVal = document.getElementById("pinyinScaleVal");

  // Translate controls
  const targetLangs = document.getElementById("targetLangs");
  const sourceLang = document.getElementById("sourceLang");
  const excludeLangs = document.getElementById("excludeLangs");
  const provider = document.getElementById("provider");
  const glossaryDnt = document.getElementById("glossaryDnt");

  // Save/status
  const saveBtn = document.getElementById("save");
  const status = document.getElementById("status");

  const settings = await send("CT_GET_SETTINGS");

  // ----- init toggles -----
  // Enabled
  enabledSwitch.checked = !!settings.enabled;
  reflectToggleUI(enabledRow, enabledSwitch.checked);

  // Mode (Translate=false, Pinyin=true)
  const isPinyin = settings.mode === "pinyin";
  modeSwitch.checked = isPinyin;
  reflectToggleUI(modeRow, isPinyin);
  toggleSections(isPinyin ? "pinyin" : "translate");

  // Show English
  annotateShowEnglish.checked = !!settings.annotate?.showEnglish;
  reflectToggleUI(englishRow, annotateShowEnglish.checked);

  // Toggle listeners
  enabledSwitch.addEventListener("change", () =>
    reflectToggleUI(enabledRow, enabledSwitch.checked)
  );
  modeSwitch.addEventListener("change", () => {
    const on = modeSwitch.checked;
    reflectToggleUI(modeRow, on);
    toggleSections(on ? "pinyin" : "translate");
  });
  annotateShowEnglish.addEventListener("change", () =>
    reflectToggleUI(englishRow, annotateShowEnglish.checked)
  );

  // ----- init pinyin controls -----
  if (pinyinProvider) pinyinProvider.value = settings.pinyinProvider || "pinyin_pro_local";
  const sHanzi = clampNum(settings.annotate?.hanziScale ?? 0.90, 0.3, 1.2);
  const sPinyin = clampNum(settings.annotate?.pinyinScale ?? 0.53, 0.3, 1.2);
  hanziScale.value = sHanzi;
  pinyinScale.value = sPinyin;
  hanziScaleVal.textContent = sHanzi.toFixed(2);
  pinyinScaleVal.textContent = sPinyin.toFixed(2);
  hanziScale.addEventListener("input", () => {
    hanziScaleVal.textContent = (+hanziScale.value).toFixed(2);
  });
  pinyinScale.addEventListener("input", () => {
    pinyinScaleVal.textContent = (+pinyinScale.value).toFixed(2);
  });

  // ----- init translate controls -----
  targetLangs.value = (settings.targetLangs || ["es", "en"]).join(", ");
  sourceLang.value = settings.sourceLang || "auto";
  excludeLangs.value = (settings.excludeLangs || ["en", "es"]).join(", ");
  provider.value = settings.provider || "http";
  glossaryDnt.value = (settings.glossary?.dnt || []).join(", ");

  // ----- save -----
  saveBtn.addEventListener("click", async () => {
    const payload = {
      enabled: enabledSwitch.checked,
      mode: modeSwitch.checked ? "pinyin" : "translate",
      pinyinProvider: pinyinProvider ? pinyinProvider.value : (settings.pinyinProvider || "pinyin_pro_local"),
      annotate: {
        ...(settings.annotate || {}),
        showEnglish: annotateShowEnglish.checked,
        hanziScale: clampNum(+hanziScale.value, 0.3, 1.2),
        pinyinScale: clampNum(+pinyinScale.value, 0.3, 1.2),
      },
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
    setTimeout(() => (status.textContent = ""), 1200);
  });

  // ----- helpers -----
  function reflectToggleUI(rowEl, isOn) {
    if (!rowEl) return;
    rowEl.classList.toggle("is-on", !!isOn);
  }

  function toggleSections(mode) {
    const isPinyinMode = mode === "pinyin";
    pinyinSection.hidden = !isPinyinMode;
    translateSection.hidden = isPinyinMode;
  }
});

// messaging & utils
function send(type, payload) {
  return new Promise((resolve) =>
    chrome.runtime.sendMessage({ type, payload }, resolve)
  );
}
const clampNum = (n, lo, hi) =>
  Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
