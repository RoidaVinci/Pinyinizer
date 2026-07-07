// Translation provider registry — METADATA ONLY.
//
// This module is imported by the service worker, the options page, and the
// settings module, so it must stay free of implementations and side effects.
// The id -> function map lives in ./providers/index.js.
//
// configFields drive both the options UI (each provider's settings form is
// rendered from this list) and the settings defaults (storage/settings.js
// derives DEFAULTS.providerConfig from the `default` values), so a field's
// default lives in exactly one place.

export const PROVIDER_META = [
  {
    id: "google_free",
    label: "Google Translate (free, no key)",
    description:
      "Unofficial public endpoint. Zero setup, good quality, but unofficial " +
      "(may be rate-limited or break) and unreachable from mainland China.",
    configFields: [],
  },
  {
    id: "google_cloud",
    label: "Google Cloud Translation (API key)",
    description:
      "Official Google Cloud Translation v2 API. Reliable and ToS-compliant; " +
      "requires a Google Cloud project with the Translation API enabled.",
    configFields: [
      { key: "apiKey", label: "API key", type: "password", default: "", placeholder: "AIza..." },
    ],
  },
  {
    id: "baidu",
    label: "Baidu Fanyi 百度翻译 (works in China)",
    description:
      "Official Baidu Translate API — reachable from mainland China. Free tier " +
      "available; register at api.fanyi.baidu.com to get an App ID and key.",
    configFields: [
      { key: "appId", label: "App ID (appid)", type: "text", default: "", placeholder: "20240101..." },
      { key: "secretKey", label: "Secret key (密钥)", type: "password", default: "" },
    ],
  },
  {
    id: "youdao",
    label: "Youdao 有道智云 (works in China)",
    description:
      "Official Youdao AI Cloud translation API — reachable from mainland China. " +
      "Register at ai.youdao.com for an app key and secret.",
    configFields: [
      { key: "appKey", label: "App key (应用ID)", type: "text", default: "" },
      { key: "appSecret", label: "App secret (应用密钥)", type: "password", default: "" },
    ],
  },
  {
    id: "local_llm",
    label: "Local LLM (Ollama / LM Studio / llama.cpp)",
    description:
      "Fully private: talks to any OpenAI-compatible server on your machine. " +
      "Easiest setup is Ollama with a small model (e.g. qwen2.5:1.5b-instruct). " +
      "Nothing ever leaves your computer.",
    configFields: [
      { key: "baseUrl", label: "Base URL", type: "text", default: "http://127.0.0.1:11434" },
      { key: "model", label: "Model", type: "text", default: "qwen2.5:1.5b-instruct" },
    ],
  },
  {
    id: "nllb",
    label: "NLLB local server (offline)",
    description:
      "Dedicated local translation server running facebook/nllb-200 behind a " +
      "small HTTP API. Faster than an LLM for pure translation.",
    configFields: [
      { key: "endpoint", label: "Endpoint", type: "text", default: "http://127.0.0.1:8899/translate" },
    ],
  },
  {
    id: "libretranslate",
    label: "LibreTranslate (public or self-hosted)",
    description:
      "Open-source translation API. Point it at a self-hosted instance or a " +
      "public one (most public instances now require an API key).",
    configFields: [
      { key: "endpoint", label: "Endpoint", type: "text", default: "https://libretranslate.com" },
      { key: "apiKey", label: "API key (optional)", type: "password", default: "" },
    ],
  },
  {
    id: "mock",
    label: "Mock (development)",
    description: "Prefixes text with the target language. For development only.",
    configFields: [],
  },
];

export function providerMeta(id) {
  return PROVIDER_META.find(p => p.id === id) || null;
}

// { providerId: { fieldKey: defaultValue } } — consumed by storage/settings.js.
export function providerConfigDefaults() {
  const out = {};
  for (const meta of PROVIDER_META) {
    if (!meta.configFields.length) continue;
    out[meta.id] = {};
    for (const f of meta.configFields) out[meta.id][f.key] = f.default ?? "";
  }
  return out;
}
