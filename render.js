import { SQRT3, applyCopy, inPointyHex } from "./topology.js";

export const PALETTES = {
  ink: [[245, 240, 229], [24, 32, 30]],
  lichen: [[236, 241, 214], [47, 92, 64], [18, 32, 28]],
  ember: [[48, 18, 16], [196, 72, 28], [245, 214, 150]],
  ocean: [[8, 22, 38], [22, 92, 122], [186, 232, 226]],
  mono: [[12, 12, 12], [240, 240, 236]],
  mineral: [[28, 24, 22], [168, 92, 48], [232, 210, 168]],
  aurora: [[12, 18, 28], [48, 160, 140], [214, 244, 168]],
};

const PAIR_A = "#e85d4c";
const PAIR_B = "#3db8c1";
const PAIR_C = "#c6d94a";

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function paletteColor(t, stops) {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  if (stops.length === 1) return stops[0];
  const scaled = x * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(scaled));
  const f = scaled - i;
  const pa = stops[i];
  const pb = stops[i + 1];
  return [lerp(pa[0], pb[0], f), lerp(pa[1], pb[1], f), lerp(pa[2], pb[2], f)];
}

export function layout(lattice, width, height) {
  const pad = Math.round(Math.min(width, height) * 0.06);
  if (lattice === "hex") {
    const size = Math.min((width - pad * 2) / SQRT3, (height - pad * 2) / 2);
    return { kind: "hex", cx: width / 2, cy: height / 2, size, pad };
  }
  return { kind: "square", cx: width / 2, cy: height / 2, pad };
}

function hexToCell(dx, dy, size, w, h) {
  const q = (SQRT3 / 3 * dx - dy / 3) / size * w + w / 2;
  const r = (2 / 3 * dy) / size * h + h / 2;
  return [q, r];
}

function sampleField(u, v, w, h, fold, valueAt) {
  const [x, y] = fold(Math.floor(u * w), Math.floor(v * h), w, h);
  return valueAt(y * w + x);
}

function tone(v, contrast, invert, thresholdOn, cutoff) {
  let x = (v - 0.5) * contrast + 0.5;
  if (x < 0) x = 0;
  else if (x > 1) x = 1;
  if (invert) x = 1 - x;
  if (thresholdOn) x = x >= cutoff ? 1 : 0;
  return x;
}

function put(data, i, rgb, a = 255) {
  data[i] = rgb[0];
  data[i + 1] = rgb[1];
  data[i + 2] = rgb[2];
  data[i + 3] = a;
}

function shade(opts, u, v) {
  const v0 = sampleField(u, v, opts.w, opts.h, opts.fold, opts.valueAt);
  return tone(v0, opts.contrast, opts.invert, opts.thresholdOn, opts.cutoff);
}

export function drawUnit(ctx, opts) {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const L = layout(opts.lattice, width, height);
  const img = ctx.createImageData(width, height);
  const data = img.data;
  const stops = PALETTES[opts.palette] ?? PALETTES.ink;
  const bg = [18, 26, 24];

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const i = (py * width + px) * 4;
      let uv = null;
      if (L.kind === "square") {
        uv = [px / Math.max(1, width - 1), py / Math.max(1, height - 1)];
      } else {
        const dx = px - L.cx;
        const dy = py - L.cy;
        if (inPointyHex(dx, dy, L.size)) {
          const [q, r] = hexToCell(dx, dy, L.size, opts.w, opts.h);
          uv = [q / opts.w, r / opts.h];
        }
      }
      if (!uv) {
        put(data, i, bg, 0);
        continue;
      }
      put(data, i, paletteColor(shade(opts, uv[0], uv[1]), stops));
    }
  }
  ctx.putImageData(img, 0, 0);
  return L;
}

