export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Split `texts` into batches capped by item count AND total character budget.
// Returns [{ start, slice }]; a single oversized item still gets its own batch.
export function chunkByBudget(texts, { maxItems = 25, maxChars = 4000 } = {}) {
  const out = [];
  let start = 0;
  while (start < texts.length) {
    let end = start;
    let chars = 0;
    while (
      end < texts.length &&
      end - start < maxItems &&
      (end === start || chars + texts[end].length <= maxChars)
    ) {
      chars += texts[end].length;
      end++;
    }
    out.push({ start, slice: texts.slice(start, end) });
    start = end;
  }
  return out;
}

// Run `worker(item, index)` over items with bounded concurrency.
// Resolves to results in input order; individual failures reject the whole pool
// unless the worker catches its own errors.
export async function mapPool(items, concurrency, worker) {
  const out = new Array(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const i = next++;
      out[i] = await worker(items[i], i);
    }
  }
  const lanes = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: lanes }, lane));
  return out;
}

export async function fetchWithTimeout(url, init = {}, ms = 10000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

// fetch JSON with retries + exponential backoff. Throws the last error.
export async function fetchJson(url, init = {}, { retries = 2, timeoutMs = 10000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, init, timeoutMs);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(200 * (attempt + 1));
    }
  }
  throw lastErr;
}
