// --- Clean Translate: single-file content script (no imports) ---

const HAN_RE = /\p{Script=Han}+/gu;
// --- Style constants (tweak freely) ---
// Downshift thresholds
const CT_MAX_OVERRUN_RATIO = 1.02;  // allow up to 2% scrollWidth over clientWidth before downshifting
const CT_MAX_HEIGHT_GAIN   = 1.3;   // if new height > 1.6x original, consider downshift

// Compact scales
const COMPACT_HANZI_SCALE  = 0.50;
const COMPACT_PINYIN_SCALE = 0.35;

// Hover mode tooltip look (optional — tweak later)
const HOVER_RT_BG   = "rgba(0,0,0,.75)";
const HOVER_RT_FG   = "#fff";

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
const ORIGINALS = new Map();  // Map<TextNode, { text, parent, nextSibling, wrapper }>
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
  // 1) Collect Han runs per node + unique runs + unique characters
  const nodeRuns = [];
  const allRuns = [];
  const allChars = new Set();

  nodes.forEach((n, i) => {
    const txt = n.nodeValue || "";
    const runs = [];
    for (const m of txt.matchAll(HAN_RE)) {
      const han = m[0];
      runs.push({ start: m.index, end: m.index + han.length, han });
      allRuns.push(han);
      for (const ch of Array.from(han)) allChars.add(ch);
    }
    nodeRuns[i] = runs;
  });
  if (!allRuns.length) return;

  const uniqRuns  = Array.from(new Set(allRuns));
  const uniqChars = Array.from(allChars);

  // 2) Run-level pinyin (fast path)
  let runPinyinArr = uniqRuns.slice();
  try {
    const resp = await sendMessageSafe({ type: "CT_ANNOTATE_BATCH", payload: { texts: uniqRuns } });
    if (Array.isArray(resp?.pinyins)) runPinyinArr = resp.pinyins;
  } catch {}
  const runPyMap = new Map(uniqRuns.map((u, i) => [u, runPinyinArr[i] || u]));

  // 3) Character-level pinyin (fallback for mismatches)
  let charPinyinArr = uniqChars.slice();
  try {
    const respChar = await sendMessageSafe({ type: "CT_ANNOTATE_BATCH", payload: { texts: uniqChars } });
    if (Array.isArray(respChar?.pinyins)) charPinyinArr = respChar.pinyins;
  } catch {}
  const charPyMap = new Map(uniqChars.map((u, i) => [u, charPinyinArr[i] || ""]));

  // 4) Optional sentence-level English (ONE per node)
  const showEnglish = !!(currentSettings?.annotate && currentSettings.annotate.showEnglish);
  // Build a "sentence key" for each node: concatenate its Han runs
  const sentenceKeys = nodeRuns.map(runs => runs.length ? runs.map(r => r.han).join("") : "");
  let sentenceEnMap = null;
  if (showEnglish) {
    sentenceEnMap = await fetchEnglishForSentences(sentenceKeys);
  }

  // 5) Build wrappers; measure & downshift as needed
  IS_MUTATING = true;
  try {
    nodes.forEach((node, i) => {
      const txt = node.nodeValue || "";
      const runs = nodeRuns[i];
      if (!runs.length) return;

      const wrapper = document.createElement("span");
      wrapper.setAttribute("data-ct", "ruby-block");
      wrapper.className = "ct-ruby-block";

      let cursor = 0;
      let hadEnglish = false;
      const pyPlainParts = [];

      for (const r of runs) {
        // leading plain text before this run
        if (r.start > cursor) {
          wrapper.append(document.createTextNode(txt.slice(cursor, r.start)));
        }

        // consume site-provided English that follows the Han run
        let consumed = consumeAsciiParenSuffix(txt, r.end);
        if (!consumed) consumed = consumePlainLatinSuffix(txt, r.end);

        // build ruby per character
        const ruby  = document.createElement("ruby");
        ruby.className = "ct-ruby";
        ruby.setAttribute("data-ct", "ruby");

        const chars = Array.from(r.han);
        const phrasePy = runPyMap.get(r.han) || r.han;
        const pys = syllabifyOrCharLookup(chars, phrasePy, charPyMap);

        for (let k = 0; k < chars.length; k++) {
          const rb = document.createElement("rb");
          rb.textContent = chars[k];
          const rt = document.createElement("rt");
          rt.textContent = pys[k] || "";
          ruby.appendChild(rb);
          ruby.appendChild(rt);
          if (pys[k]) pyPlainParts.push(pys[k]);
        }

        wrapper.appendChild(ruby);
        cursor = r.end + consumed;
      }

      // trailing text after last run
      if (cursor < txt.length) {
        wrapper.append(document.createTextNode(txt.slice(cursor)));
      }

      // Append ONE English gloss for the whole sentence (if any)
      if (showEnglish && sentenceEnMap) {
        const key = sentenceKeys[i];
        const en = (sentenceEnMap.get(key) || "").trim();
        if (en) {
          const enLine = document.createElement("span");
          enLine.className = "ct-sentence-en";
          enLine.textContent = `(${en})`;
          wrapper.appendChild(enLine);
          hadEnglish = true;
        }
      }

      wrapper.setAttribute("data-has-en", hadEnglish ? "1" : "0");

      if (!replaceTextNode(node, wrapper)) {
        // If the node vanished during processing, just skip this one.
        return;
      }

      // Optional local downshift if wrapper grows too tall
      const rbox = wrapper.getBoundingClientRect();
      const fontSize = parseFloat(getComputedStyle(wrapper).fontSize) || 16;
      if (rbox.height > 1.6 * fontSize) {
        const baseH = currentSettings?.annotate?.hanziScale ?? 0.90;
        const baseP = currentSettings?.annotate?.pinyinScale ?? 0.53;
        wrapper.style.setProperty('--ct-hanzi', (baseH * 0.9) + 'em');
        wrapper.style.setProperty('--ct-pinyin', (baseP * 0.9) + 'em');
      }
    });
  } finally {
    IS_MUTATING = false;
  }

  console.log(`[CT] annotated ${nodes.length} nodes (sentence-level English)`);
}