export function drawWallpaper(ctx, unitCanvas, opts) {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  if (opts.lattice === "hex") {
    drawHexWallpaper(ctx, opts);
    return;
  }
  const tw = width / 3;
  const th = height / 3;
  ctx.fillStyle = "#121b1a";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = false;
  for (let ty = 0; ty < 3; ty++) {
    for (let tx = 0; tx < 3; tx++) {
      const cx = (tx + 0.5) * tw;
      const cy = (ty + 0.5) * th;
      ctx.save();
      ctx.translate(cx, cy);
      applyStampTransform(ctx, tx - 1, ty - 1, opts.topology);
      ctx.drawImage(unitCanvas, -tw / 2, -th / 2, tw, th);
      ctx.restore();
    }
  }
}

function drawHexWallpaper(ctx, opts) {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const size = Math.min(width, height) / 6.2;
  const img = ctx.createImageData(width, height);
  const data = img.data;
  const stops = PALETTES[opts.palette] ?? PALETTES.ink;
  const bg = [18, 26, 24];
  const w = opts.w;
  const h = opts.h;
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const i = (py * width + px) * 4;
      const x = px - width / 2;
      const y = py - height / 2;
      const [q, r] = hexToCell(x, y, size, w, h);
      const t = shade(opts, q / w, r / h);
      put(data, i, paletteColor(t, stops));
    }
  }
  ctx.putImageData(img, 0, 0);
}

function applyStampTransform(ctx, tx, ty, topology) {
  const id = topology;
  if (id === "klein-h" && (ty & 1)) ctx.scale(-1, 1);
  else if (id === "klein-v" && (tx & 1)) ctx.scale(1, -1);
  else if (id === "rp2") {
    if (ty & 1) ctx.scale(-1, 1);
    if (tx & 1) ctx.scale(1, -1);
  } else if (id === "rot180" && ((tx + ty) & 1)) ctx.rotate(Math.PI);
  else if (id === "mirror-x" && (tx & 1)) ctx.scale(-1, 1);
  else if (id === "mirror-y" && (ty & 1)) ctx.scale(1, -1);
  else if (id === "mirror-both") {
    if (tx & 1) ctx.scale(-1, 1);
    if (ty & 1) ctx.scale(1, -1);
  }
}

function arrowPair(topology) {
  let left = 1;
  let right = 1;
  let bottom = 1;
  let top = 1;
  const id = topology;
  if (id === "klein-v" || id === "rp2" || id === "rot180" || id === "mirror-x" || id === "mirror-both") {
    right = -1;
  }
  if (id === "klein-h" || id === "rp2" || id === "rot180" || id === "mirror-y" || id === "mirror-both") {
    top = -1;
  }
  return { left, right, bottom, top };
}

function drawArrowhead(ctx, x, y, dx, dy, size) {
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - ux * size + px * size * 0.55, y - uy * size + py * size * 0.55);
  ctx.lineTo(x - ux * size - px * size * 0.55, y - uy * size - py * size * 0.55);
  ctx.closePath();
  ctx.fill();
}

function strokeArrows(ctx, x1, y1, x2, y2, color, sense, count = 3) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const edge = Math.hypot(dx, dy);
  const head = Math.max(18, Math.min(32, edge * 0.12));
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(3, head * 0.18);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const x = x1 + dx * t;
    const y = y1 + dy * t;
    drawArrowhead(ctx, x, y, sense * dx, sense * dy, head);
  }
}

