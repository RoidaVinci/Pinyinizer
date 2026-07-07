// Pinyin mode: wrap Han runs in <ruby> with per-character pinyin, optionally
// followed by one English gloss per sentence.

import { state } from "./state.js";
import { collectTextNodes, replaceTextNode } from "./dom.js";
import { sendMessageSafe } from "./messaging.js";
import {
  HAN_RE,
  consumeAsciiParenSuffix,
  consumePlainLatinSuffix,
  syllabifyOrCharLookup,
} from "./pinyin-text.js";

// Serialize across all content-script instances via the Web Locks API, with
// the attribute lock in annotateTree as cross-world fallback.
export async function annotateTreeWithLock(root) {
  if (navigator.locks?.request) {
    let did = false;
    try {
      await navigator.locks.request("ct-pinyin-lock", { mode: "exclusive" }, async () => {
        did = await annotateTree(root);
      });
      return did;
    } catch (e) {
      console.warn("[CT] Web Locks unavailable, using attribute lock only:", e);
    }
  }
  return annotateTree(root);
}

export async function annotateTree(root) {
  const html = document.documentElement;

  // Attribute lock (visible across isolated worlds) — set BEFORE any await.
  if (html.getAttribute("data-ct-pinyin-applied") === "1") return false;
  if (html.hasAttribute("data-ct-pinyin-pending")) {
    // If a previous run hung, allow a retry after 5 seconds.
    const ts = +html.getAttribute("data-ct-pinyin-pending") || 0;
    if (Date.now() - ts < 5000) return false;
    html.removeAttribute("data-ct-pinyin-pending");
  }
  html.setAttribute("data-ct-pinyin-pending", String(Date.now()));

  try {
    if (!root) return false;
    ensurePinyinStyles();

    const nodes = collectTextNodes(root);
    if (!nodes.length) return false;

    await annotateNodes(nodes);
    html.setAttribute("data-ct-pinyin-applied", "1");
    return true;
  } catch (e) {
    console.error("[CT] annotateTree error", e);
    return false;
  } finally {
    html.removeAttribute("data-ct-pinyin-pending");
  }
}

export async function annotateNodes(nodes) {
  // 1) Collect Han runs per node, plus unique runs and unique characters.
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

  const uniqRuns = Array.from(new Set(allRuns));
  const uniqChars = Array.from(allChars);

  // 2) Run-level pinyin (fast path), per-character fallback, and optional
  // sentence-level English — three independent round-trips, in parallel.
  const showEnglish = !!state.settings?.annotate?.showEnglish;
  const sentenceKeys = nodeRuns.map(runs => runs.length ? runs.map(r => r.han).join("") : "");
  const [runPyMap, charPyMap, sentenceEnMap] = await Promise.all([
    fetchPinyinMap(uniqRuns),
    fetchPinyinMap(uniqChars, ""),
    showEnglish ? fetchEnglishForSentences(sentenceKeys) : null,
  ]);

  // 5) Build ruby wrappers (DOM writes only — measurements are batched
  // afterwards so we don't force one reflow per node).
  const inserted = [];
  state.isMutating = true;
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

      for (const r of runs) {
        if (r.start > cursor) {
          wrapper.append(document.createTextNode(txt.slice(cursor, r.start)));
        }

        // Consume site-provided English that follows the Han run.
        let consumed = consumeAsciiParenSuffix(txt, r.end);
        if (!consumed) consumed = consumePlainLatinSuffix(txt, r.end);

        const ruby = document.createElement("ruby");
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
        }

        wrapper.appendChild(ruby);
        cursor = r.end + consumed;
      }

      if (cursor < txt.length) {
        wrapper.append(document.createTextNode(txt.slice(cursor)));
      }

      if (showEnglish && sentenceEnMap) {
        const en = (sentenceEnMap.get(sentenceKeys[i]) || "").trim();
        if (en) {
          const enLine = document.createElement("span");
          enLine.className = "ct-sentence-en";
          enLine.textContent = `(${en})`;
          wrapper.appendChild(enLine);
          hadEnglish = true;
        }
      }
      wrapper.setAttribute("data-has-en", hadEnglish ? "1" : "0");

      if (replaceTextNode(node, wrapper)) inserted.push(wrapper);
    });

    // 6) Downshift wrappers that ballooned the line: one read pass over all
    // wrappers, then one write pass (instead of write→read per node, which
    // forces a synchronous reflow for every annotated text node).
    const tooTall = inserted.filter((w) => {
      const fontSize = parseFloat(getComputedStyle(w).fontSize) || 16;
      return w.getBoundingClientRect().height > 1.6 * fontSize;
    });
    const baseH = state.settings?.annotate?.hanziScale ?? 0.90;
    const baseP = state.settings?.annotate?.pinyinScale ?? 0.53;
    for (const w of tooTall) {
      w.style.setProperty("--ct-hanzi", (baseH * 0.9) + "em");
      w.style.setProperty("--ct-pinyin", (baseP * 0.9) + "em");
    }
  } finally {
    state.isMutating = false;
  }

  console.debug(`[CT] annotated ${nodes.length} nodes`);
}

