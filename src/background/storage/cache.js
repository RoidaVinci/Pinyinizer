// Two-tier translation cache.
//
// MV3 service workers are killed after ~30s of inactivity, so a plain
// in-memory Map loses everything constantly. We keep a Map as a fast front
// and persist entries to chrome.storage.session (survives worker restarts,
// cleared when the browser closes — deliberately not storage.local so page
// text never hits disk).
//
// Session entries are stored as { v, t } envelopes: chrome.storage gives no
// key-order guarantees, so eviction needs an explicit write timestamp.

const PREFIX = "ctc:"; // namespace cache keys within session storage
const MAX_ENTRIES = 8000;
const TRIM_TO = 6000;

const mem = new Map();
const session = globalThis.chrome?.storage?.session ?? null;

// Approximate persisted-entry count so trims don't require a full-store scan
// on every write. Seeded once per worker lifetime.
let approxCount = null;

export async function getMany(keys) {
  const out = new Array(keys.length);
  const missing = [];
  const missingIdx = [];

  keys.forEach((k, i) => {
    if (mem.has(k)) out[i] = mem.get(k);
    else { missing.push(PREFIX + k); missingIdx.push(i); }
  });

  if (missing.length && session) {
    try {
      const found = await session.get(missing);
      missingIdx.forEach((i, j) => {
        const entry = found[missing[j]];
        if (entry?.v !== undefined) {
          out[i] = entry.v;
          mem.set(keys[i], entry.v);
        }
      });
    } catch { /* session storage unavailable — memory tier still works */ }
  }
  return out;
}

export async function setMany(entries) {
  const now = Date.now();
  const record = {};
  for (const [k, v] of entries) {
    mem.set(k, v);
    record[PREFIX + k] = { v, t: now };
  }
  if (session) {
    try {
      if (approxCount === null) await seedCount();
      await session.set(record);
      approxCount += entries.length; // over-counts overwrites; only trims early
      if (approxCount > MAX_ENTRIES) await trim();
    } catch { /* quota or availability — memory tier still works */ }
  }
}

export async function clearCache() {
  mem.clear();
  approxCount = 0;
  if (!session) return;
  try {
    const all = await session.get(null);
    const ours = Object.keys(all).filter(k => k.startsWith(PREFIX));
    if (ours.length) await session.remove(ours);
  } catch { /* ignore */ }
}

async function seedCount() {
  const all = await session.get(null);
  approxCount = Object.keys(all).filter(k => k.startsWith(PREFIX)).length;
}

// Evict the oldest-written entries down to TRIM_TO, by timestamp.
async function trim() {
  const all = await session.get(null);
  const ours = Object.entries(all).filter(([k]) => k.startsWith(PREFIX));
  approxCount = ours.length;
  if (ours.length <= MAX_ENTRIES) return;

  ours.sort((a, b) => (a[1]?.t ?? 0) - (b[1]?.t ?? 0));
  const drop = ours.slice(0, ours.length - TRIM_TO).map(([k]) => k);
  await session.remove(drop);
  approxCount -= drop.length;
  for (const k of drop) mem.delete(k.slice(PREFIX.length));
}
