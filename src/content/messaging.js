export function translateRequest(texts, context = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "CT_TRANSLATE_BATCH", payload: { texts, context } }, (resp) => {
      resolve(resp?.translations || texts);
    });
  });
}
export function getSettings() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "CT_GET_SETTINGS" }, resolve);
  });
}
