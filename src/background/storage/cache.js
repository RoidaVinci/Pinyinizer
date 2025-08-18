const mem = new Map();

export async function getMany(keys) {
  return keys.map(k => mem.has(k) ? mem.get(k) : undefined);
}
export async function setMany(entries) {
  for (const [k, v] of entries) mem.set(k, v);
}
export async function clearCache() {
  mem.clear();
}
