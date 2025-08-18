import { getPinyinMany, setPinyinMany } from "./storage/cache.js";

// Very small placeholder converter. In real usage this should be
// replaced by a proper library or API that converts Chinese text to
// Pinyin. For now we simply return the input string so the caching and
// messaging infrastructure can be exercised without external deps.
function toPinyin(str = "") {
  return str;
}

export async function pinyinBatch(texts = []) {
  const normalized = texts.map(t => t ?? "");
  const cached = await getPinyinMany(normalized);
  const missIdx = [];
  const misses = [];
  normalized.forEach((s, i) => {
    if (cached[i] == null) { missIdx.push(i); misses.push(s); }
  });
  if (misses.length) {
    const results = misses.map(toPinyin);
    const write = [];
    results.forEach((p, j) => {
      const i = missIdx[j];
      cached[i] = p;
      write.push([normalized[i], p]);
    });
    if (write.length) await setPinyinMany(write);
  }
  return cached;
}
