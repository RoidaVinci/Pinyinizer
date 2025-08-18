import { collectTextNodes } from "../dom/collect.js";

export function startMutationObserver(onTextNodes) {
  const mo = new MutationObserver((muts) => {
    const targets = [];
    for (const m of muts) {
      if (m.type === "childList") {
        m.addedNodes.forEach(n => {
          if (n.nodeType === 3) targets.push(n);
          else if (n.nodeType === 1) collectTextNodes(n).forEach(t => targets.push(t));
        });
      } else if (m.type === "characterData") {
        if (m.target?.nodeType === 3) targets.push(m.target);
      }
    }
    if (targets.length) onTextNodes(targets);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  return () => mo.disconnect();
}
