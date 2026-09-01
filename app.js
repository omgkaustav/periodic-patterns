import { TOPOLOGIES, TOPOLOGY_BY_ID, TOPOLOGY_INDEX, LATTICE_INDEX, buildNeighbors, mulberry } from "./topology.js";
import { GENERATORS, GENERATOR_BY_ID, paintDisk } from "./generators.js";
import { drawUnit, drawWallpaper, drawEdgeOverlay, hitCell } from "./render.js";
import { GPU_MODELS, GpuSim, gpuParams } from "./gpu.js";

const $ = (id) => document.getElementById(id);

const tileCanvas = $("tile");
const wallCanvas = $("wall");
const tileCtx = tileCanvas.getContext("2d", { alpha: false });
const wallCtx = wallCanvas.getContext("2d", { alpha: false });

const ui = {
  lattice: $("lattice"),
  topology: $("topology"),
  generator: $("generator"),
  preset: $("preset"),
  presetControl: $("presetControl"),
  size: $("size"),
  seed: $("seed"),
  seedOut: $("seedOut"),
  scale: $("scale"),
  scaleOut: $("scaleOut"),
  speed: $("speed"),
  speedOut: $("speedOut"),
  brush: $("brush"),
  brushOut: $("brushOut"),
  view: $("view"),
  palette: $("palette"),
  contrast: $("contrast"),
  contrastOut: $("contrastOut"),
  invert: $("invert"),
  thresholdOn: $("thresholdOn"),
  thresholdControl: $("thresholdControl"),
  cutoff: $("cutoff"),
  cutoffOut: $("cutoffOut"),
  params: $("params"),
  run: $("run"),
  latticeNote: $("latticeNote"),
  gpuDot: $("gpuDot"),
  gpuLabel: $("gpuLabel"),
  tileMeta: $("tileMeta"),
  stepMeta: $("stepMeta"),
  statusTile: $("statusTile"),
  gridButton: $("gridButton"),
};

const LATTICE_NOTES = {
  square: "The fundamental domain is a square. Wallpaper is a 3 × 3 of copies.",
  hex: "The fundamental domain is a hexagon. Wallpaper is the hexagonal lattice; opposite sides are one period apart.",
};

for (const item of TOPOLOGIES) {
  const option = document.createElement("option");
  option.value = item.id;
  option.textContent = item.name;
  ui.topology.appendChild(option);
}
for (const item of GENERATORS) {
  const option = document.createElement("option");
  option.value = item.id;
  option.textContent = item.name;
  ui.generator.appendChild(option);
}

const gpu = new GpuSim();
const state = {
  w: 256,
  h: 256,
  n: 256 * 256,
  lattice: "square",
  topology: "torus",
  fold: TOPOLOGY_BY_ID.torus.fold,
  neighbors: null,
  a: new Float32Array(256 * 256),
  b: new Float32Array(256 * 256),
  tmpA: new Float32Array(256 * 256),
  tmpB: new Float32Array(256 * 256),
  cell: new Uint8Array(256 * 256),
  tmpCell: new Uint8Array(256 * 256),
  rng: mulberry(1),
  steps: 0,
};

let running = true;
let paramValues = {};
let painting = false;
let gpuDirty = true;
let showGrid = false;
let restartTimer = 0;

function currentGenerator() {
  return GENERATOR_BY_ID[ui.generator.value];
}

function usesGpu(gen) {
  return gpu.supported() && GPU_MODELS[gen.id] != null;
}

function digitsFor(step) {
  if (step >= 1) return 0;
  const part = String(step).split(".")[1];
  return part ? part.length : 2;
}

function readParams() {
  const values = { scale: Number(ui.scale.value) };
  for (const input of ui.params.querySelectorAll("input, select")) {
    values[input.dataset.id] = Number(input.value);
    const out = document.getElementById(`p-out-${input.dataset.id}`);
    if (out) out.textContent = Number(input.value).toFixed(digitsFor(Number(input.step) || 1));
  }
  paramValues = values;
  return values;
}

function scheduleRestart() {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => restart(), 140);
}

function buildParamControls() {
  const gen = currentGenerator();
  ui.params.innerHTML = "";
  paramValues = { scale: Number(ui.scale.value) };
  for (const spec of gen.params) {
    paramValues[spec.id] = spec.value;
    const label = document.createElement("label");
    label.className = "control";
    if (spec.title) label.title = spec.title;
    const out = document.createElement("output");
    out.id = `p-out-${spec.id}`;
    out.textContent = spec.value.toFixed(digitsFor(spec.step));
    const span = document.createElement("span");
    span.append(spec.name + " ", out);
    const input = document.createElement("input");
    input.type = "range";
    input.min = spec.min;
    input.max = spec.max;
    input.step = spec.step;
    input.value = spec.value;
    input.dataset.id = spec.id;
    if (spec.title) input.title = spec.title;
    input.addEventListener("input", () => {
      readParams();
      scheduleRestart();
    });
    label.append(span, input);
    ui.params.appendChild(label);
  }
  const presets = gen.presets ? Object.keys(gen.presets) : [];
  ui.preset.innerHTML = "";
  ui.presetControl.hidden = presets.length === 0;
  if (presets.length) {
    for (const name of presets) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      ui.preset.appendChild(option);
    }
    applyPreset(ui.preset.value, false);
  }
  if ([...ui.view.options].some((option) => option.value === (gen.defaultView || "a"))) {
    ui.view.value = gen.defaultView || "a";
  }
}