async function fetchPinyinMap(texts, fallback = null) {
  let pinyins = texts.slice();
  try {
    const resp = await sendMessageSafe({ type: "CT_ANNOTATE_BATCH", payload: { texts } });
    if (Array.isArray(resp?.pinyins)) pinyins = resp.pinyins;
  } catch { /* keep identity */ }
  return new Map(texts.map((t, i) => [t, pinyins[i] ?? (fallback === null ? t : fallback)]));
}

// ---- sentence-level English glosses ----
//
// Glosses use the user's configured provider only — no hardcoded cross-
// provider fallback. Sending page text to a service the user never selected
// is a privacy decision we don't get to make, and glosses are best-effort
// anyway (entries that come back untranslated are simply not shown).

async function fetchEnglishForSentences(sentenceKeys) {
  const uniq = Array.from(new Set(sentenceKeys.filter(Boolean)));
  if (!uniq.length) return new Map();

  const glosses = await requestEnglish(uniq);
  const map = new Map();
  uniq.forEach((k, i) => {
    const v = glosses[i] ?? "";
    // Discard non-answers (provider echoed the Chinese back on failure).
    map.set(k, /[A-Za-z]/.test(v) ? v : "");
  });
  return map;
}

async function requestEnglish(texts) {
  const resp = await sendMessageSafe({
    type: "CT_TRANSLATE_BATCH",
    payload: {
      texts,
      opts: {
        sourceLang: "zh",
        targetLang: "en",
        allowInPinyin: true,
        context: { url: location.href },
      },
    },
  });
  return Array.isArray(resp?.translations) ? resp.translations : texts;
}

// ---- styles ----

export function ensurePinyinStyles() {
  if (document.getElementById("ct-pinyin-styles")) return;

  const hanziScale = state.settings?.annotate?.hanziScale ?? 0.90;
  const pinyinScale = state.settings?.annotate?.pinyinScale ?? 0.53;
  const englishScale = pinyinScale * 0.8;

  const css = `
  .ct-ruby {
    ruby-position: under;
    ruby-align: center;
    white-space: normal;
    line-height: 1; /* prevent ruby from ballooning the line */
  }
  .ct-ruby rb, .ct-ruby rt { white-space: pre; }
  .ct-ruby rt { line-height: 1.1; color: #555; font-size: var(--ct-pinyin, ${pinyinScale}em); }
  .ct-ruby rb { font-size: var(--ct-hanzi, ${hanziScale}em); letter-spacing: 0.05em; }

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

  /* Keep wrappers in normal flow to avoid layout explosions */
  .ct-ruby-block {
    display: inline-block;
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

// BFCache-safe presence check for existing decorations.
export function hasPinyinDecorations(root = document) {
  return !!root.querySelector('[data-ct="ruby-block"], .ct-ruby');
}
