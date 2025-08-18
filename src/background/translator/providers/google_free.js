// Unofficial Google Translate (no key), per-item requests for reliability.

const BASE = "https://translate.googleapis.com/translate_a/single";
const CONCURRENCY = 4;        // be polite
const RETRIES = 2;
const TIMEOUT_MS = 6000;

export async function translateGoogleFree(texts, { sourceLang = "auto", targetLang = "en" }) {
  const arr = Array.isArray(texts) ? texts.map(s => s ?? "") : [String(texts ?? "")];

  const out = new Array(arr.length);
  let i = 0;

  async function worker() {
    while (i < arr.length) {
      const idx = i++;
      const q = arr[idx];
      out[idx] = await translateOne(q, sourceLang, targetLang);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, arr.length) }, worker));
  return out;
}

async function translateOne(q, sl, tl) {
  const url = `${BASE}?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(q)}`;

  let lastErr;
  for (let k = 0; k <= RETRIES; k++) {
    try {
      const res = await fetchWithTimeout(url, { method: "GET" }, TIMEOUT_MS);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Shape: [[ [translated, original, ...] , ... ], null, detectedSL, ...]
      const segments = Array.isArray(data) && Array.isArray(data[0]) ? data[0] : [];
      const translated = segments.map(s => (Array.isArray(s) ? String(s[0] ?? "") : "")).join("");
      return translated || q; // identity if empty
    } catch (e) {
      lastErr = e;
      await delay(200 * (k + 1));
    }
  }
  console.warn("[CT:bg] google_free error:", lastErr?.message || lastErr);
  return q; // identity on hard failure
}

async function fetchWithTimeout(url, init, ms) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(id); }
}
const delay = (ms) => new Promise(r => setTimeout(r, ms));