function applyPreset(name, restartSim) {
  const preset = currentGenerator().presets?.[name];
  if (!preset) return;
  for (const input of ui.params.querySelectorAll("input")) {
    if (preset[input.dataset.id] != null) input.value = preset[input.dataset.id];
  }
  readParams();
  if (restartSim) restart();
}

function allocate(n) {
  state.w = n;
  state.h = n;
  state.n = n * n;
  state.a = new Float32Array(state.n);
  state.b = new Float32Array(state.n);
  state.tmpA = new Float32Array(state.n);
  state.tmpB = new Float32Array(state.n);
  state.cell = new Uint8Array(state.n);
  state.tmpCell = new Uint8Array(state.n);
  state.youngKey = "";
  state.young = null;
  gpu.reset();
}

function bindTopology() {
  state.lattice = ui.lattice.value;
  state.topology = ui.topology.value;
  state.fold = TOPOLOGY_BY_ID[state.topology].fold;
  state.neighbors = buildNeighbors(state.w, state.h, state.lattice, state.fold);
  ui.latticeNote.textContent = LATTICE_NOTES[state.lattice];
}

function restart() {
  clearTimeout(restartTimer);
  const size = Number(ui.size.value) || 256;
  if (state.w !== size) allocate(size);
  bindTopology();
  const seed = Number(ui.seed.value) || 1;
  ui.seedOut.textContent = String(seed);
  state.rng = mulberry(seed);
  state.steps = 0;
  state.nstates = undefined;
  const params = readParams();
  currentGenerator().init(state, params);
  gpuDirty = true;
  draw();
}

function valueAt(i) {
  const gen = currentGenerator();
  const view = ui.view.value;
  if (view === "b" && gen.channels === "ab") return Math.min(1, Math.max(0, state.b[i]));
  if (view === "mix" && gen.channels === "ab") {
    return Math.min(1, Math.max(0, 0.5 + (state.a[i] - state.b[i]) * 0.5));
  }
  return gen.sample(state, i, paramValues);
}

function draw() {
  const gen = currentGenerator();
  const opts = {
    lattice: state.lattice,
    w: state.w,
    h: state.h,
    fold: state.fold,
    valueAt,
    contrast: Number(ui.contrast.value),
    invert: ui.invert.checked,
    palette: ui.palette.value,
    topology: state.topology,
    thresholdOn: ui.thresholdOn.checked,
    cutoff: Number(ui.cutoff.value),
  };
  drawUnit(tileCtx, opts);
  drawWallpaper(wallCtx, tileCanvas, opts);
  if (showGrid) {
    drawEdgeOverlay(tileCtx, { ...opts, mode: "unit" });
    drawEdgeOverlay(wallCtx, { ...opts, mode: "wall" });
  }
  const top = TOPOLOGY_BY_ID[state.topology];
  const gpuOn = usesGpu(gen);
  ui.gpuDot.classList.toggle("warn", !gpuOn);
  ui.gpuLabel.textContent = gpuOn ? "GPU" : "CPU";
  ui.statusTile.textContent = `${gen.name.split(" ")[0]} · ${state.lattice}`;
  ui.tileMeta.textContent = `${state.w} × ${state.h} · ${top.name.split(" — ")[0]}`;
  ui.stepMeta.textContent = `${state.steps} steps`;
}

function tick() {
  const gen = currentGenerator();
  const params = readParams();
  params.scale = Number(ui.scale.value);
  const steps = Number(ui.speed.value);
  if (usesGpu(gen)) {
    gpu.ensure(state.w, state.h, state.a, state.b);
    if (gpuDirty) {
      gpu.upload(state.a, state.b);
      gpuDirty = false;
    }
    gpu.step(
      GPU_MODELS[gen.id],
      TOPOLOGY_INDEX[state.topology],
      LATTICE_INDEX[state.lattice],
      params.scale,
      gpuParams(gen.id, params),
      steps,
    );
    gpu.read(state.a, state.b);
    state.steps += steps;
  } else {
    const n = gen.id === "young" ? Math.min(steps, 2) : gen.id === "flow" ? 1 : steps;
    for (let i = 0; i < n; i++) {
      gen.step(state, params);
      state.steps++;
    }
  }
  draw();
}

function loop() {
  if (running) tick();
  requestAnimationFrame(loop);
}

function paintEvent(event, canvas) {
  const gen = currentGenerator();
  const hit = hitCell(event.clientX, event.clientY, canvas, state.lattice, state.w, state.h, state.fold, state.topology, canvas === wallCanvas);
  if (!hit) return;
  paintDisk(state, hit[0], hit[1], Number(ui.brush.value), (i) => gen.paint(state, i));
  gpuDirty = true;
  draw();
}

