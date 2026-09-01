import { buildDisk, lapAt, applyCopy } from "./topology.js";

function fill(arr, value) {
  arr.fill(value);
}

function blobs(state, rng, count, radius, paint) {
  const { w, h, fold } = state;
  for (let n = 0; n < count; n++) {
    const cx = Math.floor(rng() * w);
    const cy = Math.floor(rng() * h);
    const rad = Math.max(2, Math.floor(radius * (0.5 + rng())));
    const rr = rad * rad;
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (dx * dx + dy * dy > rr) continue;
        const [x, y] = fold(cx + dx, cy + dy, w, h);
        paint(y * w + x, rng);
      }
    }
  }
}

export function paintDisk(state, cx, cy, radius, paint) {
  const { w, h, fold } = state;
  const rad = Math.max(1, Math.round(radius));
  for (let dy = -rad; dy <= rad; dy++) {
    for (let dx = -rad; dx <= rad; dx++) {
      if (dx * dx + dy * dy > rad * rad) continue;
      const [x, y] = fold(cx + dx, cy + dy, w, h);
      paint(y * w + x);
    }
  }
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function param(p, id, fallback) {
  const value = p[id];
  return value == null ? fallback : value;
}

function lapGain(p) {
  const scale = Math.max(0.2, param(p, "scale", 1));
  return 1 / (scale * scale);
}

function lap(src, i, neighbors, p) {
  return lapAt(src, i, neighbors) * lapGain(p);
}

function sampleA(state, i) {
  return clamp01(state.a[i]);
}

function sampleB(state, i) {
  return clamp01(state.b[i]);
}

export const GENERATORS = [
  {
    id: "grayscott",
    name: "Gray–Scott reaction–diffusion",
    channels: "ab",
    defaultView: "b",
    params: [
      { id: "f", name: "Feed", min: 0.01, max: 0.08, step: 0.0001, value: 0.055, title: "Rate at which A is replenished. Lower feed favors spots; higher feed favors worms, mazes, and coral." },
      { id: "k", name: "Kill", min: 0.03, max: 0.08, step: 0.0001, value: 0.062, title: "Rate at which B is removed. Together with feed this picks the Gray–Scott pattern (spots, worms, maze, coral)." },
      { id: "Da", name: "DA", min: 0.05, max: 1.2, step: 0.01, value: 1, title: "Diffusion rate of A (the activator substrate). Larger DA blurs A farther across the tile." },
      { id: "Db", name: "DB", min: 0.05, max: 1.2, step: 0.01, value: 0.5, title: "Diffusion rate of B (the inhibitor). B should usually spread less or more than A; the ratio sets the spot size." },
      { id: "dt", name: "dt", min: 0.2, max: 1.4, step: 0.01, value: 1, title: "Time step of the integrator. Higher is faster but can blow up; 1 is the usual Pearson step." },
      { id: "spots", name: "Seed spots", min: 4, max: 40, step: 1, value: 18, title: "How many random blobs of B are planted at restart." },
      { id: "spotRadius", name: "Spot radius", min: 1, max: 16, step: 1, value: 5, title: "Radius in cells of each seed blob." },
      { id: "noiseAmt", name: "Init noise", min: 0, max: 0.4, step: 0.01, value: 0.04, title: "Random variation inside each seed blob so the pattern does not start perfectly round." },
    ],
    presets: {
      coral: { f: 0.0545, k: 0.062 },
      spots: { f: 0.035, k: 0.065 },
      worms: { f: 0.054, k: 0.063 },
      maze: { f: 0.029, k: 0.057 },
      holes: { f: 0.039, k: 0.058 },
      mitosis: { f: 0.0367, k: 0.0649 },
      pulsating: { f: 0.026, k: 0.061 },
    },
    init(state, p = {}) {
      fill(state.a, 1);
      fill(state.b, 0);
      const spots = Math.round(param(p, "spots", 18));
      const radius = Math.round(param(p, "spotRadius", 5));
      const noiseAmt = param(p, "noiseAmt", 0.04);
      blobs(state, state.rng, spots, radius, (i, rng) => {
        state.a[i] = rng() * (0.04 + noiseAmt);
        state.b[i] = 0.85 + rng() * 0.15;
      });
    },
    step(state, p) {
      const { a, b, tmpA, tmpB, n, neighbors } = state;
      const f = param(p, "f", 0.055);
      const k = param(p, "k", 0.062);
      const Da = param(p, "Da", 1);
      const Db = param(p, "Db", 0.5);
      const dt = param(p, "dt", 1);
      for (let i = 0; i < n; i++) {
        const ai = a[i];
        const bi = b[i];
        const reac = ai * bi * bi;
        tmpA[i] = clamp01(ai + dt * (Da * lap(a, i, neighbors, p) - reac + f * (1 - ai)));
        tmpB[i] = clamp01(bi + dt * (Db * lap(b, i, neighbors, p) + reac - (k + f) * bi));
      }
      a.set(tmpA);
      b.set(tmpB);
    },
    sample: sampleB,
    paint(state, i) {
      state.a[i] = 0.04;
      state.b[i] = 1;
    },
  },
  {
    id: "kuramoto",
    name: "Lattice Kuramoto",
    channels: "a",
    defaultView: "a",
    params: [
      { id: "K", name: "coupling K", min: 0, max: 2, step: 0.01, value: 0.35, title: "How strongly each oscillator is pulled toward its neighbors. High K locks the tile into spirals or a single phase." },
      { id: "spread", name: "ω spread", min: 0, max: 1, step: 0.01, value: 0.15, title: "Random natural-frequency spread. More spread fights the coupling and keeps the pattern moving." },
      { id: "dt", name: "dt", min: 0.02, max: 0.4, step: 0.01, value: 0.12, title: "Time step for the phase update." },
    ],
    init(state) {
      for (let i = 0; i < state.n; i++) {
        state.a[i] = state.rng() * Math.PI * 2;
        state.b[i] = state.rng() * 2 - 1;
      }
    },
    step(state, p) {
      const { a, b, tmpA, n, neighbors } = state;
      const K = param(p, "K", 0.35);
      const spread = param(p, "spread", 0.15);
      const dt = param(p, "dt", 0.12);
      const { idx, count } = neighbors;
      for (let i = 0; i < n; i++) {
        const base = i * count;
        const th = a[i];
        let s = 0;
        for (let k = 0; k < count; k++) s += Math.sin(a[idx[base + k]] - th);
        tmpA[i] = th + dt * (spread * b[i] + K * s);
      }
      a.set(tmpA);
    },
    sample(state, i) {
      return clamp01(0.5 + 0.5 * Math.sin(state.a[i]));
    },
    paint(state, i) {
      state.a[i] += 1.2;
    },
  },
  {
    id: "young",
    name: "Young activator–inhibitor",
    channels: "a",
    defaultView: "a",
    params: [
      { id: "rA", name: "activator radius", min: 1, max: 6, step: 1, value: 2, title: "Radius of the short-range activating neighborhood, in cells." },
      { id: "rI", name: "inhibitor radius", min: 2, max: 12, step: 1, value: 5, title: "Radius of the long-range inhibiting neighborhood. Should be larger than the activator radius." },
      { id: "wI", name: "inhibitor weight", min: 0.1, max: 2, step: 0.01, value: 0.85, title: "How strongly the outer ring suppresses growth. Higher weight yields sparser spots." },
      { id: "thresh", name: "threshold", min: -1, max: 1, step: 0.01, value: 0, title: "Bias on the activator-minus-inhibitor score. Raise it to make more of the tile die off." },
    ],
    init(state) {
      for (let i = 0; i < state.n; i++) state.a[i] = state.rng() < 0.45 ? 1 : 0;
    },
    step(state, p) {
      const { a, tmpA, n, w, h, fold, lattice } = state;
      const rA = Math.round(param(p, "rA", 2));
      const rI = Math.round(param(p, "rI", 5));
      const wI = param(p, "wI", 0.85);
      const thresh = param(p, "thresh", 0);
      const key = `${rA}:${rI}:${lattice}:${state.topology}:${w}x${h}`;
      const heavy = n > 256 * 256;
      if (!heavy && state.youngKey !== key) {
        const disk = buildDisk(rI, lattice);
        const actOff = [];
        const inhOff = [];
        for (let k = 0; k < disk.length; k++) {
          if (disk[k][2] <= rA) actOff.push(disk[k]);
          else inhOff.push(disk[k]);
        }
        const actIdx = new Int32Array(n * actOff.length);
        const inhIdx = new Int32Array(n * inhOff.length);
        for (let i = 0; i < n; i++) {
          const cx = i % w;
          const cy = (i / w) | 0;
          const ab = i * actOff.length;
          const ib = i * inhOff.length;
          for (let k = 0; k < actOff.length; k++) {
            const [x, y] = fold(cx + actOff[k][0], cy + actOff[k][1], w, h);
            actIdx[ab + k] = y * w + x;
          }
          for (let k = 0; k < inhOff.length; k++) {
            const [x, y] = fold(cx + inhOff[k][0], cy + inhOff[k][1], w, h);
            inhIdx[ib + k] = y * w + x;
          }
        }
        state.young = { actIdx, inhIdx, nA: actOff.length, nI: inhOff.length, actOff, inhOff };
        state.youngKey = key;
      }
      if (heavy) {
        const disk = state.youngKey === key ? state.young : null;
        const built = disk || (() => {
          const d = buildDisk(rI, lattice);
          const actOff = [];
          const inhOff = [];
          for (let k = 0; k < d.length; k++) {
            if (d[k][2] <= rA) actOff.push(d[k]);
            else inhOff.push(d[k]);
          }
          state.young = { actOff, inhOff, nA: actOff.length, nI: inhOff.length };
          state.youngKey = key;
          return state.young;
        })();
        const { actOff, inhOff, nA, nI } = built;
        for (let i = 0; i < n; i++) {
          const cx = i % w;
          const cy = (i / w) | 0;
          let act = 0;
          let inh = 0;
          for (let k = 0; k < nA; k++) {
            const [x, y] = fold(cx + actOff[k][0], cy + actOff[k][1], w, h);
            act += a[y * w + x];
          }
          for (let k = 0; k < nI; k++) {
            const [x, y] = fold(cx + inhOff[k][0], cy + inhOff[k][1], w, h);
            inh += a[y * w + x];
          }
          tmpA[i] = act / Math.max(1, nA) - wI * (inh / Math.max(1, nI)) > thresh ? 1 : 0;
        }
      } else {
        const { actIdx, inhIdx, nA, nI } = state.young;
        for (let i = 0; i < n; i++) {
          let act = 0;
          let inh = 0;
          const ab = i * nA;
          const ib = i * nI;
          for (let k = 0; k < nA; k++) act += a[actIdx[ab + k]];
          for (let k = 0; k < nI; k++) inh += a[inhIdx[ib + k]];
          tmpA[i] = act / Math.max(1, nA) - wI * (inh / Math.max(1, nI)) > thresh ? 1 : 0;
        }
      }
      a.set(tmpA);
    },
    sample: sampleA,
    paint(state, i) {
      state.a[i] = 1;
    },
  },
  {
    id: "flow",
    name: "Periodic flow field",
    channels: "ab",
    defaultView: "a",
    params: [
      { id: "modes", name: "Modes", min: 3, max: 16, step: 1, value: 8, title: "How many random swirls are summed into the stream function. More modes look busier." },
      { id: "length", name: "LIC length", min: 4, max: 28, step: 1, value: 14, title: "How far the line-integral convolution walks along the flow. Longer walks make silkier streaks." },
      { id: "swirl", name: "Swirl", min: 0.2, max: 2.5, step: 0.05, value: 1, title: "Amplitude of the stream function. Higher swirl packs tighter curls." },
      { id: "speed", name: "Drift", min: 0, max: 0.08, step: 0.001, value: 0.02, title: "How fast the contour phase slides along the streamlines." },
    ],
    init(state, p = {}) {
      const { a, b, tmpA, tmpB, n, w, h, fold, neighbors, rng, topology } = state;
      const modes = Math.round(param(p, "modes", 8));
      const length = Math.round(param(p, "length", 14));
      const swirl = param(p, "swirl", 1);
      const scale = Math.max(0.2, param(p, "scale", 1));
      fill(tmpA, 0);
      for (let m = 0; m < modes; m++) {
        const cx = rng() * w;
        const cy = rng() * h;
        const amp = (rng() * 2 - 1) * swirl;
        const sig = (0.12 + rng() * 0.28) * Math.min(w, h) / scale;
        const sig2 = 2 * sig * sig;
        for (let i = 0; i < n; i++) {
          const x = i % w;
          const y = (i / w) | 0;
          let best = 1e12;
          for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
              let u = cx / w;
              let v = cy / h;
              [u, v] = applyCopy(u, v, ox, oy, topology);
              const px = (u + ox) * w;
              const py = (v + oy) * h;
              const dx = x - px;
              const dy = y - py;
              const d2 = dx * dx + dy * dy;
              if (d2 < best) best = d2;
            }
          }
          tmpA[i] += amp * Math.exp(-best / sig2);
        }
      }
      const { idx, count } = neighbors;
      const vx = tmpB;
      const vy = b;
      for (let i = 0; i < n; i++) {
        const base = i * count;
        let gx = 0;
        let gy = 0;
        if (count === 8) {
          gx = (tmpA[idx[base]] - tmpA[idx[base + 1]]) * 0.5;
          gy = (tmpA[idx[base + 2]] - tmpA[idx[base + 3]]) * 0.5;
        } else {
          gx = (tmpA[idx[base]] - tmpA[idx[base + 3]]) * 0.5;
          gy = (tmpA[idx[base + 2]] - tmpA[idx[base + 5]]) * 0.5;
        }
        vx[i] = gy;
        vy[i] = -gx;
      }
      for (let i = 0; i < n; i++) {
        const mag = Math.hypot(vx[i], vy[i]) + 1e-6;
        vx[i] /= mag;
        vy[i] /= mag;
      }
      const noise = new Float32Array(n);
      for (let i = 0; i < n; i++) noise[i] = rng();
      const steps = Math.max(4, length);
      const psi = new Float32Array(tmpA);
      for (let i = 0; i < n; i++) {
        let acc = noise[i];
        let hits = 1;
        let px = i % w;
        let py = (i / w) | 0;
        for (let dir = -1; dir <= 1; dir += 2) {
          let x = px;
          let y = py;
          for (let s = 0; s < steps; s++) {
            const [qx, qy] = fold(Math.round(x), Math.round(y), w, h);
            const j = qy * w + qx;
            x = qx + dir * vx[j];
            y = qy + dir * vy[j];
            const [sx, sy] = fold(Math.round(x), Math.round(y), w, h);
            acc += noise[sy * w + sx];
            hits++;
            x = sx;
            y = sy;
          }
        }
        a[i] = acc / hits;
      }
      let min = 1e9;
      let max = -1e9;
      for (let i = 0; i < n; i++) {
        if (a[i] < min) min = a[i];
        if (a[i] > max) max = a[i];
      }
      const span = max - min || 1;
      for (let i = 0; i < n; i++) {
        a[i] = (a[i] - min) / span;
        b[i] = psi[i];
      }
      state.flowT = 0;
    },
    step(state, p) {
      state.flowT = (state.flowT || 0) + param(p, "speed", 0.02);
    },
    sample(state, i) {
      const wave = 0.5 + 0.5 * Math.sin((state.b[i] || 0) * 2.4 + (state.flowT || 0) * 8);
      return clamp01(state.a[i] * 0.62 + wave * 0.38);
    },
    paint(state, i) {
      state.a[i] = 1;
    },
  },
];

export const GENERATOR_BY_ID = Object.fromEntries(GENERATORS.map((item) => [item.id, item]));
