// very simple in-memory do-not-translate & replacements; extend as needed
export function applyGlossary(texts, { dnt = [], replace = [] } = {}) {
  return texts.map(t => {
    let s = t;
    for (const [needle, subst] of replace) {
      s = s.replaceAll(needle, subst);
    }
    // mask DNT tokens with markers (so provider won’t change them)
    for (const token of dnt) {
      const marker = `{{DNT:${token}}}`;
      s = s.replaceAll(token, marker);
    }
    return s;
  });
}

export function unmaskDNT(str) {
  return str.replaceAll(/\{\{DNT:(.+?)\}\}/g, "$1");
}