function download(canvas, name) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}

ui.lattice.addEventListener("change", restart);
ui.topology.addEventListener("change", restart);
ui.generator.addEventListener("change", () => {
  buildParamControls();
  restart();
});
ui.preset.addEventListener("change", () => applyPreset(ui.preset.value, true));
ui.size.addEventListener("change", restart);
ui.seed.addEventListener("change", restart);
ui.scale.addEventListener("input", () => {
  ui.scaleOut.textContent = Number(ui.scale.value).toFixed(2);
  scheduleRestart();
});
ui.speed.addEventListener("input", () => {
  ui.speedOut.textContent = ui.speed.value;
});
$("speedMax").addEventListener("click", () => {
  ui.speed.value = ui.speed.max;
  ui.speedOut.textContent = ui.speed.value;
});
ui.brush.addEventListener("input", () => {
  ui.brushOut.textContent = ui.brush.value;
});
ui.contrast.addEventListener("input", () => {
  ui.contrastOut.textContent = Number(ui.contrast.value).toFixed(2);
  draw();
});
ui.view.addEventListener("change", draw);
ui.palette.addEventListener("change", draw);
ui.invert.addEventListener("change", draw);
ui.thresholdOn.addEventListener("change", () => {
  ui.thresholdControl.hidden = !ui.thresholdOn.checked;
  draw();
});
ui.cutoff.addEventListener("input", () => {
  ui.cutoffOut.textContent = Number(ui.cutoff.value).toFixed(2);
  draw();
});
ui.gridButton.addEventListener("click", () => {
  showGrid = !showGrid;
  ui.gridButton.classList.toggle("active", showGrid);
  ui.gridButton.setAttribute("aria-pressed", String(showGrid));
  draw();
});

$("run").addEventListener("click", () => {
  running = !running;
  ui.run.textContent = running ? "Pause" : "Run";
});
$("step").addEventListener("click", () => {
  if (running) {
    running = false;
    ui.run.textContent = "Run";
  }
  const gen = currentGenerator();
  const params = readParams();
  if (usesGpu(gen)) {
    gpu.ensure(state.w, state.h, state.a, state.b);
    if (gpuDirty) gpu.upload(state.a, state.b);
    gpu.step(GPU_MODELS[gen.id], TOPOLOGY_INDEX[state.topology], LATTICE_INDEX[state.lattice], params.scale, gpuParams(gen.id, params), 1);
    gpu.read(state.a, state.b);
    gpuDirty = false;
  } else {
    gen.step(state, params);
  }
  state.steps++;
  draw();
});
$("restart").addEventListener("click", restart);
$("random").addEventListener("click", () => {
  ui.seed.value = String(Math.floor(Math.random() * 999999));
  restart();
});
$("resetButton").addEventListener("click", () => {
  ui.lattice.value = "square";
  ui.topology.value = "torus";
  ui.generator.value = "grayscott";
  ui.scale.value = "1";
  ui.scaleOut.textContent = "1.00";
  ui.size.value = "256";
  ui.seed.value = "1";
  ui.speed.value = "8";
  ui.speedOut.textContent = "8";
  ui.contrast.value = "1.15";
  ui.thresholdOn.checked = false;
  ui.thresholdControl.hidden = true;
  buildParamControls();
  restart();
});
$("png-tile").addEventListener("click", () => {
  download(tileCanvas, `periodic-tile-${state.lattice}-${state.topology}.png`);
});
$("png-wall").addEventListener("click", () => {
  download(wallCanvas, `periodic-wallpaper-${state.lattice}-${state.topology}.png`);
});

function attachPaint(canvas) {
  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    painting = true;
    paintEvent(event, canvas);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!painting) return;
    paintEvent(event, canvas);
  });
  canvas.addEventListener("pointerup", () => {
    painting = false;
  });
  canvas.addEventListener("pointercancel", () => {
    painting = false;
  });
}
attachPaint(tileCanvas);
attachPaint(wallCanvas);

ui.scaleOut.textContent = Number(ui.scale.value).toFixed(2);
ui.speedOut.textContent = ui.speed.value;
ui.brushOut.textContent = ui.brush.value;
ui.contrastOut.textContent = Number(ui.contrast.value).toFixed(2);
ui.cutoffOut.textContent = Number(ui.cutoff.value).toFixed(2);

const query = new URLSearchParams(location.search);
if (query.get("lattice")) ui.lattice.value = query.get("lattice");
if (query.get("topology")) ui.topology.value = query.get("topology");
if (query.get("generator")) ui.generator.value = query.get("generator");
if (query.get("size")) ui.size.value = query.get("size");
if (query.get("seed")) ui.seed.value = query.get("seed");
if (query.get("grid") === "1") {
  showGrid = true;
  ui.gridButton.classList.add("active");
  ui.gridButton.setAttribute("aria-pressed", "true");
}
if (query.get("pause") === "1") {
  running = false;
  ui.run.textContent = "Run";
}

try {
  buildParamControls();
  restart();
  loop();
} catch (error) {
  document.title = "ERR " + error.message;
  console.error(error);
  throw error;
}
