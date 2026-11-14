import { $, reduceMotion } from '../utils/dom.js';
import { TAU, D2R, shortest } from '../utils/math.js';
import { TARGETS, analogOf } from '../data/index.js';
import { state, curTarget } from '../core/state.js';
import { makeGlobe, buildGeom, renderGlobe, project, unproject, stepGlobe, clampT } from '../graphics/globe.js';
import { texture } from '../graphics/textures.js';

/**
 * The globe stage: two canvases plus one overlay canvas for pins, arcs
 * and labels. Owns all stage geometry and pointer interaction, and reports
 * selections back to the controller through initStage callbacks.
 */

const box = $('#canvasbox');
const ov = $('#overlay');
const octx = ov.getContext('2d');

export const E = makeGlobe($('#cvEarth'), '#38bdf8', 0);
export const O = makeGlobe($('#cvOther'), '#38bdf8', 2);
E.tex = texture('earth');
O.tex = texture('moon');

let pins = [];
let hoverPin = null;
let SC = 1;
let ovW = 0;
let ovH = 0;

let handlers = {
  onSelectAnalog: () => {},
  onSelectTarget: () => {},
  onSelectLocation: () => {}
};

/* --------------------------- Layout --------------------------- */

export function layoutStage() {
  const W = box.clientWidth;
  const H = box.clientHeight;
  if (!W || !H) return;

  const D = Math.max(140, Math.min(W * .42, H * .7, 420));
  SC = Math.min(window.devicePixelRatio || 1, 2);
  ovW = W;
  ovH = H;
  ov.width = Math.round(W * SC);
  ov.height = Math.round(H * SC);

  const gs = Math.min(window.devicePixelRatio || 1, 1.5);
  [E, O].forEach((g) => {
    g.D = D;
    g.S = gs;
  });

  E.cx = W * .26;
  O.cx = W * .74;
  E.cy = O.cy = H * .5;

  [E, O].forEach((g) => {
    buildGeom(g);
    g.cv.style.left = (g.cx - D / 2) + 'px';
    g.cv.style.top = (g.cy - D / 2) + 'px';
  });
}

/** Ease the Earth globe towards the selected analog site. */
export function flyEarth() {
  const a = analogOf(state.analogId);
  if (!a) return;
  E.yawT = E.yaw + shortest(a.lon * D2R - E.yaw);
  E.tiltT = clampT(a.lat * D2R * .8);
}

/** Ease the target globe towards the selected Moon/Mars target. */
export function flyOther() {
  const t = curTarget();
  if (!t) return;
  O.yawT = O.yaw + shortest(t.lon * D2R - O.yaw);
  O.tiltT = clampT(t.lat * D2R * .8);
}

/** Swap the second globe between Moon and Mars. */
export function setOtherTexture() {
  O.tex = texture(state.mode);
  O.glow = state.mode === 'moon' ? '#7da7c7' : '#f97316';
  O.builtTilt = null;
}

/* --------------------------- Overlay -------------------------- */

function drawPin(c, x, y, col, o) {
  c.save();
  if (o.glow) { c.shadowColor = col; c.shadowBlur = 14; }
  c.fillStyle = col;
  c.globalAlpha = o.alpha == null ? 1 : o.alpha;
  c.beginPath();
  c.arc(x, y, o.r, 0, TAU);
  c.fill();
  c.shadowBlur = 0;
  if (o.ring) {
    c.globalAlpha = .55;
    c.strokeStyle = col;
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(x, y, o.ring, 0, TAU);
    c.stroke();
  }
  c.restore();
}

function label(c, x, y, text, col) {
  c.font = '500 11px "IBM Plex Mono",ui-monospace,monospace';
  const w = c.measureText(text).width + 12;
  const lx = Math.min(Math.max(x - w / 2, 4), ovW - w - 4);
  c.fillStyle = 'rgba(8,11,20,.88)';
  c.fillRect(lx, y - 24, w, 18);
  c.strokeStyle = col;
  c.globalAlpha = .6;
  c.lineWidth = 1;
  c.strokeRect(lx + .5, y - 23.5, w - 1, 17);
  c.globalAlpha = 1;
  c.fillStyle = '#E6EAF2';
  c.textBaseline = 'middle';
  c.textAlign = 'left';
  c.fillText(text, lx + 6, y - 15);
}

