import { TAU } from '../utils/math.js';
import { rng } from './rng.js';

/**
 * Procedural textures for the two globes. Everything is drawn once into an
 * offscreen canvas and cached as a Uint32Array for the software renderer.
 * Shapes are illustrative, not real coastlines or elevation data.
 */

// Very coarse land outlines in [lon, lat] degrees. Enough to read as Earth
// at globe scale without shipping a map dataset.
const LAND = {
  eurasia: [[8,54],[8,58],[5,60],[5,62],[12,66],[18,70],[26,71],[32,70],[40,67],[44,68],[54,68],[68,69],[80,73],[100,77],[112,74],[130,72],[142,72],[160,70],[170,69],[180,68],[180,65],[170,62],[163,60],[158,53],[156,51],[152,59],[143,59],[137,54],[141,48],[135,43],[129,40],[129,35],[126,35],[126,38],[122,40],[122,37],[119,35],[121,32],[122,30],[119,25],[114,22],[108,21],[106,19],[109,12],[105,9],[101,13],[100,8],[103,1],[98,8],[98,16],[94,16],[91,22],[87,21],[80,15],[77,8],[73,17],[72,21],[67,24],[61,25],[57,26],[52,27],[48,30],[50,26],[56,25],[59,22],[52,16],[43,13],[39,21],[35,28],[34,31],[35,36],[30,36],[27,37],[26,40],[23,40],[23,37],[20,40],[19,42],[14,45],[12,44],[16,41],[16,38],[12,42],[8,44],[3,43],[0,39],[-2,37],[-5,36],[-9,37],[-9,43],[-2,43.5],[-1,46],[-4,48],[2,51],[5,53]],
  africa: [[10,37],[11,33],[20,31],[32,31],[32,30],[37,21],[39,15],[43,12],[51,12],[46,5],[41,-2],[40,-10],[40,-15],[35,-20],[33,-26],[30,-31],[25,-34],[19,-35],[17,-30],[12,-17],[13,-9],[9,-1],[9,4],[5,6],[-2,5],[-8,4],[-13,8],[-17,14],[-17,21],[-13,27],[-10,30],[-6,36]],
  namerica: [[-168,66],[-162,70],[-140,70],[-125,70],[-95,72],[-82,68],[-80,63],[-94,59],[-93,52],[-82,52],[-78,58],[-72,62],[-65,60],[-56,52],[-60,47],[-67,45],[-70,42],[-76,38],[-81,31],[-80,26],[-82,27],[-84,30],[-90,29],[-97,27],[-97,22],[-94,18],[-90,21],[-87,21],[-88,16],[-84,15],[-83,10],[-78,8],[-80,7],[-86,11],[-92,14],[-97,16],[-105,20],[-109,25],[-112,29],[-114,32],[-117,32],[-121,35],[-124,40],[-124,47],[-125,49],[-130,55],[-137,58],[-146,61],[-152,59],[-158,57],[-164,55],[-158,59],[-165,62],[-166,64]],
  samerica: [[-78,8],[-72,12],[-62,10],[-52,5],[-50,0],[-44,-2],[-35,-5],[-35,-9],[-39,-15],[-41,-22],[-48,-26],[-53,-34],[-58,-38],[-62,-40],[-65,-45],[-68,-50],[-69,-54],[-72,-53],[-75,-47],[-73,-38],[-71,-30],[-70,-18],[-76,-14],[-81,-6],[-80,-1],[-77,4]],
  australia: [[114,-22],[122,-18],[130,-12],[136,-12],[137,-16],[142,-11],[146,-19],[153,-26],[151,-34],[146,-39],[140,-38],[135,-34],[129,-32],[115,-34]],
  madagascar: [[44,-25],[47,-25],[50,-15],[49,-12],[44,-17]],
  uk: [[-5,50],[1,51],[2,53],[-2,56],[-3,58.5],[-6,57],[-3,54]],
  ireland: [[-10,52],[-6,52],[-6,55],[-10,54]],
  japan: [[131,34],[135,35],[140,36],[142,40],[140,41],[139,38],[136,37]],
  sumatra: [[95,5],[98,4],[106,-3],[105,-6],[100,-2]],
  borneo: [[109,1],[117,7],[119,1],[116,-4],[110,-3]],
  guinea: [[131,-1],[141,-3],[150,-10],[142,-9],[135,-4]],
  java: [[105,-6],[114,-7],[114,-8.5],[106,-7.5]],
  nzn: [[172,-35],[178,-38],[175,-41]],
  nzs: [[172,-41],[174,-41],[171,-46],[167,-46]],
  baffin: [[-80,73],[-68,70],[-62,66],[-70,63],[-78,65],[-90,70]],
  cuba: [[-85,22],[-80,23],[-74,20],[-77,20]]
};

const ICE_LAND = {
  greenland: [[-73,78],[-60,82],[-30,83],[-20,80],[-20,70],[-43,60],[-52,65],[-58,75]],
  iceland: [[-24,65],[-14,66],[-14,64],[-22,63.5]]
};

