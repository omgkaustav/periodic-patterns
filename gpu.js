const VERTEX = `#version 300 es
in vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }`;

const STEP = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform ivec2 uSize;
uniform int uModel;
uniform int uTopology;
uniform int uLattice;
uniform float uScale;
uniform float uP0;
uniform float uP1;
uniform float uP2;
uniform float uP3;
uniform float uP4;
uniform float uP5;
out vec4 nextState;

int imod(int n, int m) {
  return ((n % m) + m) % m;
}

ivec2 fold(ivec2 p) {
  int w = uSize.x;
  int h = uSize.y;
  int tx = int(floor(float(p.x) / float(w)));
  int ty = int(floor(float(p.y) / float(h)));
  int x = imod(p.x, w);
  int y = imod(p.y, h);
  if (uTopology == 1 && (ty & 1) == 1) x = w - 1 - x;
  if (uTopology == 2 && (tx & 1) == 1) y = h - 1 - y;
  if (uTopology == 3) {
    if ((ty & 1) == 1) x = w - 1 - x;
    if ((tx & 1) == 1) y = h - 1 - y;
  }
  if (uTopology == 4 && ((tx + ty) & 1) == 1) {
    x = w - 1 - x;
    y = h - 1 - y;
  }
  if (uTopology == 5 && (tx & 1) == 1) x = w - 1 - x;
  if (uTopology == 6 && (ty & 1) == 1) y = h - 1 - y;
  if (uTopology == 7) {
    if ((tx & 1) == 1) x = w - 1 - x;
    if ((ty & 1) == 1) y = h - 1 - y;
  }
  return ivec2(imod(x, w), imod(y, h));
}

vec2 at(int dx, int dy) {
  ivec2 c = fold(ivec2(gl_FragCoord.xy) + ivec2(dx, dy));
  return texelFetch(uState, c, 0).rg;
}

vec2 laplacian() {
  vec2 c = at(0, 0);
  if (uLattice != 0) {
    return (at(1, 0) + at(1, -1) + at(0, -1) + at(-1, 0) + at(-1, 1) + at(0, 1)) / 6.0 - c;
  }
  return at(1, 0) * 0.2 + at(-1, 0) * 0.2 + at(0, 1) * 0.2 + at(0, -1) * 0.2
    + at(1, 1) * 0.05 + at(1, -1) * 0.05 + at(-1, 1) * 0.05 + at(-1, -1) * 0.05
    - c;
}

void main() {
  vec2 c = at(0, 0);
  vec2 lap = laplacian() / max(0.04, uScale * uScale);
  float A = c.x;
  float B = c.y;
  vec2 n = c;
  if (uModel == 0) {
    float reac = A * B * B;
    n.x = clamp(A + uP2 * lap.x - reac + uP0 * (1.0 - A), 0.0, 1.0);
    n.y = clamp(B + uP3 * lap.y + reac - (uP1 + uP0) * B, 0.0, 1.0);
  } else if (uModel == 1) {
    n.x = A + uP5 * (uP2 * lap.x + A - (A * A * A) / 3.0 - B);
    n.y = B + uP5 * (uP3 * lap.y + (A + uP0 - uP1 * B) / max(0.2, uP4));
  } else if (uModel == 2) {
    float uth = (B + uP1) / max(0.05, uP0);
    n.x = clamp(A + uP5 * (uP2 * lap.x + (A * (1.0 - A) * (A - uth)) / max(0.004, uP4)), 0.0, 1.0);
    n.y = clamp(B + uP5 * (A - B), 0.0, 1.0);
  } else if (uModel == 3) {
    float u2v = A * A * B;
    n.x = max(0.0, A + uP5 * (uP2 * lap.x + uP0 - (uP1 + 1.0) * A + u2v));
    n.y = max(0.0, B + uP5 * (uP3 * lap.y + uP1 * A - u2v));
  } else if (uModel == 4) {
    float act = max(0.001, A);
    float inh = max(0.02, B);
    float aa = act * act;
    n.x = max(0.001, act + uP5 * (uP2 * lap.x + uP0 * (aa / inh) - uP1 * act));
    n.y = max(0.02, inh + uP5 * (uP3 * lap.y + uP0 * aa - uP4 * inh));
  } else if (uModel == 5) {
    n.x = A + uP5 * (uP2 * lap.x + A - A * A * A);
    n.y = B;
  } else if (uModel == 6) {
    float acc = uP0 * uP0 * lap.x - uP1 * B;
    n.y = B + acc;
    n.x = A + n.y;
  }
  nextState = vec4(n, 0.0, 1.0);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

function createProgram(gl, frag) {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program));
  }
  return program;
}

