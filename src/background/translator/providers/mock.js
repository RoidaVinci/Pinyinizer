export async function translateMock(texts, { targetLang }) {
  const arr = Array.isArray(texts) ? texts : [texts];
  return arr.map(s => `[${targetLang}] ${s}`);
}
