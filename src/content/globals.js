// Shared globals & tiny utils used by other content files

// Regex for Han script
const HAN_RE = /\p{Script=Han}+/gu;

// Single-instance guard
const __CT_HTML__ = document.documentElement;
const __CT_ALREADY__ = __CT_HTML__.getAttribute("data-ct-cs") === "1";
if (!__CT_ALREADY__) {
  __CT_HTML__.setAttribute("data-ct-cs", "1");
}

// Filters (kept here so both modes share them)
const EXCLUDE_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT"]);
const EXCLUDE_SELECTOR = "pre, code, textarea, input, select, option, [contenteditable]";

// Mutable runtime state
let TOUCHED = new WeakSet();
const ORIGINALS = new Map(); // Map<TextNode, { text, parent, nextSibling, wrapper }>
let currentSettings;
let currentLangs = { source: "auto", target: "es" };
let disconnectMo;
let IS_MUTATING = false;

// Tiny timing helpers
function raf() { return new Promise(r => requestAnimationFrame(r)); }
async function raf2() { await raf(); await raf(); }
