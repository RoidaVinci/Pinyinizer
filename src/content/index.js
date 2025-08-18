// --- Clean Translate: single-file content script (no imports) ---
// --- Clean Translate: single-file content script (no imports) ---

const HAN_RE = /\p{Script=Han}+/gu;

// Config / filters
const EXCLUDE_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT"]);
const EXCLUDE_SELECTOR =
  "pre, code, textarea, input, select, option, [contenteditable]";
let TOUCHED = new WeakSet(); // track translated text nodes to avoid loops
const ORIGINALS = new Map();
let currentSettings;
let currentLangs = { source: "auto", target: "es" };
let disconnectMo;

// Entry
(async function main() {
  try {
    console.log("[CT] content loaded");
    currentSettings = await getSettings();
    if (!currentSettings?.enabled) return;

    const active = currentSettings.mode === "pinyin"
      ? await annotateTree(document.body)
      : await translateTree(document.body);
    if (active) disconnectMo = startMutationObserver(handleMutations);

    addEventListener("popstate", () => {
      currentSettings?.mode === "pinyin" ? annotateTree(document.body) : translateTree(document.body);
    });
    addEventListener("hashchange", () => {
      currentSettings?.mode === "pinyin" ? annotateTree(document.body) : translateTree(document.body);
    });

    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === "CT_APPLY_NOW") {
        (async () => {
          currentSettings = await getSettings();
          revertTranslations();
          disconnectMo?.();
          const again = currentSettings.mode === "pinyin"
            ? await annotateTree(document.body)
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

async function handleMutations(nodes) {
  const filtered = nodes.filter((n) => !shouldSkipTextNode(n));
  if (!filtered.length) return;
  if (currentSettings?.mode === "pinyin") {
    await annotateNodes(filtered);
  } else {
    await translateNodes(filtered);
  }
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

async function annotateTree(root) {
  try {
    if (!root) return false;
    const nodes = collectTextNodes(root);
    if (!nodes.length) return false;
    await annotateNodes(nodes);
    return true;
  } catch (e) {
    console.error("[CT] annotateTree error", e);
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

async function annotateNodes(nodes) {
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

  // Dedup runs
  const unique = Array.from(new Set(allRuns));

  // 1) Pinyin for each unique run
  let pyArr = unique.slice();
  try {
    const resp = await sendMessageSafe({ type: "CT_ANNOTATE_BATCH", payload: { texts: unique } });
    if (Array.isArray(resp?.pinyins)) pyArr = resp.pinyins;
  } catch (e) {
    console.warn("[CT] annotateRequest failed; using originals", e);
  }
  const pyMap = new Map(unique.map((u, i) => [u, pyArr[i] || u]));

  // 2) Optional English (provider fallback, only keep Latin-without-Han)
  const showEnglish = !!(currentSettings?.annotate && currentSettings.annotate.showEnglish);
  let enMap = null;
  if (showEnglish) {
    enMap = await fetchEnglishMap(unique);
  }

  // 3) Rebuild output, remove any immediate English next to Hanzi, then insert ours
  const out = nodes.map((n, i) => {
    const txt = n.nodeValue || "";
    const runs = nodeRuns[i];
    if (!runs.length) return txt;

    let acc = "";
    let cursor = 0;
    for (const r of runs) {
      if (r.start > cursor) acc += txt.slice(cursor, r.start);

      // Always remove page-inserted English right after the Han run (paren or plain latin),
      // because if showEnglish is ON we will add our own, and if OFF we want it gone.
      let consumed = consumeAsciiParenSuffix(txt, r.end);
      if (!consumed) consumed = consumePlainLatinSuffix(txt, r.end);

      const py = pyMap.get(r.han) || r.han;

      if (showEnglish && enMap) {
        const engRaw = enMap.get(r.han) || "";
        const eng = isLatinNoHan(engRaw) ? engRaw : "";
        acc += `${r.han} (${py}${eng ? " " + eng : ""})`;
      } else {
        acc += `${r.han} (${py})`;
      }

      cursor = r.end + consumed;
    }
    if (cursor < txt.length) acc += txt.slice(cursor);
    return acc;
  });

  applyTranslations(nodes, out);

  // Clean tiny latin-only siblings the site might add (keeps DOM tidy)
  for (const n of nodes) stripFollowingLatinSiblings(n, { maxNodes: 2, maxChars: 140 });

  console.log(`[CT] annotated ${nodes.length} nodes (pinyin mode${showEnglish ? " + english" : ""})`);
}



/**
 * If right after `pos` there is a parenthesis group like:
 * " (English …)" or "（English …）" and it looks Latin (no Hanzi),
 * return its full length so we can skip it; else return 0.
 */
function isLatinNoHan(s) {
  return !!s && /[A-Za-z]/.test(s) && !/\p{Script=Han}/u.test(s);
}

async function fetchEnglishMap(unique) {
  // Try Google (fast, reliable); if any entries come back non-Latin, retry those via HTTP.
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

/**
 * If right after `pos` there is a short plain Latin snippet (no Hanzi) like " English words"
 * (possibly starting with dash, colon or whitespace), consume it.
 */
function consumePlainLatinSuffix(full, pos) {
  const slice = full.slice(pos);
  const m = /^[\s]*[-–—:·：]?\s*([A-Za-z][A-Za-z0-9\s'’\-,.:;\/]{0,160})/.exec(slice);
  if (!m) return 0;
  const chunk = (m[0] || "").trim();
  if (!chunk) return 0;
  if (/\p{Script=Han}/u.test(chunk)) return 0; // contains Hanzi → do not consume
  // Heuristic: ensure it has at least one letter to avoid eating punctuation-only
  if (!/[A-Za-z]/.test(chunk)) return 0;
  return m[0].length;
}

/**
 * Remove tiny *sibling* text nodes that are Latin-only and immediately follow a node we modified.
 * This catches cases where the site renders English in a separate text node.
 */
function stripFollowingLatinSiblings(textNode, { maxNodes = 2, maxChars = 140 } = {}) {
  let sib = textNode.nextSibling;
  let count = 0;
  while (sib && count < maxNodes) {
    if (sib.nodeType === Node.TEXT_NODE) {
      const s = (sib.nodeValue || "").trim();
      if (s && s.length <= maxChars && /[A-Za-z]/.test(s) && !/\p{Script=Han}/u.test(s)) {
        // Remove the English sibling because we've already inserted "(English pinyin)"
        try { sib.nodeValue = ""; } catch {}
      } else {
        break; // next content is not just Latin text → stop
      }
      count++;
      sib = sib.nextSibling;
      continue;
    }
    if (sib.nodeType === Node.ELEMENT_NODE) {
      // Stop if the sibling element clearly has more than just tiny Latin text
      const text = (sib.textContent || "").trim();
      if (text && text.length <= maxChars && /[A-Za-z]/.test(text) && !/\p{Script=Han}/u.test(text)) {
        // Be conservative: only clear *pure text* elements (no children) to avoid layout breakage
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

// ---- DOM helpers ----
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
  ORIGINALS.forEach((txt, node) => {
    try { node.nodeValue = txt; } catch {}
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