function drawOverlay(now) {
  const c = octx;
  c.setTransform(SC, 0, 0, SC, 0, 0);
  c.clearRect(0, 0, ovW, ovH);
  pins = [];

  const t = curTarget();
  const acc = state.mode === 'moon' ? '#38BDF8' : '#F97316';
  const EARTH = '#34D399';
  const top = state.ranked.slice(0, 6);

  // Arcs from the target to the best Earth matches.
  if (t) {
    const tp = project(O, t.lat, t.lon);
    if (tp.z > .08) {
    const arcFor = (r, sel) => {
      const a = r.analog;
      const ep = project(E, a.lat, a.lon);
      if (ep.z <= .08) return;
      const sc = r.total / 100;
      const mx = (ep.x + tp.x) / 2;
      const my = Math.min(ep.y, tp.y) - Math.hypot(ep.x - tp.x, ep.y - tp.y) * .28;
      const gr = c.createLinearGradient(ep.x, ep.y, tp.x, tp.y);
      gr.addColorStop(0, EARTH);
      gr.addColorStop(1, acc);
      c.save();
      c.strokeStyle = gr;
      c.globalAlpha = sel ? .95 : .18 + .4 * sc;
      c.lineWidth = sel ? 2.4 : .8 + 2 * sc;
      if (sel && !reduceMotion) {
        c.setLineDash([7, 7]);
        c.lineDashOffset = -now / 50;
      }
      c.beginPath();
      c.moveTo(ep.x, ep.y);
      c.quadraticCurveTo(mx, my, tp.x, tp.y);
      c.stroke();
      c.restore();
    };

    top.forEach((r) => {
      if (r.analog.id !== state.analogId) arcFor(r, false);
    });
    const sel = state.ranked.find((r) => r.analog.id === state.analogId);
    if (sel) arcFor(sel, true);
    }
  }

  // Earth pins: selected, top-six, then the rest.
  const topIds = new Set(top.map((r) => r.analog.id));
  state.ranked.forEach((r) => {
    const a = r.analog;
    const p = project(E, a.lat, a.lon);
    if (p.z <= .05) return;
    const isSel = a.id === state.analogId;
    const isTop = topIds.has(a.id);

    if (isSel) {
      const pulse = reduceMotion ? 10 : 9 + 2.5 * Math.sin(now / 260);
      drawPin(c, p.x, p.y, EARTH, { r: 5.5, glow: true, ring: pulse });
    } else if (isTop) {
      drawPin(c, p.x, p.y, EARTH, { r: 4, glow: true, alpha: .55 + .45 * r.total / 100 });
    } else {
      drawPin(c, p.x, p.y, '#8a97b0', { r: 2.6, alpha: .7 });
    }

    pins.push({ type: 'analog', id: a.id, x: p.x, y: p.y, r: 13 });
    if (isSel || hoverPin === ('analog:' + a.id)) {
      label(c, p.x, p.y, a.name + (isTop ? '  ' + Math.round(r.total) + '%' : ''), EARTH);
    }
  });

  // Pins for the targets on the current body.
  TARGETS.filter((x) => x.body === state.mode).forEach((x) => {
    const p = project(O, x.lat, x.lon);
    if (p.z <= .05) return;
    const isSel = Boolean(state.targetId) && x.id === state.targetId;
    if (isSel) {
      const pulse = reduceMotion ? 10 : 9 + 2.5 * Math.sin(now / 260 + 1);
      drawPin(c, p.x, p.y, acc, { r: 6, glow: true, ring: pulse });
    } else {
      drawPin(c, p.x, p.y, acc, { r: 3.6, alpha: .6 });
    }
    pins.push({ type: 'target', id: x.id, x: p.x, y: p.y, r: 14 });
    if (isSel || hoverPin === ('target:' + x.id)) label(c, p.x, p.y, x.name, acc);
  });

  // Exact user-selected points remain pinned even when no supported dataset
  // exists to score them; the results panel explains that limitation.
  const selectedPoints = [state.customEarthPoint && [E, state.customEarthPoint, EARTH],
    state.customTarget && [O, state.customTarget, acc]].filter(Boolean);
  selectedPoints.forEach(([globe, point, color]) => {
    const p = project(globe, point.lat, point.lon);
    if (p.z <= .05) return;
    drawPin(c, p.x, p.y, color, { r: 6, glow: true, ring: 11 });
    pins.push({ type: 'location', body: point.body, lat: point.lat, lon: point.lon, x: p.x, y: p.y, r: 14 });
    label(c, p.x, p.y, point.name, color);
  });

  // Globe captions
  c.font = '500 11px "IBM Plex Mono",ui-monospace,monospace';
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  c.fillStyle = '#66738E';
  c.fillText('EARTH', E.cx, E.cy + E.D / 2 + 18);
  c.fillText(state.mode.toUpperCase(), O.cx, O.cy + O.D / 2 + 18);
}

