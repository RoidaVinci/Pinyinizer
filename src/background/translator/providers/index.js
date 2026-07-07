// id -> implementation map. Metadata lives in ../registry.js.
//
// Every provider implements:
//   translate(texts: string[], { sourceLang, targetLang, config, context }) -> Promise<string[]>
// and throws on failure (the orchestrator in ../index.js handles fallback).

import { translateMock } from "./mock.js";
import { translateGoogleFree } from "./google_free.js";
import { translateGoogleCloud } from "./google_cloud.js";
import { translateBaidu } from "./baidu.js";
import { translateYoudao } from "./youdao.js";
import { translateLibre } from "./libretranslate.js";
import { translateLocalLLM } from "./local_llm.js";
import { translateNLLB } from "./nllb.js";

export const PROVIDERS = {
  mock: translateMock,
  google_free: translateGoogleFree,
  google_cloud: translateGoogleCloud,
  baidu: translateBaidu,
  youdao: translateYoudao,
  libretranslate: translateLibre,
  local_llm: translateLocalLLM,
  nllb: translateNLLB,
};
