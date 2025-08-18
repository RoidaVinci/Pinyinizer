// Optional: only translate what's likely visible first
export function prioritizeVisible(nodes, limit = 5000) {
  const vis = [];
  const invis = [];
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      (e.isIntersecting ? vis : invis).push(e.target);
      io.unobserve(e.target);
    });
  });
  nodes.slice(0, limit).forEach(n => { if (n.parentElement) io.observe(n.parentElement); });
  // Give the observer one frame to populate
  return new Promise(r => requestAnimationFrame(() => {
    io.disconnect();
    r({ visible: vis, rest: nodes });
  }));
}