export function drawEdgeOverlay(ctx, opts) {
  const { lattice, topology, mode } = opts;
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  if (lattice === "hex") {
    drawHexOverlay(ctx, topology, mode, width, height);
    return;
  }
  const pair = arrowPair(topology);
  if (mode === "unit") {
    const inset = 10;
    strokeArrows(ctx, inset, height - inset, inset, inset, PAIR_A, pair.left);
    strokeArrows(ctx, width - inset, height - inset, width - inset, inset, PAIR_A, pair.right);
    strokeArrows(ctx, inset, height - inset, width - inset, height - inset, PAIR_B, pair.bottom);
    strokeArrows(ctx, inset, inset, width - inset, inset, PAIR_B, pair.top);
    return;
  }
  const tw = width / 3;
  const th = height / 3;
  const inset = 8;
  ctx.save();
  ctx.strokeStyle = "rgba(24, 32, 30, 0.55)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(tw, 0); ctx.lineTo(tw, height);
  ctx.moveTo(tw * 2, 0); ctx.lineTo(tw * 2, height);
  ctx.moveTo(0, th); ctx.lineTo(width, th);
  ctx.moveTo(0, th * 2); ctx.lineTo(width, th * 2);
  ctx.stroke();
  ctx.restore();
  for (let ty = 0; ty < 3; ty++) {
    for (let tx = 0; tx < 3; tx++) {
      const x0 = tx * tw + inset;
      const y0 = ty * th + inset;
      const x1 = (tx + 1) * tw - inset;
      const y1 = (ty + 1) * th - inset;
      strokeArrows(ctx, x0, y1, x0, y0, PAIR_A, pair.left, 2);
      strokeArrows(ctx, x1, y1, x1, y0, PAIR_A, pair.right, 2);
      strokeArrows(ctx, x0, y1, x1, y1, PAIR_B, pair.bottom, 2);
      strokeArrows(ctx, x0, y0, x1, y0, PAIR_B, pair.top, 2);
    }
  }
}

function hexPairSense(topology) {
  const pair = arrowPair(topology);
  return [pair.left, pair.bottom, pair.right];
}

function hexVertices(cx, cy, size) {
  const pts = [];
  for (let k = 0; k < 6; k++) {
    const angle = Math.PI / 180 * (60 * k - 30);
    pts.push([cx + size * Math.cos(angle), cy + size * Math.sin(angle)]);
  }
  return pts;
}

function drawHexOverlay(ctx, topology, mode, width, height) {
  const senses = hexPairSense(topology);
  const colors = [PAIR_A, PAIR_B, PAIR_C];
  if (mode === "unit") {
    const L = layout("hex", width, height);
    const pts = hexVertices(L.cx, L.cy, L.size * 0.96);
    for (let k = 0; k < 6; k++) {
      const a = pts[k];
      const b = pts[(k + 1) % 6];
      const pair = k % 3;
      strokeArrows(ctx, a[0], a[1], b[0], b[1], colors[pair], senses[pair], 2);
    }
    return;
  }
  const size = Math.min(width, height) / 6.2;
  for (let tr = -3; tr <= 3; tr++) {
    for (let tq = -3; tq <= 3; tq++) {
      const cx = width / 2 + tq * SQRT3 * size + tr * SQRT3 / 2 * size;
      const cy = height / 2 + tr * 1.5 * size;
      const pts = hexVertices(cx, cy, size * 0.98);
      for (let k = 0; k < 6; k++) {
        const a = pts[k];
        const b = pts[(k + 1) % 6];
        const pair = k % 3;
        strokeArrows(ctx, a[0], a[1], b[0], b[1], colors[pair], senses[pair], 2);
      }
    }
  }
}

export function hitCell(px, py, canvas, lattice, w, h, fold, topology, wallpaper) {
  const rect = canvas.getBoundingClientRect();
  const x = (px - rect.left) * (canvas.width / rect.width);
  const y = (py - rect.top) * (canvas.height / rect.height);
  let uv;
  if (lattice === "hex") {
    const L = wallpaper
      ? { cx: canvas.width / 2, cy: canvas.height / 2, size: Math.min(canvas.width, canvas.height) / 6.2 }
      : layout("hex", canvas.width, canvas.height);
    const dx = x - L.cx;
    const dy = y - L.cy;
    if (!wallpaper && !inPointyHex(dx, dy, L.size)) return null;
    const [q, r] = hexToCell(dx, dy, L.size, w, h);
    uv = [q / w, r / h];
  } else if (wallpaper) {
    const tw = canvas.width / 3;
    const th = canvas.height / 3;
    const tx = Math.floor(x / tw);
    const ty = Math.floor(y / th);
    uv = applyCopy((x - tx * tw) / tw, (y - ty * th) / th, tx - 1, ty - 1, topology);
  } else {
    uv = [x / canvas.width, y / canvas.height];
  }
  const [cx, cy] = fold(Math.floor(uv[0] * w), Math.floor(uv[1] * h), w, h);
  return [cx, cy];
}
