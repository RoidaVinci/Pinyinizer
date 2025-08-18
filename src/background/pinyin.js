import { getPinyinMany, setPinyinMany } from "./storage/cache.js";
import { convertToPinyin } from "./pinyinConverter.js";

// Convert a single string to Pinyin using the converter library.
// The converter handles unknown characters by returning them unchanged.
function toPinyin(str = "") {
  return convertToPinyin(str);
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