/* ------------------------ Interaction ------------------------- */

let drag = null;

function localXY(e) {
  const r = ov.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function pinAt(p) {
  let best = null;
  let bd = 1e9;
  pins.forEach((q) => {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < q.r && d < bd) { bd = d; best = q; }
  });
  return best;
}

function globeAt(p) {
  return [E, O].find((g) => Math.hypot(p.x - g.cx, p.y - g.cy) < g.D * .44) || null;
}

ov.addEventListener('pointerdown', (e) => {
  const p = localXY(e);
  drag = { x0: p.x, y0: p.y, lx: p.x, ly: p.y, moved: 0, pin: pinAt(p), g: globeAt(p), id: e.pointerId };
  try { ov.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  if (drag.g) drag.g.dragging = true;
});

ov.addEventListener('pointermove', (e) => {
  const p = localXY(e);
  if (drag) {
    drag.moved += Math.abs(p.x - drag.lx) + Math.abs(p.y - drag.ly);
    if (drag.g && drag.moved > 5) {
      const Rc = drag.g.R / drag.g.S;
      drag.g.yaw -= (p.x - drag.lx) / Rc;
      drag.g.tilt = clampT(drag.g.tilt + (p.y - drag.ly) / Rc * .8);
      drag.g.yawT = drag.g.yaw;
      drag.g.tiltT = drag.g.tilt;
    }
    drag.lx = p.x;
    drag.ly = p.y;
    return;
  }
  const h = pinAt(p);
  hoverPin = h ? (h.type + ':' + h.id) : null;
  ov.style.cursor = h ? 'pointer' : (globeAt(p) ? 'grab' : 'default');
});

function endDrag(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (d.g) d.g.dragging = false;
  if (e.type === 'pointerup' && d.moved < 6 && d.pin) {
    if (d.pin.type === 'analog') handlers.onSelectAnalog(d.pin.id);
    else if (d.pin.type === 'target') handlers.onSelectTarget(d.pin.id);
    else if (d.pin.type === 'location') handlers.onSelectLocation(d.pin.body, d.pin.lat, d.pin.lon);
  } else if (e.type === 'pointerup' && d.moved < 6 && d.g) {
    const point = unproject(d.g, d.x0, d.y0);
    if (point) handlers.onSelectLocation(d.g === E ? 'earth' : state.mode, point.lat, point.lon);
  }
}

ov.addEventListener('pointerup', endDrag);
ov.addEventListener('pointercancel', endDrag);
ov.addEventListener('pointerleave', () => { hoverPin = null; });

/* ---------------------------- API ----------------------------- */

/** Wire stage selections to the controller and keep the canvas sized. */
export function initStage(callbacks) {
  handlers = Object.assign({}, handlers, callbacks);
  if (window.ResizeObserver) {
    new ResizeObserver(() => {
      if (state.view === 'explore') layoutStage();
    }).observe(box);
  }
}

/** Per-frame render for the explore screen. */
export function renderStage(now) {
  stepGlobe(E, now, reduceMotion);
  stepGlobe(O, now, reduceMotion);
  renderGlobe(E);
  renderGlobe(O);
  drawOverlay(now);
}