// Add anywhere above annotateNodes (or below helpers)
function replaceTextNode(node, wrapper) {
  const parent = node?.parentNode;
  if (!parent) return false;        // detached → skip safely

  const nextSibling = node.nextSibling;

  // Keep a full restoration record once.
  if (!ORIGINALS.has(node)) {
    ORIGINALS.set(node, { text: node.nodeValue, parent, nextSibling, wrapper: null });
  }

  try {
    parent.insertBefore(wrapper, node);
  } catch (_) {
    return false;                   // parent changed in between
  }

  try { node.remove(); } catch {}

  // Save wrapper reference for later removal
  const rec = ORIGINALS.get(node);
  if (rec && !rec.wrapper) rec.wrapper = wrapper;

  TOUCHED.add(node);
  return true;
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

// ---- DOM filters ----
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
      // Store full restoration info once (in case we undo later)
      if (!ORIGINALS.has(n)) {
        ORIGINALS.set(n, { text: n.nodeValue, parent: n.parentNode, nextSibling: n.nextSibling, wrapper: null });
      }
      n.nodeValue = translations[i];
      TOUCHED.add(n);
    } catch {}
  });
}

function revertTranslations() {
  ORIGINALS.forEach((rec, node) => {
    try {
      // If there was a wrapper (pinyin mode), remove it
      if (rec?.wrapper && rec.wrapper.parentNode) {
        try { rec.wrapper.remove(); } catch {}
      }
      // Restore original text content
      if (typeof rec?.text === "string") {
        node.nodeValue = rec.text;
      }
      // Reattach original text node where it used to be
      const p = rec?.parent;
      if (p && !node.parentNode) {
        try {
          if (rec.nextSibling && rec.nextSibling.parentNode === p) {
            p.insertBefore(node, rec.nextSibling);
          } else {
            p.appendChild(node);
          }
        } catch {}
      }
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

  // Read user-chosen scales from settings (with defaults)
  const hanziScaleNoEn  = currentSettings?.annotate?.hanziScale ?? 0.90;
  const pinyinScaleNoEn = currentSettings?.annotate?.pinyinScale ?? 0.53;

  // With-English scales (keep same base by default)
  const hanziScaleWithEn  = hanziScaleNoEn;
  const pinyinScaleWithEn = pinyinScaleNoEn;
  const englishScale      = pinyinScaleNoEn * 0.8;

  const css = `
  .ct-ruby { 
    ruby-position: under;
    ruby-align: center;
    white-space: normal;
    line-height: 1;            /* prevent ruby from ballooning */
  }
  .ct-ruby rb, .ct-ruby rt { white-space: pre; }
  .ct-ruby rt { line-height: 1; }

  /* No-English sizing (uses user settings) */
  .ct-ruby-block[data-has-en="0"] .ct-ruby rb { 
    font-size: var(--ct-hanzi, ${hanziScaleNoEn}em); 
    letter-spacing: 0.05em;
  }
  .ct-ruby-block[data-has-en="0"] .ct-ruby rt { 
    font-size: var(--ct-pinyin, ${pinyinScaleNoEn}em); 
    line-height: 1.1; 
    color: #555; 
  }

  /* With-English sizing (same base unless tweaked) */
  .ct-ruby-block[data-has-en="1"] .ct-ruby rb { 
    font-size: var(--ct-hanzi, ${hanziScaleWithEn}em); 
    letter-spacing: 0.05em;
  }
  .ct-ruby-block[data-has-en="1"] .ct-ruby rt { 
    font-size: var(--ct-pinyin, ${pinyinScaleWithEn}em); 
    line-height: 1.1; 
    color: #555; 
  }

  /* Sentence-level English line (one per wrapper) */
  .ct-ruby-block .ct-sentence-en {
    display: block;
    margin-top: 0.1em;
    font-size: ${englishScale}em;
    line-height: 1.05;
    color: #666;
    font-style: italic;
    white-space: normal;
    text-align: center;
    width: 100%;
  }

  /* Keep everything inline in normal flow to avoid layout explosions */
  .ct-ruby-block{
    display: inline-block;     /* not inline-flex */
    vertical-align: baseline;
    max-width: 100%;
    white-space: normal;
  }
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

// ---- English helpers (sentence-level) for pinyin mode ----
async function fetchEnglishForSentences(sentenceKeys) {
  // Build uniq list but keep mapping back
  const uniq = Array.from(new Set(sentenceKeys.filter(Boolean)));
  if (!uniq.length) return new Map();

  const primary = await requestEnglish(uniq, "google_free");
  const map = new Map();
  uniq.forEach((k, i) => map.set(k, primary[i] ?? ""));

  // Retry ones that didn't look English using HTTP provider
  const needRetry = uniq.filter(k => !/[A-Za-z]/.test(map.get(k) || ""));
  if (needRetry.length) {
    try {
      const second = await requestEnglish(needRetry, "http");
      needRetry.forEach((k, i) => {
        const v = second[i] ?? "";
        if (/[A-Za-z]/.test(v)) map.set(k, v);
      });
    } catch {}
  }
  return map;
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


function mapCharsToPinyin(chars, pinyinStr) {
  // Split pinyin on spaces (and collapse multiple spaces)
  const raw = (pinyinStr || "").trim().split(/\s+/);
  const out = [];
  if (raw.length === chars.length) {
    for (let i = 0; i < chars.length; i++) out.push(raw[i] || "");
    return out;
  }
  // Fallback: best-effort mapping (assign by index, empty if missing)
  for (let i = 0; i < chars.length; i++) out.push(raw[i] || "");
  return out;
}

function normalizePinyin(str) {
  // strip parens, commas, extra punctuation; collapse spaces
  return String(str || "")
    .replace(/[()（），,.;:·]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Try to split a pinyin phrase into syllables.
// If it looks word-level (e.g., capitalized words), this still returns tokens,
// but we only trust the result when count matches charCount.
function splitPinyinSyllables(pinyinStr) {
  const s = normalizePinyin(pinyinStr);
  if (!s) return [];
  // Tokens separated by space or apostrophe; remove stray non-letters/diacritics.
  return s.split(/[\s’']+/).map(t => t.replace(/[^a-zA-ZāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüÜĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙ]+/g, "")).filter(Boolean);
}

// Returns an array of length = chars.length.
// 1) try to syllabify pyPhrase; 2) if mismatch → build using charPinyinMap (guaranteed 1:1)
function syllabifyOrCharLookup(chars, pyPhrase, charPinyinMap) {
  const bySplit = splitPinyinSyllables(pyPhrase);
  if (bySplit.length === chars.length) return bySplit;
  // fallback to per-char map
  return chars.map(ch => charPinyinMap.get(ch) || "");
}
