import { fastHash } from "../../common/hash.js";
import { getMany, setMany } from "../storage/cache.js";
import { pinyinGoogleFree } from "./providers/google_pinyin_free.js";
import { pinyinProLocal } from "./providers/pinyin_pro_local.js";

const PROVIDERS = {
  google_free: pinyinGoogleFree,
  pinyin_pro_local: pinyinProLocal,
};

export async function annotateBatch(texts, opts) {
  const {
    pinyinProvider = "pinyin_pro_local", 
    cacheSalt = 1,
  } = opts || {};

  const arr = Array.isArray(texts) ? texts.map(s => s ?? "") : [String(texts ?? "")];
  const keys = arr.map(s => fastHash(`mode=pinyin|${pinyinProvider}|${cacheSalt}|${s}`));
  const cached = await getMany(keys);

  const misses = [];
  const missIdx = [];
  arr.forEach((s, i) => { if (cached[i] == null) { missIdx.push(i); misses.push(s); } });
  if (!misses.length) return cached;

  const p = PROVIDERS[pinyinProvider] || pinyinGoogleFree;
  let missOut = [];
  try {
    missOut = await p(misses);
  } catch (e) {
    console.error("[CT:bg] pinyin provider error:", e?.message || e);
    missOut = misses.map(s => s);
  }

  const write = [];
  missOut.forEach((py, j) => {
    const i = missIdx[j];
    write.push([keys[i], py]);
    cached[i] = py;
  });
  if (write.length) await setMany(write);
  return cached;
}