function polyPath(ctx, pts, X, Y) {
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = X(p[0]);
    const y = Y(p[1]);
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  });
  ctx.closePath();
  ctx.fill();
}

function mk(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/* ------------------------------- Earth ------------------------------- */

function earthTexture() {
  const W = 1024, H = 512, c = mk(W, H), x = c.getContext('2d');
  const X = (lo) => (lo + 180) / 360 * W;
  const Y = (la) => (90 - la) / 180 * H;

  const og = x.createLinearGradient(0, 0, 0, H);
  og.addColorStop(0, '#0f2c52');
  og.addColorStop(.5, '#0b2547');
  og.addColorStop(1, '#0f2c52');
  x.fillStyle = og;
  x.fillRect(0, 0, W, H);

  // Land mask drawn separately so noise can be clipped to it.
  const l = mk(W, H), y = l.getContext('2d');
  y.fillStyle = '#2f7152';
  Object.keys(LAND).forEach((k) => polyPath(y, LAND[k], X, Y));

  y.fillStyle = '#e3eef5';
  Object.keys(ICE_LAND).forEach((k) => polyPath(y, ICE_LAND[k], X, Y));
  y.fillRect(0, Y(-71), W, H - Y(-71));

  y.globalCompositeOperation = 'source-atop';
  const r = rng(5);
  for (let i = 0; i < 9000; i++) {
    y.fillStyle = r() < .5 ? 'rgba(15,55,35,.28)' : 'rgba(140,165,100,.2)';
    y.fillRect(r() * W, r() * H, 2 + r() * 6, 1 + r() * 3);
  }

  // Deserts
  y.fillStyle = 'rgba(190,150,85,.6)';
  polyPath(y, [[-15,30],[10,31],[35,30],[35,17],[20,14],[-15,16]], X, Y);
  polyPath(y, [[36,30],[48,29],[56,22],[50,16],[43,14],[36,24]], X, Y);
  polyPath(y, [[-72,-18],[-68,-18],[-68,-27],[-71,-27]], X, Y);
  polyPath(y, [[100,43],[118,43],[118,38],[100,38]], X, Y);
  polyPath(y, [[120,-21],[135,-21],[135,-30],[120,-30]], X, Y);

  // Rainforest
  y.fillStyle = 'rgba(30,100,60,.45)';
  polyPath(y, [[-70,5],[-52,5],[-52,-12],[-68,-12],[-74,-4]], X, Y);
  polyPath(y, [[10,5],[28,5],[28,-6],[12,-6]], X, Y);

  x.drawImage(l, 0, 0);

  // Polar haze
  const ag = x.createLinearGradient(0, 0, 0, Y(78));
  ag.addColorStop(0, 'rgba(225,238,248,.75)');
  ag.addColorStop(1, 'rgba(225,238,248,0)');
  x.fillStyle = ag;
  x.fillRect(0, 0, W, Y(78));

  // Hawaiʻi, home of two analog sites
  x.fillStyle = 'rgba(255,255,255,.9)';
  [[-155.3, 19.5], [-157.9, 21.3], [-156.4, 20.8]].forEach((p) => {
    x.fillRect(X(p[0]) - 1, Y(p[1]) - 1, 3, 3);
  });

  return c;
}

/* ------------------------------- Moon -------------------------------- */

function craterLayer(x, W, H, r, count, warm, maxR) {
  for (let i = 0; i < count; i++) {
    const la = Math.asin(2 * r() - 1);
    const lo = r() * 360 - 180;
    const rd = .5 + Math.pow(r(), 3.4) * maxR;
    const px = (lo + 180) / 360 * W;
    const py = (90 - la / Math.PI * 180) / 180 * H;
    const rp = rd * (H / 180);
    const sx = 1 / Math.max(.25, Math.cos(la));
    x.save();
    x.translate(px, py);
    x.scale(sx, 1);
    const g = x.createRadialGradient(0, 0, 0, 0, 0, rp);
    const dk = warm ? '55,22,10' : '20,22,28';
    const lt = warm ? '240,190,150' : '235,238,245';
    g.addColorStop(0, 'rgba(' + dk + ',.32)');
    g.addColorStop(.68, 'rgba(' + dk + ',.12)');
    g.addColorStop(.86, 'rgba(' + lt + ',.22)');
    g.addColorStop(1, 'rgba(' + lt + ',0)');
    x.fillStyle = g;
    x.beginPath();
    x.arc(0, 0, rp, 0, TAU);
    x.fill();
    x.restore();
  }
}

function blob(x, W, H, lo, la, rdeg, col, a) {
  const px = (lo + 180) / 360 * W;
  const py = (90 - la) / 180 * H;
  const rp = rdeg * (W / 360);
  x.save();
  x.translate(px, py);
  x.scale(1, .9);
  const g = x.createRadialGradient(0, 0, 0, 0, 0, rp);
  g.addColorStop(0, 'rgba(' + col + ',' + a + ')');
  g.addColorStop(.7, 'rgba(' + col + ',' + a * .8 + ')');
  g.addColorStop(1, 'rgba(' + col + ',0)');
  x.fillStyle = g;
  x.beginPath();
  x.arc(0, 0, rp, 0, TAU);
  x.fill();
  x.restore();
}

function moonTexture() {
  const W = 1024, H = 512, c = mk(W, H), x = c.getContext('2d'), r = rng(77);
  x.fillStyle = '#8d929b';
  x.fillRect(0, 0, W, H);

  for (let i = 0; i < 1400; i++) {
    x.fillStyle = r() < .5 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.06)';
    x.fillRect(r() * W, r() * H, 3 + r() * 12, 2 + r() * 6);
  }

  // Mare
  const M = '62,66,74';
  blob(x, W, H, -55, 15, 22, M, .8);
  blob(x, W, H, -20, 35, 13, M, .85);
  blob(x, W, H, 18, 28, 8, M, .85);
  blob(x, W, H, 31, 8, 9, M, .85);
  blob(x, W, H, 59, 17, 6, M, .9);
  blob(x, W, H, 51, -4, 8, M, .7);
  blob(x, W, H, -15, -21, 9, M, .75);
  blob(x, W, H, -39, -24, 6, M, .8);
  blob(x, W, H, 0, 58, 6, M, .5);

  craterLayer(x, W, H, r, 1000, false, 7);
  craterLayer(x, W, H, r, 40, false, 13);

  const sg = x.createLinearGradient(0, H * .965, 0, H);
  sg.addColorStop(0, 'rgba(5,7,12,0)');
  sg.addColorStop(1, 'rgba(5,7,12,.85)');
  x.fillStyle = sg;
  x.fillRect(0, H * .965, W, H * .035);

  for (let i = 0; i < 14000; i++) {
    x.fillStyle = 'rgba(255,255,255,' + (r() * .07) + ')';
    x.fillRect(r() * W, r() * H, 1, 1);
  }
  return c;
}

