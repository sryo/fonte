// Spawned into a fixed wrapper on <body> so the pieces keep playing after the
// card that spawned them unmounts; a delegated animationend listener removes
// the wrapper once every piece finishes. Classes live in globals.css.

// Mixed from the theme so the cloud reads on both near-white and near-black backgrounds.
const TONES = [95, 85, 75, 62, 50].map(
  (pct) => `color-mix(in srgb, var(--foreground) ${pct}%, var(--background))`,
);

const RINGS = [
  { n: 7, r: 0, d: [14, 40], s: [26, 40] },
  { n: 11, r: 22, d: [38, 78], s: [16, 30] },
];

export function poofBurst(x: number, y: number) {
  // Cleanup rides on animationend, so bail if animations won't run rather
  // than stranding the pieces on screen.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const wrap = document.createElement("div");
  wrap.className = "card-poof";
  let pending = 0;
  wrap.addEventListener("animationend", () => {
    if (--pending === 0) wrap.remove();
  });

  const piece = (className: string, cx: number, cy: number, size: number, vars: string) => {
    const el = document.createElement("i");
    el.className = className;
    el.style.cssText =
      `left:${cx - size / 2}px; top:${cy - size / 2}px; width:${size}px; height:${size}px;` +
      `background:${TONES[(Math.random() * TONES.length) | 0]};` +
      vars;
    pending++;
    wrap.appendChild(el);
  };

  for (const ring of RINGS) {
    for (let i = 0; i < ring.n; i++) {
      const angle = (i / ring.n) * Math.PI * 2 + Math.random() * 0.6;
      const dist = ring.d[0] + Math.random() * ring.d[1];
      piece(
        "card-poof-puff",
        x + Math.cos(angle) * ring.r,
        y + Math.sin(angle) * ring.r,
        ring.s[0] + Math.random() * ring.s[1],
        `--tx:${Math.cos(angle) * dist}px; --ty:${Math.sin(angle) * dist - 30}px;` +
          `--shrink:${0.05 + Math.random() * 0.15};` +
          `--dur:${340 + Math.random() * 240}ms;` +
          `--delay:${Math.random() * 45}ms`,
      );
    }
  }

  for (let i = 0; i < 8; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 45 + Math.random() * 90;
    piece(
      "card-poof-mote",
      x,
      y,
      2 + Math.random() * 4,
      `--tx:${Math.cos(angle) * dist}px; --ty:${Math.sin(angle) * dist - 22}px;` +
        `--dur:${320 + Math.random() * 200}ms`,
    );
  }

  document.body.appendChild(wrap);
}
