// --- Clean Translate: single-file content script (no imports) ---

// Config / filters
const EXCLUDE_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT"]);
const EXCLUDE_SELECTOR =
  "pre, code, textarea, input, select, option, [contenteditable]";
let TOUCHED = new WeakSet(); // track translated text nodes to avoid loops
const ORIGINALS = new Map();
const PINYINS = new Map();
let currentSettings;
let currentLangs = { source: "auto", target: "es" };
let disconnectMo;

// Entry
(async function main() {
  try {
    console.log("[CT] content loaded");
    injectRubyStyles();
    currentSettings = await getSettings();
    if (!currentSettings?.enabled) return;

    const active = await translateTree(document.body);
    if (active) disconnectMo = startMutationObserver(handleMutations);

    // Re-run on route changes
    addEventListener("popstate", () => translateTree(document.body));
    addEventListener("hashchange", () => translateTree(document.body));

    // Messages from popup
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === "CT_APPLY_NOW") {
        (async () => {
          currentSettings = await getSettings();
          revertTranslations();
          disconnectMo?.();
          const again = await translateTree(document.body);
          if (again) disconnectMo = startMutationObserver(handleMutations);
        })();
      }
      if (msg?.type === "CT_UNDO") {
        revertTranslations();
        disconnectMo?.();
        disconnectMo = null;
      }
    });
  } catch (err) {
    console.error("[CT] init error", err);
  }
})();

async function handleMutations(nodes) {
  const filtered = nodes.filter((n) => !shouldSkipTextNode(n));
  if (!filtered.length) return;
  await translateNodes(filtered);
}

// ---- core functions ----
async function translateTree(root) {
  try {
    if (!root) return false;
    const sample = document.body?.innerText?.slice(0, 12000) || "";
    let pageLang = "und";
    try {
      const det = await chrome.i18n.detectLanguage(sample);
      pageLang = det?.languages?.[0]?.language || "und";
    } catch (e) {}
    if (currentSettings.excludeLangs?.includes(pageLang)) return false;
    const order = currentSettings.targetLangs || ["es", "en"];
    const target = order.find(l => l !== pageLang) || order[0] || "es";
    const source = currentSettings.sourceLang && currentSettings.sourceLang !== "auto"
      ? currentSettings.sourceLang
      : pageLang;
    currentLangs = { source, target };
    const nodes = collectTextNodes(root);
    if (!nodes.length) return false;
    await translateNodes(nodes);
    return true;
  } catch (e) {
    console.error("[CT] translateTree error", e);
    return false;
  }
}

async function translateNodes(nodes) {
  const texts = nodes.map(n => n.nodeValue);
  const map = new Map();
  texts.forEach((t, i) => { if (!map.has(t)) map.set(t, []); map.get(t).push(i); });
  const unique = Array.from(map.keys());

  let translations = unique;           // fallback = identity
  try {
    const resp = await translateRequest(unique, {
      sourceLang: currentLangs.source,
      targetLang: currentLangs.target,
      targetMode: currentSettings.targetMode,
      context: { url: location.href },
    });
    if (Array.isArray(resp)) translations = resp;
  } catch (e) {
    console.warn("[CT] translateRequest failed; using originals", e);
  }

  let pinyins = [];
  try {
    const respPy = await pinyinRequest(unique);
    if (Array.isArray(respPy)) pinyins = respPy;
  } catch (e) {
    console.warn("[CT] pinyinRequest failed; using originals", e);
  }

  pinyins.forEach((py, j) => {
    for (const idx of map.get(unique[j])) PINYINS.set(nodes[idx], py);
  });

  const expanded = new Array(nodes.length);
  translations.forEach((tr, j) => {
    const str = (tr && typeof tr === "object") ? (tr.pinyin || tr.characters || "") : tr;
    for (const idx of map.get(unique[j])) expanded[idx] = str;
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
  // Skip ruby annotations to avoid re-translating generated markup
  if (el.tagName === "RT") return true;
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
      if (!n || !n.parentNode) return;

      // Build ruby element: <ruby><rb>chars</rb><rt>pinyin</rt></ruby>
      const ruby = document.createElement("ruby");
      const rb = document.createElement("rb");
      const rt = document.createElement("rt");

      rb.textContent = n.nodeValue || "";
      rt.textContent = translations[i] || "";

      // Track text nodes so mutation observer ignores them
      if (rb.firstChild) TOUCHED.add(rb.firstChild);
      if (rt.firstChild) TOUCHED.add(rt.firstChild);

      ruby.appendChild(rb);
      ruby.appendChild(rt);

      // Store original text node for later restoration
      ORIGINALS.set(ruby, n);

      // Replace original text node with ruby element
      n.parentNode.replaceChild(ruby, n);
    } catch (e) {
      // ignore individual node failures
    }
  });
}

function revertTranslations() {
  ORIGINALS.forEach((orig, ruby) => {
    try {
      if (ruby.parentNode) ruby.parentNode.replaceChild(orig, ruby);
    } catch (e) {}
  });
  ORIGINALS.clear();
  TOUCHED = new WeakSet();
}

function startMutationObserver(onTextNodes) {
  const mo = new MutationObserver((muts) => {
    const targets = [];
    for (const m of muts) {
      if (m.type === "childList") {
        m.addedNodes.forEach((n) => {
          if (n.nodeType === 3 && !shouldSkipTextNode(n)) {
            targets.push(n);
          } else if (n.nodeType === 1 && n.tagName !== "RT") {
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

function injectRubyStyles() {
  const styleEl = document.createElement("style");
  styleEl.textContent = `
    ruby {
      line-height: 1.1;
    }
    ruby > rb {
      font-size: 0.9em;
    }
    ruby > rt {
      font-size: 0.6em;
      line-height: 1;
    }
  `;
  document.documentElement.appendChild(styleEl);
}

// ---- messaging (robust; handles extension reloads) ----
// ---- messaging (robust; handles extension reloads + sleepy SW) ----
function translateRequest(texts, opts = {}) {
  return sendMessageSafe({ type: "CT_TRANSLATE_BATCH", payload: { texts, opts } })
    .then(resp => (resp && resp.translations) ? resp.translations : texts);
}

function pinyinRequest(texts) {
  return sendMessageSafe({ type: "CT_PINYIN_BATCH", payload: { texts } })
    .then(resp => (resp && resp.pinyin) ? resp.pinyin : texts);
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
