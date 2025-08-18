// Unofficial Google Translate (no key) — fast batched + safe fallback to per-item.
// Endpoint: https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=..&tl=..&q=...

const BASE = "https://translate.googleapis.com/translate_a/single";
const BATCH_SIZE = 25;        // number of inputs per HTTP request
const CONCURRENCY = 6;        // parallel requests (be polite to avoid throttling)
const RETRIES = 2;            // retries per request
const TIMEOUT_MS = 7000;      // request timeout
const MAX_URL_LEN = 8000;     // safety for long pages

export async function translateGoogleFree(texts, { sourceLang = "auto", targetLang = "en" }) {
  const inputs = Array.isArray(texts) ? texts.map(s => s ?? "") : [String(texts ?? "")];

  // Split into size-limited batches, *then* run batches in parallel
  const batches = chunkByCountAndUrl(inputs, BATCH_SIZE, MAX_URL_LEN, sourceLang, targetLang);

  const out = new Array(inputs.length);
  let i = 0;
  async function worker() {
    while (i < batches.length) {
      const idx = i++;
      const { start, end, slice } = batches[idx];
      const res = await translateBatchSafe(slice, sourceLang, targetLang);
      for (let k = 0; k < res.length; k++) out[start + k] = res[k];
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
  return out;
}

// ---- batching with safe fallback ----
async function translateBatchSafe(arr, sl, tl) {
  // Try single batched request
  try {
    const res = await requestBatched(arr, sl, tl);
    const mapped = mapResponse(arr, res);
    if (mapped) return mapped;
    // If mapping failed, fall back to per-item for this batch
  } catch (_) {
    // ignore and fall back below
  }
  return await translatePerItem(arr, sl, tl);
}

// ---- HTTP requests ----
async function requestBatched(arr, sl, tl) {
  // Build URL with multiple q= parameters
  const qs = arr.map(q => `q=${encodeURIComponent(q)}`).join("&");
  const url = `${BASE}?client=gtx&dt=t&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&${qs}`;

  let lastErr;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(url, { method: "GET" }, TIMEOUT_MS);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data;
    } catch (e) {
      lastErr = e;
      await delay(200 * (attempt + 1));
    }
  }
  throw lastErr;
}

async function translatePerItem(arr, sl, tl) {
  const out = new Array(arr.length);
  let i = 0;
  async function worker() {
    while (i < arr.length) {
      const idx = i++;
      out[idx] = await requestSingle(arr[idx], sl, tl);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, arr.length) }, worker));
  return out;
}
async function requestSingle(q, sl, tl) {
  const url = `${BASE}?client=gtx&dt=t&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&q=${encodeURIComponent(q)}`;
  let lastErr;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(url, { method: "GET" }, TIMEOUT_MS);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return joinSegments(data) || q;
    } catch (e) {
      lastErr = e;
      await delay(200 * (attempt + 1));
    }
  }
  console.warn("[CT:bg] google_free single error:", lastErr?.message || lastErr);
  return q;
}

// ---- response mapping ----
// google gtx returns: [ [ [translated, original, ...], ... ], null, detectedSl, ... ]
// For multiple q=, all segments are flattened; we rebuild per input by walking "original".
function mapResponse(arr, json) {
  const segs = extractSegments(json);
  if (!segs.length) return null;

  const outs = [];
  let cursor = 0;
  for (const input of arr) {
    const targetLen = input.length;
    let builtOrig = "";
    let builtTrans = "";
    while (cursor < segs.length && builtOrig.length < targetLen) {
      builtOrig += segs[cursor].orig;
      builtTrans += segs[cursor].tr;
      cursor++;
    }
    // Strict check: must match exactly (or ignoring trivial whitespace deltas)
    if (!eqLoose(builtOrig, input)) return null;
    outs.push(builtTrans || input);
  }
  return outs.length === arr.length ? outs : null;
}

function extractSegments(json) {
  const root = Array.isArray(json) ? json[0] : null;
  if (!Array.isArray(root)) return [];
  const segs = [];
  for (const s of root) {
    if (Array.isArray(s) && typeof s[0] === "string") {
      segs.push({ tr: s[0] ?? "", orig: String(s[1] ?? "") });
    }
  }
  return segs;
}

function joinSegments(json) {
  const segs = extractSegments(json);
  return segs.map(s => s.tr).join("");
}

// ---- batching helpers ----
function chunkByCountAndUrl(inputs, batchSize, maxUrlLen, sl, tl) {
  const out = [];
  let start = 0;
  while (start < inputs.length) {
    let end = Math.min(start + batchSize, inputs.length);
    // shrink if URL too long
    while (end > start) {
      const urlLen = estimateUrlLen(inputs.slice(start, end), sl, tl);
      if (urlLen <= maxUrlLen) break;
      end--;
    }
    if (end === start) end = start + 1; // always at least one
    out.push({ start, end, slice: inputs.slice(start, end) });
    start = end;
  }
  return out;
}
function estimateUrlLen(arr, sl, tl) {
  // rough upper bound including all fixed params
  const baseLen = BASE.length + 100 + sl.length + tl.length;
  const qLen = arr.reduce((n, s) => n + 3 + encodeURIComponent(s).length, 0); // &q=
  return baseLen + qLen;
}

// ---- small utils ----
function eqLoose(a, b) {
  // ignore minor whitespace diffs
  const na = String(a).replace(/\s+/g, " ").trim();
  const nb = String(b).replace(/\s+/g, " ").trim();
  return na === nb;
}

async function fetchWithTimeout(url, init, ms) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(id); }
}
const delay = (ms) => new Promise(r => setTimeout(r, ms));
