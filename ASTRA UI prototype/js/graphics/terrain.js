import { rng } from './rng.js';
import { smooth } from '../utils/math.js';
import { reduceMotion } from '../utils/dom.js';

/**
 * Procedural terrain preview: a 48×48 heightfield drawn as a shaded,
 * drag-rotatable quad mesh (painter's algorithm).
 * These are generated shapes, not real elevation data.
 */

const TN = 48;

function genHeights(p) {
  const rnd = rng(p.seed * 977 + 13);
  const waves = [];
  for (let i = 0; i < 7; i++) {
    const f = 1.2 * Math.pow(1.7, i);
    waves.push({
      fx: f * (.6 + rnd()),
      fy: f * (.6 + rnd()),
      px: rnd() * Math.PI * 2,
      py: rnd() * Math.PI * 2,
      a: Math.pow(.55, i)
    });
  }

  const H = new Float32Array(TN * TN);
  let mn = 1e9, mx = -1e9;

  for (let j = 0; j < TN; j++) {
    for (let i = 0; i < TN; i++) {
      const x = i / (TN - 1) * 2 - 1;
      const y = j / (TN - 1) * 2 - 1;
      let h = 0;
      for (const w of waves) {
        h += w.a * Math.sin(w.fx * x * Math.PI + w.px) * Math.sin(w.fy * y * Math.PI + w.py);
      }
      h *= (p.rough || .4);

      const r = Math.hypot(x, y);
      if (p.crater) h += -p.crater * (1 - smooth(0, .62, r)) + p.crater * .55 * Math.exp(-Math.pow((r - .66) / .11, 2));
      if (p.pit) {
        h += -p.pit * (1 - smooth(.1, .17, r));
        h += .15 * p.pit * Math.exp(-Math.pow((r - .19) / .05, 2));
      }
      if (p.ripple) h += p.ripple * .12 * Math.sin(14 * (x * .9 + y * .4) + 2 * Math.sin(5 * y));

      H[j * TN + i] = h;
      if (h < mn) mn = h;
      if (h > mx) mx = h;
    }
  }
  return { H, mn, mx };
}

/** Create a terrain preview bound to a canvas element. */
export function makeTerrain(cv, p, hue) {
  const T = {
    cv: cv,
    ctx: cv.getContext('2d'),
    g: genHeights(p),
    hue: hue,
    az: 0,
    phase: Math.random() * 6,
    drag: false,
    lx: 0,
    sx: new Float32Array(TN * TN),
    sy: new Float32Array(TN * TN),
    dp: new Float32Array(TN * TN),
    qd: new Float32Array((TN - 1) * (TN - 1)),
    order: [],
    w: 0,
    h: 0,
    dpr: 1
  };
  for (let q = 0; q < (TN - 1) * (TN - 1); q++) T.order.push(q);

  cv.addEventListener('pointerdown', (e) => {
    T.drag = true;
    T.lx = e.clientX;
    try { cv.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    cv.style.cursor = 'grabbing';
  });
  cv.addEventListener('pointermove', (e) => {
    if (!T.drag) return;
    T.az = Math.max(-1.1, Math.min(1.1, T.az + (e.clientX - T.lx) * .008));
    T.lx = e.clientX;
  });
  const end = () => {
    T.drag = false;
    cv.style.cursor = 'grab';
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);

  sizeTerrain(T);
  return T;
}

/** Match the backing store to the element size and DPR. */
export function sizeTerrain(T) {
  const d = Math.min(window.devicePixelRatio || 1, 2);
  const w = T.cv.clientWidth;
  const h = T.cv.clientHeight;
  if (!w || !h) return;
  T.dpr = d;
  T.w = w;
  T.h = h;
  T.cv.width = Math.round(w * d);
  T.cv.height = Math.round(h * d);
}

/** Draw one frame of the rotating, shaded terrain. */
export function drawTerrain(T, now) {
  if (!T.w) sizeTerrain(T);
  if (!T.w) return;

  const ctx = T.ctx;
  const w = T.w, h = T.h, N = TN, H = T.g.H;
  const rngH = Math.max(.001, T.g.mx - T.g.mn);

  ctx.setTransform(T.dpr, 0, 0, T.dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const az = T.az + (reduceMotion || T.drag ? 0 : Math.sin(now / 3600 + T.phase) * .3);
  const ca = Math.cos(az), sa = Math.sin(az);
  const th = 1.0, ct = Math.cos(th), st = Math.sin(th);
  const S = Math.min(w * .4, h * .4), cx = w / 2, cy = h * .5;

  // Project all vertices.
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = i / (N - 1) * 2 - 1;
      const z = j / (N - 1) * 2 - 1;
      const y = (H[j * N + i] - T.g.mn) * .3;
      const xr = x * ca - z * sa;
      const zr = x * sa + z * ca;
      const ys = y * ct + zr * st;
      const dep = zr * ct - y * st;
      const k = 1 / (1 + dep * .3);
      const idx = j * N + i;
      T.sx[idx] = cx + xr * S * k;
      T.sy[idx] = cy - ys * S * k + S * .1;
      T.dp[idx] = dep;
    }
  }

  // Depth-sort quads back to front.
  const M = N - 1;
  for (let j = 0; j < M; j++) {
    for (let i = 0; i < M; i++) {
      const a = j * N + i;
      T.qd[j * M + i] = T.dp[a] + T.dp[a + 1] + T.dp[a + N] + T.dp[a + N + 1];
    }
  }
  T.order.sort((p, q) => T.qd[q] - T.qd[p]);

  ctx.lineWidth = .5;
  for (let o = 0; o < T.order.length; o++) {
    const q = T.order[o];
    const j = (q / M) | 0;
    const i = q % M;
    const a = j * N + i;
    const dx = H[a + 1] - H[a];
    const dz = H[a + N] - H[a];
    const hn = (H[a] - T.g.mn) / rngH;
    const s = Math.max(.05, Math.min(1, .55 - 4 * dx + 2 * dz));
    const l = 12 + 26 * hn + 20 * s;

    ctx.fillStyle = 'hsl(' + T.hue + ' 55% ' + l.toFixed(1) + '%)';
    ctx.strokeStyle = 'hsla(' + T.hue + ',70%,72%,.14)';
    ctx.beginPath();
    ctx.moveTo(T.sx[a], T.sy[a]);
    ctx.lineTo(T.sx[a + 1], T.sy[a + 1]);
    ctx.lineTo(T.sx[a + N + 1], T.sy[a + N + 1]);
    ctx.lineTo(T.sx[a + N], T.sy[a + N]);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}
