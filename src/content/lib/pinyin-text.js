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
