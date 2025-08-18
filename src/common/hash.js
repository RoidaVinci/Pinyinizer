export function fastHash(str) {
  let h = 0, i = 0, len = str.length|0;
  while (i < len) { h = (h<<5) - h + str.charCodeAt(i++) | 0; }
  return (h >>> 0).toString(36);
}
