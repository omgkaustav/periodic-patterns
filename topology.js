export function mod(n, m) {
  return ((n % m) + m) % m;
}

function tile(n, m) {
  return Math.floor(n / m);
}

function foldTorus(x, y, w, h) {
  return [mod(x, w), mod(y, h)];
}

function foldKleinH(x, y, w, h) {
  const ty = tile(y, h);
  y = mod(y, h);
  if (ty & 1) x = w - 1 - x;
  return [mod(x, w), y];
}

function foldKleinV(x, y, w, h) {
  const tx = tile(x, w);
  x = mod(x, w);
  if (tx & 1) y = h - 1 - y;
  return [x, mod(y, h)];
}

function foldRp2(x, y, w, h) {
  const tx = tile(x, w);
  const ty = tile(y, h);
  x = mod(x, w);
  y = mod(y, h);
  if (ty & 1) x = w - 1 - x;
  if (tx & 1) y = h - 1 - y;
  return [x, y];
}

function foldRot180(x, y, w, h) {
  const tx = tile(x, w);
  const ty = tile(y, h);
  x = mod(x, w);
  y = mod(y, h);
  if ((tx + ty) & 1) {
    x = w - 1 - x;
    y = h - 1 - y;
  }
  return [x, y];
}

function foldGlide(x, y, w, h) {
  const ty = tile(y, h);
  y = mod(y, h);
  if (ty & 1) x += w >> 1;
  return [mod(x, w), y];
}

function foldGlideFlip(x, y, w, h) {
  const ty = tile(y, h);
  y = mod(y, h);
  if (ty & 1) {
    x = w - 1 - x;
    x += w >> 1;
  }
  return [mod(x, w), y];
}

function foldGlideV(x, y, w, h) {
  const tx = tile(x, w);
  x = mod(x, w);
  if (tx & 1) y += h >> 1;
  return [x, mod(y, h)];
}

function foldMirrorX(x, y, w, h) {
  const tx = tile(x, w);
  x = mod(x, w);
  if (tx & 1) x = w - 1 - x;
  return [x, mod(y, h)];
}

function foldMirrorY(x, y, w, h) {
  const ty = tile(y, h);
  y = mod(y, h);
  if (ty & 1) y = h - 1 - y;
  return [mod(x, w), y];
}

function foldMirrorBoth(x, y, w, h) {
  const tx = tile(x, w);
  const ty = tile(y, h);
  x = mod(x, w);
  y = mod(y, h);
  if (tx & 1) x = w - 1 - x;
  if (ty & 1) y = h - 1 - y;
  return [x, y];
}

export const TOPOLOGIES = [
  { id: "torus", name: "Translate — copies match", fold: foldTorus },
  { id: "klein-h", name: "Flip rows", fold: foldKleinH },
  { id: "klein-v", name: "Flip columns", fold: foldKleinV },
  { id: "rp2", name: "Flip both", fold: foldRp2 },
  { id: "rot180", name: "Rotate 180°", fold: foldRot180 },
  { id: "mirror-x", name: "Mirror columns", fold: foldMirrorX },
  { id: "mirror-y", name: "Mirror rows", fold: foldMirrorY },
  { id: "mirror-both", name: "Mirror both", fold: foldMirrorBoth },
];

export const TOPOLOGY_INDEX = Object.fromEntries(TOPOLOGIES.map((item, i) => [item.id, i]));
export const TOPOLOGY_BY_ID = Object.fromEntries(TOPOLOGIES.map((item) => [item.id, item]));

export const LATTICE_INDEX = { square: 0, hex: 1 };

const SQUARE_OFFSETS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

const HEX_OFFSETS = [
  [1, 0], [1, -1], [0, -1],
  [-1, 0], [-1, 1], [0, 1],
];

export function hexDistance(dq, dr) {
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function buildNeighbors(w, h, lattice, fold) {
  const n = w * h;
  const offsets = lattice === "square" ? SQUARE_OFFSETS : HEX_OFFSETS;
  const count = offsets.length;
  const idx = new Int32Array(n * count);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const base = (r * w + c) * count;
      for (let k = 0; k < count; k++) {
        const [cc, rr] = fold(c + offsets[k][0], r + offsets[k][1], w, h);
        idx[base + k] = rr * w + cc;
      }
    }
  }
  return { idx, count };
}

export function lapAt(src, i, neighbors) {
  const { idx, count } = neighbors;
  const base = i * count;
  if (count === 8) {
    return src[idx[base]] * 0.2 + src[idx[base + 1]] * 0.2
      + src[idx[base + 2]] * 0.2 + src[idx[base + 3]] * 0.2
      + src[idx[base + 4]] * 0.05 + src[idx[base + 5]] * 0.05
      + src[idx[base + 6]] * 0.05 + src[idx[base + 7]] * 0.05
      - src[i];
  }
  let sum = 0;
  for (let k = 0; k < count; k++) sum += src[idx[base + k]];
  return sum / count - src[i];
}

export function laplacian(src, dst, neighbors) {
  const n = src.length;
  for (let i = 0; i < n; i++) dst[i] = lapAt(src, i, neighbors);
}

export function neighborSum(src, i, neighbors) {
  const { idx, count } = neighbors;
  const base = i * count;
  let sum = 0;
  for (let k = 0; k < count; k++) sum += src[idx[base + k]];
  return sum;
}

export function buildDisk(maxR, lattice) {
  const cells = [];
  for (let dr = -maxR; dr <= maxR; dr++) {
    for (let dc = -maxR; dc <= maxR; dc++) {
      const dist = lattice === "hex" || lattice === "triangle"
        ? hexDistance(dc, dr)
        : Math.hypot(dc, dr);
      if (dist <= maxR) cells.push([dc, dr, dist]);
    }
  }
  return cells;
}

export function mulberry(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export const SQRT3 = Math.sqrt(3);

export function inPointyHex(dx, dy, size) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  return ay <= size + 1e-6
    && ax <= size * SQRT3 / 2 + 1e-6
    && ax / SQRT3 + ay <= size + 1e-6;
}

export function barycentric(x, y, ax, ay, bx, by, cx, cy) {
  const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  const a = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
  const b = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
  const c = 1 - a - b;
  return [a, b, c];
}

export function cubeRound(q, r) {
  let x = q;
  let z = r;
  let y = -x - z;
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return [rx, rz];
}

export function applyCopy(u, v, tx, ty, topology) {
  let x = u;
  let y = v;
  const id = topology;
  if (id === "klein-h" && (ty & 1)) x = 1 - x;
  else if (id === "klein-v" && (tx & 1)) y = 1 - y;
  else if (id === "rp2") {
    if (ty & 1) x = 1 - x;
    if (tx & 1) y = 1 - y;
  } else if (id === "rot180" && ((tx + ty) & 1)) {
    x = 1 - x;
    y = 1 - y;
  } else if (id === "glide" && (ty & 1)) x = x + 0.5;
  else if (id === "glide-flip" && (ty & 1)) x = 1 - x + 0.5;
  else if (id === "glide-v" && (tx & 1)) y = y + 0.5;
  else if (id === "mirror-x" && (tx & 1)) x = 1 - x;
  else if (id === "mirror-y" && (ty & 1)) y = 1 - y;
  else if (id === "mirror-both") {
    if (tx & 1) x = 1 - x;
    if (ty & 1) y = 1 - y;
  }
  x -= Math.floor(x);
  y -= Math.floor(y);
  return [x, y];
}
