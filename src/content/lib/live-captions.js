// EXPERIMENTAL — live subtitle translation for <video> elements.
//
// First step of the real-time roadmap (see docs/ROADMAP.md): videos that ship
// subtitles as TextTracks (<track src="...vtt">, HLS/DASH players, etc.) get
// their cues translated in place. When a track loads we prefetch ALL its cues
// in one batch, so by the time a cue is shown its translation is already
// applied — zero visible latency after the first seconds.
//
// Lifecycle: every listener is registered with one AbortController's signal,
// so stopLiveCaptions() detaches everything at once and a later start
// re-wires cleanly (no stacked listeners, no stale skip-sets). Cue originals
// live in a WeakMap so finished tracks and their cues stay collectable.
//
// Known limits (documented, deliberate for v1):
//  * Players that draw captions into the DOM (e.g. YouTube) are handled by
//    the normal MutationObserver path, not here.
//  * VTT styling tags inside cues (<i>, <c>) are sent as-is; simple tracks
//    are plain text and translate cleanly.

import { chunk } from "../../common/utils.js";
import { preferredTarget } from "./state.js";
import { translateRequest } from "./messaging.js";

const BATCH = 60;

const cueOriginals = new WeakMap(); // VTTCue -> original text (collectable)

let controller = null;        // owns every listener of the current session
let wiredTracks = new Set();  // tracks we translated (iterated for revert)
let prefetchedTracks = new WeakSet();

export function startLiveCaptions() {
  if (controller) return;
  controller = new AbortController();

  document.querySelectorAll("video").forEach(wireVideo);

  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      m.addedNodes.forEach((n) => {
        if (n.nodeType !== Node.ELEMENT_NODE) return;
        if (n.tagName === "VIDEO") wireVideo(n);
        else n.querySelectorAll?.("video").forEach(wireVideo);
      });
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  controller.signal.addEventListener("abort", () => mo.disconnect());
}

export function stopLiveCaptions() {
  if (!controller) return;
  controller.abort(); // detaches every cuechange/addtrack listener + the MO
  controller = null;

  // Restore original cue text on the tracks we touched.
  for (const track of wiredTracks) {
    const cues = track.cues ? Array.from(track.cues) : [];
    for (const cue of cues) {
      const original = cueOriginals.get(cue);
      if (typeof original === "string") {
        try { cue.text = original; } catch { /* read-only implementation */ }
        cueOriginals.delete(cue);
      }
    }
  }
  wiredTracks = new Set();
  prefetchedTracks = new WeakSet();
}

function wireVideo(video) {
  const tracks = video.textTracks;
  if (!tracks || !controller) return;
  const { signal } = controller;
  for (let i = 0; i < tracks.length; i++) wireTrack(tracks[i]);
  tracks.addEventListener?.("addtrack", (e) => wireTrack(e.track), { signal });
}

function wireTrack(track) {
  if (!track || !controller || wiredTracks.has(track)) return;
  if (track.kind !== "subtitles" && track.kind !== "captions") return;
  wiredTracks.add(track);

  // Cues often aren't loaded until the track is shown; cuechange is the
  // reliable moment to (a) prefetch everything and (b) catch stragglers.
  track.addEventListener("cuechange", () => {
    if (track.mode !== "showing") return;
    prefetchTrack(track);
    translateCues(Array.from(track.activeCues || []));
  }, { signal: controller.signal });

  if (track.mode === "showing" && track.cues?.length) prefetchTrack(track);
}

async function prefetchTrack(track) {
  if (prefetchedTracks.has(track)) return;
  const cues = track.cues ? Array.from(track.cues) : [];
  if (!cues.length) return;
  prefetchedTracks.add(track);

  for (const batch of chunk(cues, BATCH)) {
    if (!controller) return; // stopped mid-prefetch
    await translateCues(batch);
  }
}

async function translateCues(cues) {
  const fresh = cues.filter(c => typeof c.text === "string" && c.text.trim() && !cueOriginals.has(c));
  if (!fresh.length) return;

  fresh.forEach(c => cueOriginals.set(c, c.text));
  const translations = await translateRequest(fresh.map(c => c.text), {
    sourceLang: "auto",
    targetLang: preferredTarget(),
    context: { url: location.href, kind: "live-captions" },
  });
  if (!controller) return; // stopped while the request was in flight

  fresh.forEach((cue, i) => {
    const t = translations[i];
    if (typeof t === "string" && t) {
      try { cue.text = t; } catch { /* read-only cue implementation */ }
    }
  });
}
