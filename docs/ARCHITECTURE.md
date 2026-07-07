# Architecture

```
┌────────────────────────────── page (isolated world) ─────────────────────────────┐
│ src/content/index.js       classic bootstrap: dynamic-imports lib/main.js        │
│ src/content/lib/                                                                 │
│   main.js                  entry: settings → initial pass → observer → messages  │
│   state.js                 shared mutable state + undo records                   │
│   dom.js                   node filters, collection, replace/revert              │
│   observer.js              debounced MutationObserver                            │
│   translate-mode.js        in-place text replacement                             │
│   pinyin-mode.js           <ruby> annotation + English glosses                   │
│   pinyin-text.js           pure text helpers (unit-tested)                       │
│   live-captions.js         experimental TextTrack cue translation                │
└───────────────────────────────────┬──────────────────────────────────────────────┘
                                    │ chrome.runtime messages
┌───────────────────────────────────▼──────────────── service worker (MV3) ────────┐
│ src/background/                                                                  │
│   index.js                 entry (badge on install/startup)                      │
│   messaging.js             message router (protocol below)                       │
│   storage/settings.js      schema + defaults + deep-merge persistence            │
│   storage/cache.js         two-tier cache: Map + chrome.storage.session          │
│   glossary.js              DNT masking / replacements                            │
│   translator/                                                                    │
│     index.js               orchestrator: cache → glossary → provider → unmask    │
│     registry.js            provider METADATA (shared with the options page)      │
│     providers/…            one module per provider (uniform signature)           │
│   annotator/…              pinyin providers (vendored pinyin-pro / Google)       │
└──────────────────────────────────────────────────────────────────────────────────┘
```

## Why a dynamic-import bootstrap?

MV3 content scripts can't be ES modules. Instead of bundling (or duplicating
code into one giant IIFE, which is how the old `content/index.js` rotted), the
tiny classic script `content/index.js` does
`import(chrome.runtime.getURL("src/content/lib/main.js"))`. The modules run in
the same isolated world with full DOM access; they only need to be listed
under `web_accessible_resources`. Zero build tooling.

## Message protocol

| Type | Payload | Response |
| --- | --- | --- |
| `CT_TRANSLATE_BATCH` | `{ texts, opts }` | `{ translations }` |
| `CT_ANNOTATE_BATCH` | `{ texts }` | `{ pinyins }` |
| `CT_GET_SETTINGS` | — | settings object |
| `CT_SET_SETTINGS` | partial settings | `{ ok }` |
| `CT_CLEAR_CACHE` | — | `{ ok }` |
| `CT_TEST_PROVIDER` | `{ provider, targetLang }` | `{ ok, result \| error }` |
| `CT_APPLY_NOW` (popup → tab) | — | re-applies current settings |
| `CT_UNDO` (popup → tab) | — | restores the original page |

Every failure path degrades to **identity** (original text is returned) so a
broken provider never breaks a page.

## Providers

Uniform signature:

```js
translate(texts: string[], { sourceLang, targetLang, config, context }) -> Promise<string[]>
```

- Implementations live in `translator/providers/`, one file each, and **throw**
  on failure — fallback policy is the orchestrator's job, not theirs.
- `registry.js` holds metadata only (labels, descriptions, config field
  definitions) and is imported by the options page too, so adding a provider
  is: write the module, add it to `providers/index.js`, describe it in
  `registry.js`, add defaults in `storage/settings.js`. The options UI renders
  its config form automatically.
- Cache keys include `provider|sourceLang|targetLang|text`, so switching
  providers never serves stale results.

## Caching

MV3 service workers are killed after ~30s idle; a plain in-memory Map loses
everything constantly (this was a real bug). The cache is now two-tier:
Map (fast) in front of `chrome.storage.session` (survives worker restarts,
RAM-backed, cleared on browser exit — page text never touches disk).

## Testing

Pure logic (signing, chunking, glossary, pinyin syllabification, settings
merge) is separated from DOM/chrome code and unit-tested with `node --test`.
DOM behavior is exercised manually; a Puppeteer smoke test is the natural next
step (see ROADMAP).