/* ------------------------------- Mars -------------------------------- */

function marsTexture() {
  const W = 1024, H = 512, c = mk(W, H), x = c.getContext('2d'), r = rng(99);
  x.fillStyle = '#a4512f';
  x.fillRect(0, 0, W, H);

  for (let i = 0; i < 1400; i++) {
    x.fillStyle = r() < .5 ? 'rgba(255,200,150,.06)' : 'rgba(60,20,10,.08)';
    x.fillRect(r() * W, r() * H, 3 + r() * 12, 2 + r() * 6);
  }

  // Dark albedo features
  const D = '84,36,22';
  blob(x, W, H, 70, 10, 18, D, .65);
  blob(x, W, H, -20, 45, 20, D, .55);
  blob(x, W, H, -50, -40, 22, D, .5);
  blob(x, W, H, 120, -45, 16, D, .5);
  blob(x, W, H, -100, 10, 16, D, .45);
  blob(x, W, H, 160, 25, 12, D, .4);
  blob(x, W, H, -120, -8, 6, '200,140,100', .4);

  craterLayer(x, W, H, r, 700, true, 6);

  // Valles Marineris
  x.strokeStyle = 'rgba(70,26,14,.75)';
  x.lineWidth = 3;
  x.beginPath();
  for (let i = 0; i <= 30; i++) {
    const lo = -85 + i;
    const la = -12 + Math.sin(i * .4) * 1.2;
    const px = (lo + 180) / 360 * W;
    const py = (90 - la) / 180 * H;
    if (i) x.lineTo(px, py); else x.moveTo(px, py);
  }
  x.stroke();

  // Polar caps
  const pg = x.createLinearGradient(0, 0, 0, H * .1);
  pg.addColorStop(0, 'rgba(245,245,250,.95)');
  pg.addColorStop(1, 'rgba(245,245,250,0)');
  x.fillStyle = pg;
  x.fillRect(0, 0, W, H * .1);

  const pg2 = x.createLinearGradient(0, H * .92, 0, H);
  pg2.addColorStop(0, 'rgba(245,245,250,0)');
  pg2.addColorStop(1, 'rgba(245,245,250,.95)');
  x.fillStyle = pg2;
  x.fillRect(0, H * .92, W, H * .08);

  return c;
}

/* ------------------------------- Cache ------------------------------- */

const texCache = {};

/** Get a globe texture as { w, h, px:Uint32Array }. Built lazily and cached. */
export function texture(kind) {
  if (!texCache[kind]) {
    const c = kind === 'earth' ? earthTexture() : kind === 'moon' ? moonTexture() : marsTexture();
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    texCache[kind] = { w: c.width, h: c.height, px: new Uint32Array(d.data.buffer) };
  }
  return texCache[kind];
}
