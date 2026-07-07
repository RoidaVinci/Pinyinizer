export function fastHash(str) {
  let h = 0, i = 0, len = str.length|0;
  while (i < len) { h = (h<<5) - h + str.charCodeAt(i++) | 0; }
  return (h >>> 0).toString(36);
}

// Two independent 32-bit FNV-1a-style hashes concatenated (~64 bits).
// Cache keys need this: with a session-persistent cache of thousands of
// entries, 32-bit birthday collisions are likely enough that one page's
// translation could be served for another's text.
export function stableHash(str) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = (Math.imul(h2 ^ c, 0x5bd1e995) ^ (h2 >>> 13)) | 0;
  }
  return (h1 >>> 0).toString(36) + "-" + (h2 >>> 0).toString(36);
}
