// Pure text helpers for pinyin mode — no DOM, no chrome.* (unit-testable).

export const HAN_RE = /\p{Script=Han}+/gu;

// If the page already provides an English gloss right after a Han run —
// e.g. 北京 (Beijing) — consume it so we don't duplicate it. Returns the
// number of characters consumed after `pos`, or 0.
export function consumeAsciiParenSuffix(full, pos) {
  const slice = full.slice(pos);
  const m = /^[\s]*([(（])([^)）]{0,120})([)）])/.exec(slice);
  if (!m) return 0;
  const inside = m[2].trim();
  if (!inside) return 0;
  const hasHan = /\p{Script=Han}/u.test(inside);
  const hasLatin = /[A-Za-z]/.test(inside);
  return (hasLatin && !hasHan) ? m[0].length : 0;
}

// Same idea for unparenthesized Latin suffixes: 北京 — Beijing
export function consumePlainLatinSuffix(full, pos) {
  const slice = full.slice(pos);
  const m = /^[\s]*[-–—:·：]?\s*([A-Za-z][A-Za-z0-9\s'’\-,.:;/]{0,160})/.exec(slice);
  if (!m) return 0;
  const chunk = (m[0] || "").trim();
  if (!chunk) return 0;
  if (/\p{Script=Han}/u.test(chunk)) return 0;
  if (!/[A-Za-z]/.test(chunk)) return 0;
  return m[0].length;
}

export function normalizePinyin(str) {
  return String(str || "")
    .replace(/[()（），,.;:·]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Split a pinyin phrase into syllable tokens. Only trusted when the token
// count matches the character count (see syllabifyOrCharLookup).
export function splitPinyinSyllables(pinyinStr) {
  const s = normalizePinyin(pinyinStr);
  if (!s) return [];
  return s
    .split(/[\s’']+/)
    .map(t => t.replace(/[^a-zA-ZāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüÜĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙ]+/g, ""))
    .filter(Boolean);
}

// One pinyin syllable per character: syllabify the phrase if it lines up,
// otherwise fall back to the per-character map (guaranteed 1:1).
export function syllabifyOrCharLookup(chars, pyPhrase, charPinyinMap) {
  const bySplit = splitPinyinSyllables(pyPhrase);
  if (bySplit.length === chars.length) return bySplit;
  return chars.map(ch => charPinyinMap.get(ch) || "");
}

// ---- tone accents (accents-only mode) ----

// Standalone (spacing) tone marks, indexed by tone number. The neutral tone
// gets nothing at all — an empty rt keeps the character's baseline aligned
// with its neighbours instead of nudging it around.
export const TONE_MARKS = ["", "ˉ", "ˊ", "ˇ", "ˋ"]; // ˉ ˊ ˇ ˋ

// Combining diacritics as produced by NFD decomposition of ā/á/ǎ/à (and their
// ü variants, whose diaeresis we skip over).
const COMBINING_TONES = {
  "\u0304": 1, // macron
  "\u0301": 2, // acute
  "\u030C": 3, // caron
  "\u0300": 4, // grave
};

// Tone number (1–4, or 0 for neutral/unknown) of a single pinyin syllable.
// Accepts both marked ("hǎo") and numbered ("hao3") styles, since providers
// differ and per-character lookups are passed through unmodified.
export function toneOf(syllable) {
  const s = String(syllable || "");
  if (!s) return 0;

  for (const ch of s.normalize("NFD")) {
    const tone = COMBINING_TONES[ch];
    if (tone) return tone;
  }

  const m = /([1-5])\s*$/.exec(s.trim());
  if (m) {
    const n = +m[1];
    return n >= 1 && n <= 4 ? n : 0;
  }
  return 0;
}

// The mark to render under a character: "ˉ" | "ˊ" | "ˇ" | "ˋ" | "".
export function toneMarkOf(syllable) {
  return TONE_MARKS[toneOf(syllable)] || "";
}
