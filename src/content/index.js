// --- Clean Translate: single-file content script (no imports) ---

// Config / filters
const EXCLUDE_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT"]);
const EXCLUDE_SELECTOR =
  "pre, code, textarea, input, select, option, [contenteditable]";
const TOUCHED = new WeakSet(); // track translated text nodes to avoid loops

// Entry
(async function main() {
  try {
    console.log("[CT] content loaded");
    const settings = await getSettings();
    if (!settings?.enabled) return;

    // Initial translate
    await translateTree(document.body);

    // Watch dynamic changes (SPAs, infinite scroll)
    startMutationObserver(async (nodes) => {
      const filtered = nodes.filter((n) => !shouldSkipTextNode(n));
      if (!filtered.length) return;
      await translateNodes(filtered);
    });

    // Re-run on route changes
    addEventListener("popstate", () => translateTree(document.body));
    addEventListener("hashchange", () => translateTree(document.body));

    // Popup “Apply” -> re-run
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === "CT_APPLY_NOW") translateTree(document.body);
    });
  } catch (err) {
    console.error("[CT] init error", err);
  }
})();

// ---- core functions ----
async function translateTree(root) {
  try {
    if (!root) return;
    const nodes = collectTextNodes(root);
    if (!nodes.length) return;
    await translateNodes(nodes);
  } catch (e) {
    console.error("[CT] translateTree error", e);
  }
}

async function translateNodes(nodes) {
  const texts = nodes.map(n => n.nodeValue);
  const map = new Map();
  texts.forEach((t, i) => { if (!map.has(t)) map.set(t, []); map.get(t).push(i); });
  const unique = Array.from(map.keys());

  let translations = unique;           // fallback = identity
  try {
    const resp = await translateRequest(unique, { url: location.href });
    if (Array.isArray(resp)) translations = resp;
  } catch (e) {
    console.warn("[CT] translateRequest failed; using originals", e);
  }

  const expanded = new Array(nodes.length);
  translations.forEach((tr, j) => {
    for (const idx of map.get(unique[j])) expanded[idx] = tr;
  });
  applyTranslations(nodes, expanded);
    console.log(`[CT] translated ${nodes.length} nodes`);

}


// ---- DOM helpers ----
function shouldSkipTextNode(node) {
  if (!node || node.nodeType !== Node.TEXT_NODE) return true;
  if (TOUCHED.has(node)) return true;

  const el = node.parentElement;
  if (!el) return true;
  if (EXCLUDE_TAGS.has(el.tagName)) return true;
  if (el.matches(EXCLUDE_SELECTOR)) return true;
  if (el.closest(EXCLUDE_SELECTOR)) return true;

  const txt = node.nodeValue;
  return !txt || !txt.trim();
}

function collectTextNodes(root = document.body) {
  const out = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return shouldSkipTextNode(node)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  let n;
  while ((n = walker.nextNode())) out.push(n);
  return out;
}

function applyTranslations(nodes, translations) {
  nodes.forEach((n, i) => {
    try {
      if (!n) return;
      n.nodeValue = translations[i];
      TOUCHED.add(n); // mark this specific text node as translated
    } catch (e) {
      // ignore individual node failures
    }
  });
}

function startMutationObserver(onTextNodes) {
  const mo = new MutationObserver((muts) => {
    const targets = [];
    for (const m of muts) {
      if (m.type === "childList") {
        m.addedNodes.forEach((n) => {
          if (n.nodeType === 3 && !shouldSkipTextNode(n)) {
            targets.push(n);
          } else if (n.nodeType === 1) {
            collectTextNodes(n).forEach((t) => targets.push(t));
          }
        });
      } else if (m.type === "characterData") {
        const n = m.target;
        if (!shouldSkipTextNode(n)) targets.push(n);
      }
    }
    if (targets.length) onTextNodes(targets);
  });
  mo.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  return () => mo.disconnect();
}

// ---- messaging (robust; handles extension reloads) ----
// ---- messaging (robust; handles extension reloads + sleepy SW) ----
function translateRequest(texts, context = {}) {
  return sendMessageSafe({ type: "CT_TRANSLATE_BATCH", payload: { texts, context } })
    .then(resp => (resp && resp.translations) ? resp.translations : texts);
}

function getSettings() {
  return sendMessageSafe({ type: "CT_GET_SETTINGS" })
    .then(resp => resp || { enabled: false });
}

// Generic safe send with small retry on "context invalidated" / "receiving end" errors
function sendMessageSafe(msg, retries = 3, delayMs = 200) {
  return new Promise((resolve) => {
    if (!chrome.runtime || !chrome.runtime.id) return resolve(null); // extension reloaded/unavailable
    chrome.runtime.sendMessage(msg, (resp) => {
      const err = chrome.runtime.lastError;
      if (err) {
        const m = String(err.message || "").toLowerCase();
        const transient =
          m.includes("context invalidated") ||
          m.includes("message port closed") ||
          m.includes("receiving end does not exist") ||
          m.includes("could not establish connection");
        if (transient && retries > 0) {
          return setTimeout(() =>
            resolve(sendMessageSafe(msg, retries - 1, delayMs * 2)), delayMs);
        }
        console.warn("[CT] sendMessage error:", err.message);
        return resolve(null);
      }
      resolve(resp);
    });
  });
}
