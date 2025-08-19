// Local offline pinyin via vendored pinyin-pro (ESM build).
// Returns ONE string per input, with syllables space-separated;
// annotateNodes() already splits on spaces and maps 1:1 to characters.

import { pinyin } from "../../../vendor/pinyin-pro/index.esm.js";

const HAN = /\p{Script=Han}/u;

export async function pinyinProLocal(texts) {
  const arr = Array.isArray(texts) ? texts.map(s => s ?? "") : [String(texts ?? "")];

  return arr.map(q => {
    if (!HAN.test(q)) return q;
    try {
      // tone marks, per-char tokens -> "ni3 hao3" (with marks, not numbers)
      // We ask for an array so we can enforce one syllable per Han character.
      const tokens = pinyin(q, {
        toneType: "mark",     // ā á ǎ à
        type: "array",        // one token per char (handles punctuation too)
        multiple: false,      // choose the most common reading for polyphones
        nonZh: "consecutive", // keep non-Han chunks grouped (we'll ignore later)
      });
      // Filter out empty artifacts and join by single space
      return tokens.filter(Boolean).join(" ");
    } catch (e) {
      console.warn("[CT:bg] pinyin_pro local error:", e?.message || e);
      return q;
    }
  });
}
