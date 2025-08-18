// providers/nllb.js
// Local NLLB provider (facebook/nllb-200-distilled-600M) via your FastAPI server.
// Mirrors the shape of translateHTTP: accepts string|array, returns array of translations.

const ENDPOINT = "http://127.0.0.1:8899/translate"; // or "http://nllb.local:8899/translate"

// Map UI langs -> NLLB internal tags
function mapLang(ui) {
  switch ((ui || "").toLowerCase()) {
    case "en": return "eng_Latn";
    case "es": return "spa_Latn";
    case "zh": return "zho_Hans"; // Simplified
    default: throw new Error(`Unsupported language: ${ui}`);
  }
}

// Very light source guesser for "auto": detect Han script -> zh, else en.
function guessSource(arr, targetLang) {
  const han = /\p{Script=Han}/u;
  const hasHan = arr.some(s => typeof s === "string" && han.test(s));
  if (hasHan) return "zh";
  // if target is 'zh', assume english/spanish source → prefer 'en'
  return targetLang === "zh" ? "en" : "en";
}

export async function translateNLLB(texts, { sourceLang = "auto", targetLang = "es" } = {}) {
  const arr = Array.isArray(texts) ? texts : [texts];

  // limit to our supported set
  if (!["en", "es", "zh"].includes((targetLang || "").toLowerCase())) {
    throw new Error(`NLLB provider only supports en/es/zh target, got: ${targetLang}`);
  }

  const srcUi = sourceLang === "auto" ? guessSource(arr, targetLang) : sourceLang;
  if (!["en", "es", "zh"].includes((srcUi || "").toLowerCase())) {
    throw new Error(`NLLB provider only supports en/es/zh source, got: ${sourceLang}`);
  }

  const payload = {
    text: arr,                        // our FastAPI accepts string or list; we always send list
    source: mapLang(srcUi),
    target: mapLang(targetLang)
  };

  try {
    const resp = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();

    // Server may return {translations: [...] } or {translation: "..."}
    if (Array.isArray(data.translations)) return data.translations;
    if (typeof data.translation === "string") return [data.translation];

    // Unexpected shape → fall back
    return arr;
  } catch (e) {
    console.error("[CT:nllb] local server error:", e);
    return arr; // graceful fallback: return original texts
  }
}
