# Roadmap — real-time translation of lectures, videos and subtitles

The long-term goal: watch any lecture or video and read live translated
subtitles, regardless of whether the source has captions.

The problem splits into three independent capabilities, each shippable on its
own. Text you already have → translate faster than it displays. Audio →
transcribe first. Everything meets in one shared overlay + streaming pipeline.

## Phase 1 — subtitle translation (SHIPPED, experimental)

`src/content/lib/live-captions.js`, options → “Live captions”.

Videos that expose subtitles as **TextTracks** (`<track src=…>`, many HLS/DASH
players) get every cue batch-translated the moment the track loads, and cue
text is swapped in place — zero perceived latency, native rendering, undo on
teardown.

Next steps:
- **DOM-caption players** (YouTube draws captions into a div): detect known
  caption containers and translate them through a *fast path* that skips the
  50 ms debounce and uses cache-first lookup, so caption lines update in
  ~1 frame when repeated.
- Strip/restore inline VTT styling tags (`<i>`, `<c.color>`) around provider
  calls instead of sending them through.
- Per-site caption container selectors (YouTube, Bilibili, Vimeo, Coursera).

## Phase 2 — overlay renderer + streaming pipeline (foundation)

Shared infrastructure both later phases need:

- **Subtitle overlay**: a shadow-DOM component pinned over any `<video>` (or
  screen region for lectures) showing 1–2 lines with partial-result styling.
- **Streaming translation channel**: `chrome.runtime.connect` port (not
  one-shot messages) carrying `{segmentId, text, isFinal}` — partial segments
  update the overlay in place; final segments commit to cache.
- **Segmenter**: sentence-boundary + silence-based chunking so translations
  read as sentences, not word soup. Re-translate a growing partial segment,
  replace it on screen (the "rewriting subtitle" pattern used by all live
  translators).

## Phase 3 — live audio → text (ASR)

For content with **no subtitles at all** (live lectures, meetings, streams):

1. **Capture**: `chrome.tabCapture` (tab audio) from the extension; an
   **offscreen document** hosts the audio graph, since MV3 workers can't.
2. **ASR options**, same pattern as translation providers (registry + config):
   - *Local server (recommended first)*: stream 16 kHz PCM chunks over
     WebSocket to `whisper.cpp` / `faster-whisper` with a small streaming
     wrapper — same "minimal orchestration" philosophy as the Ollama provider:
     one binary, one port, fully private.
   - *In-browser*: `transformers.js` + WebGPU running whisper-tiny/base in the
     offscreen document — zero install, higher CPU. Feature-detect and offer
     both.
   - *Web Speech API*: free and built-in but cloud-backed and Chrome-gated;
     acceptable as a fallback only.
3. **Pipeline**: VAD (silence detection) → 3–5 s windows with 0.5 s overlap →
   ASR partials → segmenter → streaming translation → overlay. Latency budget
   ≈ 1.5–3 s end-to-end with a local whisper-base — comparable to human
   interpreters.

Permissions to add when this lands: `tabCapture`, `offscreen`.

## Engineering track (independent of features)

- **Puppeteer smoke test**: load the unpacked extension headless, translate a
  fixture page, assert text nodes changed and undo restores them (CI-able).
- **ESLint + CI**: GitHub Action running lint, syntax check, unit tests.
- **Store packaging**: `web_ext`-style zip script, listing assets, and a
  privacy policy (required for `<all_urls>` host permissions).
- **Options v2**: per-site enable/disable rules, import/export of settings,
  keyboard shortcut to toggle translation.
- **Popup**: quick provider switcher and a per-tab "translate once" action
  using `activeTab` instead of blanket `<all_urls>` injection.
