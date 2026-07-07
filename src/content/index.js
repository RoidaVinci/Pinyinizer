// Content-script bootstrap.
//
// MV3 content scripts can't be ES modules, so this classic script
// dynamic-imports the real entry point (which CAN use imports). The modules
// still run in this isolated world with full DOM access; they just need to be
// listed under web_accessible_resources in the manifest.
(async () => {
  // Guards manifest injection + popup re-injection. Set optimistically and
  // rolled back on failure so a later injection can retry a failed load.
  if (window.__CT_LOADED__) return;
  window.__CT_LOADED__ = true;

  try {
    await import(chrome.runtime.getURL("src/content/lib/main.js"));
  } catch (e) {
    window.__CT_LOADED__ = false;
    console.error("[CT] failed to load content modules", e);
  }
})();