export const GPU_MODELS = {
  grayscott: 0,
};

export class GpuSim {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.gl = this.canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    if (!this.gl) return;
    const info = this.gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = info ? String(this.gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
    const software = /swiftshader|llvmpipe|softpipe|software/i.test(renderer);
    this.ok = !software && Boolean(this.gl.getExtension("EXT_color_buffer_float"));
    if (!this.ok) return;
    const gl = this.gl;
    try {
      this.program = createProgram(gl, STEP);
    } catch (error) {
      this.ok = false;
      console.warn("Periodic Patterns GPU path unavailable:", error);
      return;
    }
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.buf = buf;
    this.uniforms = {};
    for (const name of [
      "uState", "uSize", "uModel", "uTopology", "uLattice", "uScale",
      "uP0", "uP1", "uP2", "uP3", "uP4", "uP5",
    ]) {
      this.uniforms[name] = gl.getUniformLocation(this.program, name);
    }
    this.key = "";
  }

  supported() {
    return Boolean(this.gl && this.ok);
  }

  reset() {
    this.key = "";
    this.destroy();
  }

  destroy() {
    const gl = this.gl;
    if (!this.textures) return;
    this.textures.forEach((t) => gl.deleteTexture(t));
    this.framebuffers.forEach((f) => gl.deleteFramebuffer(f));
    this.textures = null;
  }

  ensure(w, h, a, b) {
    const key = `${w}x${h}`;
    if (this.key === key) return;
    this.destroy();
    const gl = this.gl;
    this.canvas.width = w;
    this.canvas.height = h;
    const data = new Float32Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = a[i];
      data[i * 4 + 1] = b[i];
      data[i * 4 + 3] = 1;
    }
    const textures = [0, 1].map((index) => {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, index === 0 ? data : null);
      return texture;
    });
    const framebuffers = textures.map((texture) => {
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      return fb;
    });
    this.textures = textures;
    this.framebuffers = framebuffers;
    this.index = 0;
    this.w = w;
    this.h = h;
    this.key = key;
  }

  upload(a, b) {
    const gl = this.gl;
    const data = new Float32Array(this.w * this.h * 4);
    for (let i = 0; i < this.w * this.h; i++) {
      data[i * 4] = a[i];
      data[i * 4 + 1] = b[i];
      data[i * 4 + 3] = 1;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.textures[this.index]);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.w, this.h, gl.RGBA, gl.FLOAT, data);
  }

  step(model, topology, lattice, scale, params, iterations) {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const loc = gl.getAttribLocation(this.program, "aPosition");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.viewport(0, 0, this.w, this.h);
    gl.uniform1i(this.uniforms.uState, 0);
    gl.uniform2i(this.uniforms.uSize, this.w, this.h);
    gl.uniform1i(this.uniforms.uModel, model);
    gl.uniform1i(this.uniforms.uTopology, topology);
    gl.uniform1i(this.uniforms.uLattice, lattice);
    gl.uniform1f(this.uniforms.uScale, scale);
    gl.uniform1f(this.uniforms.uP0, params[0]);
    gl.uniform1f(this.uniforms.uP1, params[1]);
    gl.uniform1f(this.uniforms.uP2, params[2]);
    gl.uniform1f(this.uniforms.uP3, params[3]);
    gl.uniform1f(this.uniforms.uP4, params[4]);
    gl.uniform1f(this.uniforms.uP5, params[5]);
    for (let i = 0; i < iterations; i++) {
      const dest = 1 - this.index;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[dest]);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[this.index]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.index = dest;
    }
  }

  read(a, b) {
    const gl = this.gl;
    const pixels = new Float32Array(this.w * this.h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[this.index]);
    gl.readPixels(0, 0, this.w, this.h, gl.RGBA, gl.FLOAT, pixels);
    for (let i = 0; i < this.w * this.h; i++) {
      a[i] = pixels[i * 4];
      b[i] = pixels[i * 4 + 1];
    }
  }
}

export function gpuParams(id, p) {
  if (id === "grayscott") return [p.f, p.k, p.Da * (p.dt ?? 1), p.Db * (p.dt ?? 1), 0, 1];
  return [0, 0, 0, 0, 0, 0];
}
