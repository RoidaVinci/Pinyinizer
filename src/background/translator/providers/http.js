// providers/http.js
export async function translateHTTP(texts, { sourceLang = "auto", targetLang = "es" }) {
  const arr = Array.isArray(texts) ? texts : [texts];

  // Public instance (can rotate if one is slow)
  const endpoint = "https://libretranslate.de/translate";

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      q: arr,
      source: sourceLang === "auto" ? "auto" : sourceLang,
      target: targetLang,
      format: "text"
    })
  });

  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();

  // LibreTranslate returns either [{translatedText},...] or {translatedText} for single string
  if (Array.isArray(data)) {
    return data.map(d => d.translatedText);
  } else {
    return [data.translatedText];
  }
}
