// Local LLM provider — any OpenAI-compatible chat completions server.
//
// Works out of the box with:
//   * Ollama        (http://127.0.0.1:11434)  — `ollama pull qwen2.5:1.5b-instruct`
//   * LM Studio     (http://127.0.0.1:1234)
//   * llama.cpp     (`llama-server`, http://127.0.0.1:8080)
//
// Fully private: page text goes only to your own machine. Note for Ollama:
// extensions have a chrome-extension:// origin, so start it with
//   OLLAMA_ORIGINS="chrome-extension://*" ollama serve
//
// Strategy: send small JSON-array batches at temperature 0 and require a JSON
// array back; if the model breaks the contract, retry item-by-item with a
// plain-text prompt.

import { chunkByBudget, fetchWithTimeout } from "../../../common/utils.js";

const TIMEOUT_MS = 120000; // small local models can be slow on first load

export async function translateLocalLLM(texts, { sourceLang = "auto", targetLang = "en", config = {} }) {
  const baseUrl = (config.baseUrl || "http://127.0.0.1:11434").replace(/\/+$/, "");
  const model = config.model || "qwen2.5:1.5b-instruct";

  const inputs = texts.map(s => String(s ?? ""));
  const out = new Array(inputs.length);

  // Small batches keep the context tiny so 1–3B models stay fast and accurate.
  const batches = chunkByBudget(inputs, { maxItems: 8, maxChars: 1200 });

  // Sequential: it's the user's own machine; parallel requests just thrash it.
  // Errors propagate (provider contract) — swallowing them here would let the
  // orchestrator cache untranslated text as if it were a real translation.
  for (const { start, slice } of batches) {
    let results = await tryBatch(baseUrl, model, slice, sourceLang, targetLang);
    if (!results) {
      results = [];
      for (const item of slice) {
        results.push(await trySingle(baseUrl, model, item, sourceLang, targetLang));
      }
    }
    results.forEach((t, i) => { out[start + i] = t; });
  }
  return out;
}

// Returns the translated array, or null when the model broke the JSON
// contract (caller falls back to per-item). Network/server errors propagate.
async function tryBatch(baseUrl, model, slice, sourceLang, targetLang) {
  const system =
    `You are a translation engine. Translate every string in the user's JSON array ` +
    `${sourceLang === "auto" ? "" : `from "${sourceLang}" `}into "${targetLang}". ` +
    `Reply with ONLY a JSON array of the translated strings — same length, same order. ` +
    `Keep numbers, URLs, and placeholders like {{DNT:...}} unchanged. No commentary.`;
  const content = await chat(baseUrl, model, system, JSON.stringify(slice));
  const arr = parseJsonArray(content);
  if (Array.isArray(arr) && arr.length === slice.length && arr.every(x => typeof x === "string")) {
    return arr;
  }
  return null;
}

async function trySingle(baseUrl, model, text, sourceLang, targetLang) {
  if (!text.trim()) return text;
  const system =
    `Translate the user's text ${sourceLang === "auto" ? "" : `from "${sourceLang}" `}` +
    `into "${targetLang}". Reply with ONLY the translation, nothing else.`;
  const content = await chat(baseUrl, model, system, text);
  return content.trim() || text;
}

async function chat(baseUrl, model, system, user) {
  const res = await fetchWithTimeout(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  }, TIMEOUT_MS);
  if (!res.ok) throw new Error(`local LLM HTTP ${res.status}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("local LLM returned no content");
  return content;
}

// Tolerates markdown code fences and prose around the array.
export function parseJsonArray(content) {
  let s = String(content ?? "").trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();
  const startIdx = s.indexOf("[");
  const endIdx = s.lastIndexOf("]");
  if (startIdx === -1 || endIdx <= startIdx) return null;
  try {
    return JSON.parse(s.slice(startIdx, endIdx + 1));
  } catch {
    return null;
  }
}
