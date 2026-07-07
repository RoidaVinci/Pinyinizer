# Clean Translate (MV3)

Chrome extension that translates web pages **in place** (text nodes are
replaced, layout is preserved) or annotates Chinese text with **pinyin ruby**
— useful both for everyday reading and for learning Chinese.

## Install (developer mode)

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this folder

No build step: the extension runs straight from the repo.

## Features

- **Translate mode** — replaces text nodes in place; handles SPAs and
  dynamically inserted content via a debounced MutationObserver; one-click undo
  restores the original page exactly.
- **Pinyin mode** — wraps Han text in `<ruby>` with per-character pinyin and
  optional per-sentence English glosses.
- **Live captions (experimental)** — translates `<video>` subtitle cues
  (TextTracks) in real time. First milestone of the
  [real-time translation roadmap](docs/ROADMAP.md).
- **Pluggable providers** with per-provider config, caching, and a glossary
  (do-not-translate terms + forced replacements).

## Translation providers

Configure in **Options**. Each provider has a **Test** button so you can
verify credentials before saving.

| Provider | Setup | Notes |
| --- | --- | --- |
| Google Translate (free) | none | Unofficial endpoint; zero setup, may throttle. Blocked in mainland China. |
| Google Cloud Translation | API key | Official v2 API. Reliable, ToS-compliant. |
| Baidu Fanyi 百度翻译 | App ID + key from [api.fanyi.baidu.com](https://api.fanyi.baidu.com) | Works from mainland China. Free tier ≈1 QPS. |
| Youdao 有道智云 | App key + secret from [ai.youdao.com](https://ai.youdao.com) | Works from mainland China. |
| **Local LLM** | Ollama / LM Studio / llama.cpp | **Fully private** — nothing leaves your machine. See below. |
| NLLB local server | Self-hosted FastAPI + `facebook/nllb-200` | Offline; faster than an LLM for pure translation. |
| LibreTranslate | endpoint (+ optional key) | Open-source API, self-hosted or public instance. |

### Private local translation (minimal setup)

The `Local LLM` provider speaks the OpenAI chat-completions protocol, so any
local server works. The fastest path is [Ollama](https://ollama.com):

```bash
ollama pull qwen2.5:1.5b-instruct        # ~1 GB, good multilingual quality
OLLAMA_ORIGINS="chrome-extension://*" ollama serve
```

Then in Options pick **Local LLM** (defaults: `http://127.0.0.1:11434`,
`qwen2.5:1.5b-instruct`) and hit **Test**. The `OLLAMA_ORIGINS` variable is
required because extensions call from a `chrome-extension://` origin.

LM Studio (`http://127.0.0.1:1234`) and `llama-server`
(`http://127.0.0.1:8080`) work the same way — just change the base URL.

## Development

```bash
node --test tests/*.test.js     # unit tests (pure logic: signing, chunking, glossary…)
bash scripts/check-syntax.sh    # parse-check every first-party JS file
```

- Architecture and message protocol: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Real-time translation plan (lectures, videos, subtitles): [docs/ROADMAP.md](docs/ROADMAP.md)

## Privacy

- Cloud providers receive the page text you translate — pick the **Local LLM**
  or **NLLB** provider for fully-offline translation.
- The translation cache lives in `chrome.storage.session` (RAM-backed,
  cleared when the browser closes); page text is never written to disk.
- API keys are stored in `chrome.storage.local` on your machine only.
