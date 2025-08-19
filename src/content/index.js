// --- Clean Translate: single-file content script (no imports) ---
(() => {
  // Skip if we've already run in this page/frame (same isolated world)
  if (window.__CT_LOADED__) {
    try { console.debug("[CT] content script already loaded — skipping"); } catch {}
    return;
  }
  window.__CT_LOADED__ = true;

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
let SESSION_MODE_OVERRIDE = null;
const getMode = () => (SESSION_MODE_OVERRIDE || (currentSettings?.mode || "translate"));


// Entry
(async function main() {
  try {
    if (__CT_ALREADY__) {
      // Another injected instance got here first for this document; do nothing.
      return;
    }

    currentSettings = await getSettings();
    if (!currentSettings?.enabled) return;
    try {
      // Undo any previous accidental root-level tweaks
      const html = document.documentElement;
      const body = document.body;
      ["min-height", "height", "overflow-y", "overflow"].forEach(p => {
        if (html && html.style && html.style[p]) html.style.removeProperty(p);
        if (body && body.style && body.style[p]) body.style.removeProperty(p);
      });
    } catch {}


    // Let BFCache restore settle, then check if ruby already present
    await raf2();
    if (currentSettings.mode === "pinyin") {
      if (!disconnectMo) disconnectMo = startMutationObserver(handleMutations);
      if (!hasPinyinDecorations(document)) {
        await annotateTreeWithLock(document.body);
      }
    } else {
      const did = await translateTree(document.body);
      // Also observe in translate mode even if initial pass had nothing
      if (!disconnectMo) disconnectMo = startMutationObserver(handleMutations);    }

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
          if (!currentSettings?.enabled) {
            revertTranslations();
            disconnectMo?.();
            disconnectMo = null;
            return;
          }
          revertTranslations();
          disconnectMo?.();
          await raf();
          // Ensure stale flags never block a new pinyin pass
          try {
            const html = document.documentElement;
            html.removeAttribute("data-ct-pinyin-applied");
            html.removeAttribute("data-ct-pinyin-pending");
          } catch {}
          const again = currentSettings.mode === "pinyin"
          ? (await annotateTreeWithLock(document.body), true)
          : (await translateTree(document.body), true);
          if (!disconnectMo) disconnectMo = startMutationObserver(handleMutations);
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
  if (!currentSettings?.enabled) return;
  const filtered = nodes.filter((n) => !shouldSkipTextNode(n));
  if (!filtered.length) return;
  if (getMode() === "pinyin") {
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
    if (html.hasAttribute("data-ct-pinyin-pending")) {
    // If a previous run hung, allow retry after 5 seconds
    const ts = +html.getAttribute("data-ct-pinyin-pending") || 0;
    if (Date.now() - ts < 5000) return false;
    html.removeAttribute("data-ct-pinyin-pending");
  }
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
// If inside a nav/menu, don't touch layout; just compress the anchor.
const inNav = wrapper.closest('.nav-cont, .nav, .menu, .navbar');
if (inNav) {
  // hide the English gloss in navs (extra safety; also done via CSS)
  try { wrapper.querySelector('.ct-sentence-en')?.remove(); } catch {}
  const a = wrapper.closest('a');
  if (a) {
    a.style.whiteSpace = 'nowrap';
    a.style.textOverflow = 'ellipsis';
    a.style.overflow = 'hidden';
    if (!a.style.maxWidth) a.style.maxWidth = '12ch';
  }
} else {
  adaptLayout(wrapper);
  fixRowLayout(wrapper);
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

// ===== Adaptive layout helpers =====
function adaptLayout(wrapper) {
  let el = wrapper.parentElement;
  for (let hops = 0; el && hops < 6; hops++, el = el.parentElement) {
    const tag = el.tagName;
    // Never touch global chrome: these caused the footer-in-the-middle bug
    if (tag === "HTML" || tag === "BODY" || tag === "HEADER" || tag === "NAV" || tag === "FOOTER") break;

    const cs = getComputedStyle(el);
    // 0) Always try to defeat single-line ellipsis and -webkit-line-clamp here.
    openEllipsis(el, cs);

    // 1) CSS Grid with fixed auto rows (masonry-like)
    if (cs.display === "grid") {
      tryGridRowSpan(el, wrapper);
      const item = findImmediateItem(wrapper, el);
      if (item) {
        item.style.minWidth = "0";
        item.style.minHeight = "0";
        item.style.overflow = "visible";
      }
      // grid handled; keep walking one more ancestor just in case, then break
      continue;
    }

    // 2) Flex rows that vertically center/squash
    if (cs.display === "flex") {
      const item = findImmediateItem(wrapper, el);
      if (item) {
        item.style.minWidth = "0";
        item.style.minHeight = "0";
        item.style.overflow = "visible";
      }
      // keep walking; there may still be a fixed-height ancestor
    }

    // 3) Tables
    if (el.tagName === "TD" || el.tagName === "TH") {
      el.style.whiteSpace = "normal";
      el.style.overflow = "visible";
      el.style.verticalAlign = "top";
    }

    // 4) Fixed-height / max-height rows (common in announcement lists)
    //    If content is taller than the box, let it grow.
    const hPx = parseFloat(cs.height);
    const hasFixedHeight =
      cs.height && cs.height.endsWith("px") && hPx > 0 && cs.height !== "auto";

    const maxPx = parseFloat(cs.maxHeight);
    const hasMaxHeight =
      cs.maxHeight && cs.maxHeight !== "none" && !Number.isNaN(maxPx);

    const needMoreY = el.scrollHeight > el.clientHeight + 1;

    if (needMoreY && (hasFixedHeight || hasMaxHeight)) {
      // preserve at least old visual height; then allow growth
      if (hasFixedHeight) {
        el.style.minHeight = Math.max(hPx, el.clientHeight) + "px";
        el.style.height = "auto";
      }
      if (hasMaxHeight) {
        el.style.maxHeight = "none";
      }
      el.style.overflowY = "visible";
    }

    // 5) If ancestor itself is clipping, open it up (one by one, locally)
    if (needMoreY && (cs.overflowY === "hidden" || cs.overflowY === "clip")) {
      el.style.overflowY = "visible";
    }
    if (cs.overflowX === "hidden" || cs.overflowX === "clip") {
      el.style.overflowX = "visible";
    }
  }
}

function openEllipsis(el, cs = getComputedStyle(el)) {
  const t = el.tagName;
  if (t === "HTML" || t === "BODY" || t === "HEADER" || t === "NAV" || t === "FOOTER") return;
  // Single-line ellipsis pattern: nowrap + hidden/ellipsis
  if (cs.whiteSpace === "nowrap" &&
      (cs.textOverflow === "ellipsis" || cs.overflowX === "hidden" || cs.overflow === "hidden")) {
    el.style.whiteSpace = "normal";
    el.style.textOverflow = "clip";
    el.style.overflowX = "visible";
    el.style.overflow = "visible";
  }

  // WebKit line-clamp pattern: display:-webkit-box + -webkit-line-clamp
  // We can't read webkitLineClamp from computed styles reliably; detect by display.
  if (cs.display === "-webkit-box") {
    // break the clamp: switch to block and remove clamp + orientation
    el.style.display = "block";
    el.style.webkitLineClamp = "unset";
    el.style.webkitBoxOrient = "initial";
    el.style.overflow = "visible";
  }
}


// ===== Row layout fix: keep columns aligned and rows growing together =====

// Find the nearest "row-like" container for this wrapper.
// We stop before touching HTML/BODY/HEADER/NAV/FOOTER.
function findRowContainer(wrapper) {
  let el = wrapper.parentElement;
  for (let hops = 0; el && hops < 8; hops++, el = el.parentElement) {
    const tag = el.tagName;
    if (tag === "HTML" || tag === "BODY" || tag === "HEADER" || tag === "NAV" || tag === "FOOTER") return null;

    const cs = getComputedStyle(el);
    const disp = cs.display;

    // Strong signals of a "row": table-row, <tr>, list-item with multiple columns, flex/grid with multiple children
    const isTableRow = tag === "TR" || disp === "table-row";
    const isFlexOrGrid = (disp === "flex" || disp === "inline-flex" || disp === "grid" || disp === "inline-grid");

    if (isTableRow) return el;

    if (isFlexOrGrid) {
      // Heuristic: row-like if it has 2–6 element children (left/title/right style)
      const childEls = Array.from(el.children).filter(n => n.nodeType === 1);
      if (childEls.length >= 2 && childEls.length <= 6) return el;
    }

    // Lists that act like rows
    if (tag === "LI" || el.getAttribute("role") === "row") return el;
  }
  return null;
}

function fixRowLayout(wrapper) {
  const row = findRowContainer(wrapper);
  if (!row) return;

  const cs = getComputedStyle(row);
  const disp = cs.display;

  // 1) Ensure the row itself can grow in height (remove fixed heights/clamps)
  const hPx = parseFloat(cs.height);
  const hasFixedH = cs.height && cs.height.endsWith("px") && hPx > 0 && cs.height !== "auto";
  if (hasFixedH) {
    row.style.minHeight = Math.max(hPx, row.clientHeight) + "px";
    row.style.height = "auto";
  }
  if (cs.maxHeight && cs.maxHeight !== "none") row.style.maxHeight = "none";
  if ((cs.overflowY === "hidden" || cs.overflowY === "clip") && row.scrollHeight > row.clientHeight + 1) {
    row.style.overflowY = "visible";
  }

  // 2) Align all sibling cells to the top and allow them to grow
  const kids = Array.from(row.children);
  if (disp === "flex" || disp === "inline-flex") {
    // Align row’s cross-axis to top; keep nowrap so columns stay in one line
    row.style.alignItems = "flex-start";
    row.style.flexWrap = "nowrap";
    kids.forEach(ch => {
      ch.style.alignSelf = "flex-start";
      ch.style.minHeight = "0";
      ch.style.minWidth = "0";
      ch.style.overflow = "visible";
      // let text wrap only where ruby is (we already set white-space in CSS for the ruby cell)
    });
  } else if (disp === "grid" || disp === "inline-grid") {
    row.style.alignItems = "start";
    kids.forEach(ch => {
      ch.style.alignSelf = "start";
      ch.style.minHeight = "0";
      ch.style.minWidth = "0";
      ch.style.overflow = "visible";
    });
    // If author used fixed grid-auto-rows, let the row size to content
    if (cs.gridAutoRows && cs.gridAutoRows !== "auto") {
      row.style.gridAutoRows = "auto";
    }
  } else if (row.tagName === "TR") {
    kids.forEach(ch => { ch.style.verticalAlign = "top"; });
  }

  // 3) If the “badge” (first column) is wrapping, clamp it; date stays single line.
  //    This keeps the three columns visually aligned.
  const first = kids[0], last = kids[kids.length - 1];
  if (first && first !== wrapper) {
    first.style.whiteSpace = "nowrap";
    first.style.textOverflow = "ellipsis";
    first.style.overflow = "hidden";
    // limit to a reasonable width so the title column has room
    if (!first.style.maxWidth) first.style.maxWidth = "12ch";
  }
  if (last) {
    last.style.whiteSpace = "nowrap";
  }
}


function findImmediateItem(node, containerEl) {
  // We want the first non-display:contents ancestor inside the container
  let el = node.parentElement;
  while (el && el !== containerEl) {
    const cs = getComputedStyle(el);
    if (cs.display !== "contents") return el;
    el = el.parentElement;
  }
  return null;
}

function tryGridRowSpan(gridEl, wrapper) {
  const cs = getComputedStyle(gridEl);
  const autoRows = cs.gridAutoRows; // e.g. "12px" or "auto"
  if (!autoRows || autoRows === "auto") return;

  const rowSize = parseFloat(autoRows);
  if (!rowSize || !Number.isFinite(rowSize)) return;

  const rowGap = parseFloat(cs.rowGap) || 0;

  // Measure the grid item’s rendered height
  const item = findImmediateItem(wrapper, gridEl) || wrapper;
  // Force a reflow after ruby inject
  const h = item.getBoundingClientRect().height;

  // Classic masonry span calculation
  const spans = Math.max(1, Math.ceil((h + rowGap) / (rowSize + rowGap)));
  item.style.gridRowEnd = `span ${spans}`;
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
      if (n.parentElement) n.parentElement.setAttribute("data-ct", "1");
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
    try {
    const html = document.documentElement;
    html.removeAttribute("data-ct-pinyin-applied");
    html.removeAttribute("data-ct-pinyin-pending");
  } catch {}
}

let pendingNodes = new Set();
let flushTimer = null;

function startMutationObserver(onTextNodes) {
  const mo = new MutationObserver((muts) => {
    if (IS_MUTATING) return;
    for (const m of muts) {
      if (m.type === "childList") {
        m.addedNodes.forEach((n) => {
          if (n.nodeType === 3 && !shouldSkipTextNode(n)) pendingNodes.add(n);
          else if (n.nodeType === 1) collectTextNodes(n).forEach((t) => pendingNodes.add(t));
        });
      } else if (m.type === "characterData") {
        const n = m.target;
        if (!shouldSkipTextNode(n)) pendingNodes.add(n);
      }
    }
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        const arr = Array.from(pendingNodes);
        pendingNodes.clear();
        flushTimer = null;
        if (arr.length) onTextNodes(arr);
      }, 50);
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
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

    /* === Adaptive layout helpers (only where ruby exists) === */

  /* Let pinyin/English wrap instead of overflowing */
  .ct-ruby-block {
    overflow-wrap: anywhere;
    word-break: normal;
    white-space: normal;
    vertical-align: baseline;
  }

/* Only the direct parent of our wrapper, and never headers/nav/footers */
*:has(> .ct-ruby-block):not(header):not(nav):not(footer)
{
  min-width: 0;
  min-height: 0;
}

/* Flex: only the element whose direct child is the ruby wrapper */
*:has(> .ct-ruby-block):not(header):not(nav):not(footer)[style*="display:flex"],
*:has(> .ct-ruby-block):not(header):not(nav):not(footer)[class*="flex"]
{
  align-items: stretch;
  overflow: visible;
}

/* Grid: only the element whose direct child is the ruby wrapper */
*:has(> .ct-ruby-block):not(header):not(nav):not(footer)[style*="display:grid"],
*:has(> .ct-ruby-block):not(header):not(nav):not(footer)[class*="grid"]
{
  overflow: visible;
}

/* Rows that contain our ruby: keep columns aligned */
tr:has(.ct-ruby-block) > th,
tr:has(.ct-ruby-block) > td {
  vertical-align: top;
}

/* FIRST column (red unit badge): keep it single-line & clipped
   so it doesn't push or break row alignment */
tr:has(.ct-ruby-block) > th:first-child,
tr:has(.ct-ruby-block) > td:first-child,
li:has(.ct-ruby-block) > *:first-child {
  max-width: 12ch;                 /* narrow badge column; tweak if needed */
  white-space: nowrap !important;  /* never wrap here */
  overflow: hidden !important;     /* clip extra */
  text-overflow: ellipsis !important;
}

/* MIDDLE column (title): may wrap normally */
td:has(.ct-ruby-block),
th:has(.ct-ruby-block) {
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}

/* LAST column (date/short code): keep it single-line */
tr:has(.ct-ruby-block) > th:last-child,
tr:has(.ct-ruby-block) > td:last-child,
tr:has(.ct-ruby-block) time {
  white-space: nowrap !important;
}
/* === Content lists (NOT navs): keep one-line columns; grow li height if needed === */
ul:not(.nav-cont):not(.menu):not(.navbar):not(.nav) > li:has(.ct-ruby-block) {
  display: flex;
  flex-wrap: nowrap;
  align-items: flex-start;
  gap: 0.5rem;
}

ul:not(.nav-cont):not(.menu):not(.navbar):not(.nav) > li:has(.ct-ruby-block) > *:first-child {
  flex: 0 0 auto;
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  max-width: 12ch;
}

ul:not(.nav-cont):not(.menu):not(.navbar):not(.nav) > li:has(.ct-ruby-block) > *:nth-child(2) {
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}

ul:not(.nav-cont):not(.menu):not(.navbar):not(.nav) > li:has(.ct-ruby-block) > *:last-child {
  flex: 0 0 auto;
  white-space: nowrap !important;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* === NAV BARS (bicmr.nav) — do NOT convert <li> to flex; keep items single-line === */
.nav-cont li:has(.ct-ruby-block),
.nav li:has(.ct-ruby-block),
.menu li:has(.ct-ruby-block),
.navbar li:has(.ct-ruby-block) {
  display: block;                 /* restore default */
}

.nav-cont li:has(.ct-ruby-block) > a,
.nav li:has(.ct-ruby-block) > a,
.menu li:has(.ct-ruby-block) > a,
.navbar li:has(.ct-ruby-block) > a {
  display: inline-block;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
  max-width: 12ch;                /* keep nav labels compact */
}

/* Nav: hide sentence-level English to avoid tall items */
.nav-cont li .ct-sentence-en,
.nav li .ct-sentence-en,
.menu li .ct-sentence-en,
.navbar li .ct-sentence-en {
  display: none !important;
}



  /* Translate-mode: make marked parents wrap long translations */
  [data-ct="1"] {
    overflow-wrap: anywhere;
    word-break: break-word; /* older sites */
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


})(); // end IIFE, prevents top-level redeclarations
