import { pinyinBatch } from "../../pinyin.js";

// Provider that delegates character conversion to the shared pinyin converter.
// It returns an array of objects: { characters, pinyin }.
export async function translatePinyin(texts) {
  const arr = Array.isArray(texts) ? texts : [String(texts ?? "")];
  const pinyinArr = await pinyinBatch(arr);
  return arr.map((str, i) => ({ characters: str, pinyin: pinyinArr[i] }));
}
