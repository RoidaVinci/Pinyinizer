// Toolbar badge reflects the extension state: OFF / PY (pinyin) / TR (translate).

export function updateBadge(settings) {
  try {
    const text = !settings.enabled ? "OFF" : (settings.mode === "pinyin" ? "PY" : "TR");
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor?.({ color: settings.enabled ? "#0b74e0" : "#777" });
  } catch { /* badge is cosmetic; never let it break messaging */ }
}
