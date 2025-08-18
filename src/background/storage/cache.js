// Translation cache (hashed keys) and pinyin cache (raw Chinese text).
const mem = new Map();
const pinyinMem = new Map();

export async function getMany(keys) {
  return keys.map(k => mem.has(k) ? mem.get(k) : undefined);
}

export async function setMany(entries) {
  for (const [k, v] of entries) mem.set(k, v);
}

// ----- pinyin cache helpers -----
export async function getPinyinMany(keys) {
  return keys.map(k => pinyinMem.has(k) ? pinyinMem.get(k) : undefined);
}

export async function setPinyinMany(entries) {
  for (const [k, v] of entries) pinyinMem.set(k, v);
}

export async function clearCache() {
  mem.clear();
  pinyinMem.clear();
}
