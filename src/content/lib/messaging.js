// Messaging from the content script to the service worker, hardened against
// the transient errors that happen while the worker spins up or the extension
// reloads.

import { sleep } from "../../common/utils.js";

const TRANSIENT_ERRORS = [
  "context invalidated",
  "message port closed",
  "receiving end does not exist",
  "could not establish connection",
];

export async function sendMessageSafe(msg, retries = 3, delayMs = 200) {
  for (let attempt = 0; ; attempt++) {
    if (!chrome.runtime?.id) return null; // orphaned script (extension reloaded)

    const { resp, err } = await new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (resp) =>
        resolve({ resp, err: chrome.runtime.lastError }));
    });
    if (!err) return resp;

    const m = String(err.message || "").toLowerCase();
    const transient = TRANSIENT_ERRORS.some(t => m.includes(t));
    if (!transient || attempt >= retries) {
      console.warn("[CT] sendMessage error:", err.message);
      return null;
    }
    await sleep(delayMs * 2 ** attempt);
  }
}

export function translateRequest(texts, opts = {}) {
  return sendMessageSafe({ type: "CT_TRANSLATE_BATCH", payload: { texts, opts } })
    .then(resp => (resp && resp.translations) ? resp.translations : texts);
}

export function getSettings() {
  return sendMessageSafe({ type: "CT_GET_SETTINGS" })
    .then(resp => resp || { enabled: false });
}
