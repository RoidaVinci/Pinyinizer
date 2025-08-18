// --- Clean Translate: single-file content script (no imports) ---

const HAN_RE = /\p{Script=Han}+/gu;

// ===== Single-instance guard (no top-level return) =====
const __CT_HTML__ = document.documentElement;
const __CT_ALREADY__ = __CT_HTML__.getAttribute("data-ct-cs") === "1";
if (!__CT_ALREADY__) {
  __CT_HTML__.setAttribute("data-ct-cs", "1");
}

// Config / filters
const EXCLUDE_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT"]);
const EXCLUDE_SELECTOR =
  "pre, code, textarea, input, select, option, [contenteditable]";
let TOUCHED = new WeakSet();
const ORIGINALS = new Map();
let currentSettings;
let currentLangs = { source: "auto", target: "es" };
let disconnectMo;
let IS_MUTATING = false;

// Entry
(async function main() {
  try {
    if (__CT_ALREADY__) {
      // Another injected instance got here first for this document; do nothing.
      return;
    }

    currentSettings = await getSettings();
    if (!currentSettings?.enabled) return;

    // Let BFCache restore settle, then check if ruby already present
    await raf2();

    if (currentSettings.mode === "pinyin") {
      if (hasPinyinDecorations(document)) {
        // Already annotated (BFCache/previous run) → do nothing
      } else {
        const did = await annotateTreeWithLock(document.body);
        if (did) disconnectMo = startMutationObserver(handleMutations);
      }
    } else {
      const did = await translateTree(document.body);
      if (did) disconnectMo = startMutationObserver(handleMutations);
    }

    // In pinyin mode we don’t re-run on SPA events; MO handles incremental DOM
    addEventListener("popstate", () => {
      if (currentSettings?.mode !== "pinyin") translateTree(document.body);
    });
    addEventListener("hashchange", () => {
      if (currentSettings?.mode !== "pinyin") translateTree(document.body);
    });

    // Messages from popup
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === "CT_APPLY_NOW") {
        (async () => {
          currentSettings = await getSettings();
          revertTranslations();
          disconnectMo?.();
          await raf();
          const again = currentSettings.mode === "pinyin"
            ? (!hasPinyinDecorations(document) && await annotateTreeWithLock(document.body))
            : await translateTree(document.body);
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

// MO handler
async function handleMutations(nodes) {
  const filtered = nodes.filter((n) => !shouldSkipTextNode(n));
  if (!filtered.length) return;
  if (currentSettings?.mode === "pinyin") {
    await annotateNodes(filtered);
  } else {
    await translateNodes(filtered);
  }
}

// ---- TRANSLATE MODE ----
async function translateTree(root) {
  try {
    if (!root) return false;
    const sample = document.body?.innerText?.slice(0, 12000) || "";
    let pageLang = "und";
    try {
      const det = await chrome.i18n.detectLanguage(sample);
      pageLang = det?.languages?.[0]?.language || "und";
    } catch {}
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

  let translations = unique;
  try {
    const resp = await translateRequest(unique, {
      sourceLang: currentLangs.source,
      targetLang: currentLangs.target,
      context: { url: location.href },
    });
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

// ---- PINYIN MODE ----

// Cross-instance atomic lock using Web Locks API (with safe fallback)
async function annotateTreeWithLock(root) {
  // Prefer navigator.locks to serialize across all content-script instances
  if (navigator.locks && navigator.locks.request) {
    let did = false;
    try {
      await navigator.locks.request("ct-pinyin-lock", { mode: "exclusive" }, async () => {
        did = await annotateTree(root);
      });
      return did;
    } catch (e) {
      console.warn("[CT] Web Locks not available/failed, falling back to attribute lock:", e);
      // Fall through to attribute-locked annotateTree
    }
  }
  return await annotateTree(root);
}

async function annotateTree(root) {
  const html = document.documentElement;

  // Attribute lock (works across isolated worlds) — set BEFORE any await.
  if (html.getAttribute("data-ct-pinyin-applied") === "1") return false;
  if (html.hasAttribute("data-ct-pinyin-pending")) return false;
  html.setAttribute("data-ct-pinyin-pending", String(Date.now()));

  try {
    if (!root) {
      html.removeAttribute("data-ct-pinyin-pending");
      return false;
    }

    ensurePinyinStyles();

    const nodes = collectTextNodes(root);
    if (!nodes.length) {
      html.removeAttribute("data-ct-pinyin-pending");
      return false;
    }

    await annotateNodes(nodes);

    html.setAttribute("data-ct-pinyin-applied", "1");
    html.removeAttribute("data-ct-pinyin-pending");
    return true;
  } catch (e) {
    console.error("[CT] annotateTree error", e);
    html.removeAttribute("data-ct-pinyin-pending");
    return false;
  }
}

async function annotateNodes(nodes) {
  // Collect Han runs per node
  const nodeRuns = [];
  const allRuns = [];
  nodes.forEach((n, i) => {
    const txt = n.nodeValue || "";
    const runs = [];
    for (const m of txt.matchAll(HAN_RE)) {
      runs.push({ start: m.index, end: m.index + m[0].length, han: m[0] });
      allRuns.push(m[0]);
    }
    nodeRuns[i] = runs;
  });
  if (!allRuns.length) return;

  // Unique runs for lookup
  const unique = Array.from(new Set(allRuns));

  // 1) Pinyin map
  let pyArr = unique.slice();
  try {
    const resp = await sendMessageSafe({ type: "CT_ANNOTATE_BATCH", payload: { texts: unique } });
    if (Array.isArray(resp?.pinyins)) pyArr = resp.pinyins;
  } catch {}
  const pyMap = new Map(unique.map((u, i) => [u, pyArr[i] || u]));

  // 2) Optional English map
  const showEnglish = !!(currentSettings?.annotate && currentSettings.annotate.showEnglish);
  let enMap = null;
  if (showEnglish) enMap = await fetchEnglishMap(unique);

  // 3) Build wrappers + ruby per node
  IS_MUTATING = true;
  try {
    nodes.forEach((node, i) => {
      const txt = node.nodeValue || "";
      const runs = nodeRuns[i];
      if (!runs.length) return;

      const wrapper = document.createElement("span");
      wrapper.setAttribute("data-ct", "ruby-block"); // we always skip inside this
      wrapper.className = "ct-ruby-block";

      let cursor = 0;

      for (const r of runs) {
        if (r.start > cursor) {
          wrapper.append(document.createTextNode(txt.slice(cursor, r.start)));
        }

        // consume any immediate site-provided English
        let consumed = consumeAsciiParenSuffix(txt, r.end);
        if (!consumed) consumed = consumePlainLatinSuffix(txt, r.end);

        // ruby block
        const ruby = document.createElement("ruby");
        ruby.className = "ct-ruby";
        ruby.setAttribute("data-ct", "ruby");

        const rb = document.createElement("rb");
        rb.textContent = r.han;

        const rt = document.createElement("rt");
        const py = pyMap.get(r.han) || r.han;
        if (showEnglish && enMap) {
          const engRaw = enMap.get(r.han) || "";
          const eng = isLatinNoHan(engRaw) ? (" " + engRaw) : "";
          rt.textContent = `${py}${eng}`;
        } else {
          rt.textContent = py;
        }

        ruby.appendChild(rb);
        ruby.appendChild(rt);
        wrapper.appendChild(ruby);

        cursor = r.end + consumed;
      }

      if (cursor < txt.length) {
        wrapper.append(document.createTextNode(txt.slice(cursor)));
      }

      try {
        if (!ORIGINALS.has(node)) {
            ORIGINALS.set(node, { text: txt });
          }
          node.replaceWith(wrapper);
        TOUCHED.add(node);
      } catch {}
    });
  } finally {
    IS_MUTATING = false;
  }

  // Optional: clean tiny latin-only siblings
  for (const n of nodes) stripFollowingLatinSiblings(n, { maxNodes: 2, maxChars: 140 });

  console.log(`[CT] annotated ${nodes.length} nodes (ruby)`);
}

// ---- helpers: consume site english ----
function consumeAsciiParenSuffix(full, pos) {
  const slice = full.slice(pos);
  const m = /^[\s]*([\(\uFF08])([^)\uFF09]{0,120})([\)\uFF09])/.exec(slice);
  if (!m) return 0;
  const inside = m[2].trim();
  if (!inside) return 0;
  const hasHan = /\p{Script=Han}/u.test(inside);
  const hasLatin = /[A-Za-z]/.test(inside);
  if (hasLatin && !hasHan) return m[0].length;
  return 0;
}

function consumePlainLatinSuffix(full, pos) {
  const slice = full.slice(pos);
  const m = /^[\s]*[-–—:·：]?\s*([A-Za-z][A-Za-z0-9\s'’\-,.:;\/]{0,160})/.exec(slice);
  if (!m) return 0;
  const chunk = (m[0] || "").trim();
  if (!chunk) return 0;
  if (/\p{Script=Han}/u.test(chunk)) return 0;
  if (!/[A-Za-z]/.test(chunk)) return 0;
  return m[0].length;
}

function stripFollowingLatinSiblings(textNode, { maxNodes = 2, maxChars = 140 } = {}) {
  let sib = textNode.nextSibling;
  let count = 0;
  while (sib && count < maxNodes) {
    if (sib.nodeType === Node.TEXT_NODE) {
      const s = (sib.nodeValue || "").trim();
      if (s && s.length <= maxChars && /[A-Za-z]/.test(s) && !/\p{Script=Han}/u.test(s)) {
        try { sib.nodeValue = ""; } catch {}
      } else break;
      count++;
      sib = sib.nextSibling;
      continue;
    }
    if (sib.nodeType === Node.ELEMENT_NODE) {
      const text = (sib.textContent || "").trim();
      if (text && text.length <= maxChars && /[A-Za-z]/.test(text) && !/\p{Script=Han}/u.test(text)) {
        if (!sib.firstElementChild) {
          try { sib.textContent = ""; } catch {}
          count++;
          sib = sib.nextSibling;
          continue;
        }
      }
      break;
    }
    sib = sib.nextSibling;
  }
}

// ---- DOM filters ----
function isLatinNoHan(s) {
  if (!s) return false;
  return /[A-Za-z]/.test(s) && !/\p{Script=Han}/u.test(s);
}

function shouldSkipTextNode(node) {
  if (!node || node.nodeType !== Node.TEXT_NODE) return true;
  if (TOUCHED.has(node)) return true;

  const el = node.parentElement;
  if (!el) return true;
  if (EXCLUDE_TAGS.has(el.tagName)) return true;
  if (el.matches(EXCLUDE_SELECTOR)) return true;
  if (el.closest(EXCLUDE_SELECTOR)) return true;

  // Skip anything inside our injected wrappers / ruby
  if (el.closest('[data-ct]')) return true;
  if (el.closest('.ct-ruby')) return true;

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
      if (!ORIGINALS.has(n)) ORIGINALS.set(n, n.nodeValue);
      n.nodeValue = translations[i];
      TOUCHED.add(n);
    } catch {}
  });
}

function revertTranslations() {
  ORIGINALS.forEach((rec, node) => {
    try {
      if (rec?.wrapper) {
        try { rec.wrapper.remove(); } catch {}
      }
      node.nodeValue = rec?.text ?? node.nodeValue;
    } catch {}
  });
  ORIGINALS.clear();
  TOUCHED = new WeakSet();
}

function startMutationObserver(onTextNodes) {
  const mo = new MutationObserver((muts) => {
    if (IS_MUTATING) return;

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

// ---- messaging ----
function translateRequest(texts, opts = {}) {
  return sendMessageSafe({ type: "CT_TRANSLATE_BATCH", payload: { texts, opts } })
    .then(resp => (resp && resp.translations) ? resp.translations : texts);
}

function getSettings() {
  return sendMessageSafe({ type: "CT_GET_SETTINGS" })
    .then(resp => resp || { enabled: false });
}

function sendMessageSafe(msg, retries = 3, delayMs = 200) {
  return new Promise((resolve) => {
    if (!chrome.runtime || !chrome.runtime.id) return resolve(null);
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

// ---- styles & presence checks ----
function ensurePinyinStyles() {
  if (document.getElementById("ct-pinyin-styles")) return;
  const css = `
  .ct-ruby { ruby-position: under; }
  .ct-ruby rt { font-size: 0.72em; line-height: 0.9; color: #555; }
  .ct-ruby rb { font-size: 0.92em; }
  `;
  const el = document.createElement("style");
  el.id = "ct-pinyin-styles";
  el.textContent = css;
  document.documentElement.appendChild(el);
}

function hasPinyinDecorations(root = document) {
  // Presence of our wrappers is the BFCache-safe signal
  return !!root.querySelector('[data-ct="ruby-block"], .ct-ruby');
}

// small timing helpers
function raf() { return new Promise(r => requestAnimationFrame(r)); }
async function raf2() { await raf(); await raf(); }

// ---- English helpers for pinyin mode ----
async function fetchEnglishMap(unique) {
  const first = await requestEnglish(unique, "google_free");
  const out = new Map();

  const retryIdx = [];
  const retryArr = [];
  unique.forEach((u, i) => {
    const v = first[i] ?? "";
    if (isLatinNoHan(v)) {
      out.set(u, v);
    } else {
      retryIdx.push(i);
      retryArr.push(u);
    }
  });

  if (retryArr.length) {
    try {
      const second = await requestEnglish(retryArr, "http");
      retryIdx.forEach((origIdx, j) => {
        const v = second[j] ?? "";
        out.set(unique[origIdx], isLatinNoHan(v) ? v : "");
      });
    } catch {
      retryIdx.forEach((origIdx) => out.set(unique[origIdx], ""));
    }
  }

  return out;
}

async function requestEnglish(arr, provider) {
  const resp = await sendMessageSafe({
    type: "CT_TRANSLATE_BATCH",
    payload: {
      texts: arr,
      opts: {
        sourceLang: "zh",
        targetLang: "en",
        provider,
        allowInPinyin: true,
        context: { url: location.href }
      }
    }
  });
  return Array.isArray(resp?.translations) ? resp.translations : arr;
}
