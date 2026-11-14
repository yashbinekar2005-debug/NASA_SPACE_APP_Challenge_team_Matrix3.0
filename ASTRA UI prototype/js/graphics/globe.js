import { INV_TAU, shortest, clamp } from '../utils/math.js';

/**
 * A software-rendered, lit, rotatable globe.
 *
 * Instead of WebGL this builds a per-pixel lookup table once per size:
 * unit-sphere position, light term, edge alpha and destination pixel.
 * Each frame only re-projects longitude/row (when tilt changes) and does a
 * flat typed-array loop with putImageData. Cheap, dependency-free and
 * crisp at any DPR.
 */
export function makeGlobe(canvas, glow, phase) {
  return {
    cv: canvas,
    ctx: canvas.getContext('2d'),
    tex: null,
    yaw: 0,
    tilt: .25,
    yawT: 0,
    tiltT: .25,
    sway: 0,
    phase: phase,
    D: 300,       // CSS diameter
    S: 1,         // device-pixel scale
    R: 0,         // CSS radius
    n: 0,         // number of drawn pixels
    cx: 0,        // CSS centre inside the stage
    cy: 0,
    glow: glow,
    builtTilt: null,
    dragging: false
  };
}

/** Allocate the pixel tables for the current CSS size and device scale. */
export function buildGeom(g) {
  const D = Math.round(g.D * g.S);
  g.N = D;
  g.cv.width = D;
  g.cv.height = D;
  g.cv.style.width = g.D + 'px';
  g.cv.style.height = g.D + 'px';

  g.img = g.ctx.createImageData(D, D);
  g.buf = new Uint32Array(g.img.data.buffer);

  const R = D / 2 * .88;
  g.R = R;
  const c = D / 2;
  const px = [], vx = [], vy = [], vz = [], lit = [], ea = [];
  const L = [-.55, .45, .70];
  const ll = Math.hypot(L[0], L[1], L[2]);

  for (let j = 0; j < D; j++) {
    for (let i = 0; i < D; i++) {
      const x = (i + .5 - c) / R;
      const y = (c - j - .5) / R;
      const rr = Math.hypot(x, y);
      if (rr > 1) continue;
      const z = Math.sqrt(Math.max(0, 1 - rr * rr));
      const d = Math.max(0, (x * L[0] + y * L[1] + z * L[2]) / ll);
      px.push(j * D + i);
      vx.push(x);
      vy.push(y);
      vz.push(z);
      lit.push(.14 + .86 * Math.pow(d, .85));
      ea.push(Math.round(255 * Math.max(0, Math.min(1, (1 - rr) * R / 1.2))));
    }
  }

  g.n = px.length;
  g.pix = Int32Array.from(px);
  g.vx = Float32Array.from(vx);
  g.vy = Float32Array.from(vy);
  g.vz = Float32Array.from(vz);
  g.lit = Float32Array.from(lit);
  g.ea = Uint8Array.from(ea);
  g.lonB = new Float32Array(g.n);
  g.row = new Uint16Array(g.n);
  g.builtTilt = null;
}

/** Pre-compute texture longitude and row indices for the current tilt. */
export function applyTilt(g) {
  if (!g.tex) return;
  const T = g.tilt;
  const c = Math.cos(T);
  const s = Math.sin(T);
  const TH = g.tex.h;

  for (let k = 0; k < g.n; k++) {
    const py = g.vy[k] * c + g.vz[k] * s;
    const pz = -g.vy[k] * s + g.vz[k] * c;
    g.lonB[k] = Math.atan2(g.vx[k], pz);
    let rw = Math.floor((.5 - Math.asin(clamp(py, -1, 1)) / Math.PI) * TH);
    g.row[k] = rw < 0 ? 0 : rw >= TH ? TH - 1 : rw;
  }
  g.builtTilt = T;
}

/** Paint the sphere, then add the outer glow behind it. */
export function renderGlobe(g) {
  if (!g.tex || !g.n) return;
  if (g.builtTilt === null || Math.abs(g.tilt - g.builtTilt) > .0015) applyTilt(g);

  const tex = g.tex.px;
  const TW = g.tex.w;
  const yawP = g.yaw + g.sway + Math.PI;
  const buf = g.buf, n = g.n, lonB = g.lonB, row = g.row, lit = g.lit, pix = g.pix, ea = g.ea;

  for (let k = 0; k < n; k++) {
    let u = (lonB[k] + yawP) * INV_TAU;
    u -= Math.floor(u);
    const t = tex[row[k] * TW + ((u * TW) | 0)];
    const l = lit[k];
    buf[pix[k]] = (ea[k] << 24) |
      ((((t >> 16) & 255) * l) << 16) |
      ((((t >> 8) & 255) * l) << 8) |
      ((t & 255) * l);
  }

  const ctx = g.ctx;
  ctx.putImageData(g.img, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-over';
  const D = g.N, c = D / 2;
  const gr = ctx.createRadialGradient(c, c, g.R * .96, c, c, g.R * 1.12);
  gr.addColorStop(0, g.glow + '66');
  gr.addColorStop(1, g.glow + '00');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, D, D);
  ctx.restore();
}

/** Project a lat/lon to CSS pixels inside the stage. z < 0 means far side. */
export function project(g, lat, lon) {
  const la = lat * Math.PI / 180;
  const a = lon * Math.PI / 180 - (g.yaw + g.sway);
  const px = Math.cos(la) * Math.sin(a);
  const py = Math.sin(la);
  const pz = Math.cos(la) * Math.cos(a);
  const c = Math.cos(g.tilt);
  const s = Math.sin(g.tilt);
  const vy = py * c - pz * s;
  const vz = py * s + pz * c;
  const Rc = g.R / g.S;
  return { x: g.cx + px * Rc, y: g.cy - vy * Rc, z: vz };
}

/** Ease towards the target orientation and add a slow idle sway. */
export function stepGlobe(g, now, reduceMotion) {
  if (!g.dragging) {
    g.yaw += shortest(g.yawT - g.yaw) * .08;
    g.tilt += (g.tiltT - g.tilt) * .08;
  }
  g.sway = reduceMotion ? 0 : .09 * Math.sin(now / 5200 + g.phase);
}

export const clampT = (v) => Math.max(-1.1, Math.min(1.1, v));
