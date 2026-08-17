// WebGL2 drawing: the field on one canvas, its sixteen channels on another.
// The sixteen channels live in one float texture laid out as four rgba tiles.

import { BASE, CELL, RING } from "./sim.js?v=40";

const QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
const TILES = CELL / 4;

const VERT = `#version 300 es
in vec2 spot;
uniform vec4 frame;   // x, y, width, height in clip space
out vec2 uv;
void main() {
  uv = spot * 0.5 + 0.5;
  gl_Position = vec4(frame.xy + (spot * 0.5 + 0.5) * frame.zw, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D field;
uniform int channel;     // -1 draws the picture, otherwise a single channel
uniform vec3 low, high;  // the two ends of the warm ramp
out vec4 colour;

// viridis, as a polynomial fit rather than a lookup table
vec3 viridis(float t) {
  const vec3 c0 = vec3(0.2777, 0.0054, 0.3341);
  const vec3 c1 = vec3(0.1050, 1.4046, 1.3845);
  const vec3 c2 = vec3(-0.3308, 0.2148, 0.0952);
  const vec3 c3 = vec3(-4.6342, -5.7991, -19.3324);
  const vec3 c4 = vec3(6.2282, 14.1799, 56.6905);
  const vec3 c5 = vec3(4.7763, -13.7451, -65.3532);
  const vec3 c6 = vec3(-5.4354, 4.6459, 26.3124);
  return c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * (c5 + t * c6)))));
}

vec4 fetch(int tile) {
  vec2 at = vec2((uv.x + float(tile)) / ${TILES}.0, 1.0 - uv.y);
  return texture(field, at);
}

void main() {
  if (channel < 0) {
    vec3 rgb = fetch(0).rgb;
    colour = vec4(clamp(rgb * 0.5 + 0.5, 0.0, 1.0), 1.0);
  } else {
    vec4 tile = fetch(channel / 4);
    float v = tile[channel % 4];
    colour = vec4(viridis(clamp(v * 0.5 + 0.5, 0.0, 1.0)), 1.0);
  }
}`;

const ANT_VERT = `#version 300 es
in vec2 spot;
void main() {
  gl_Position = vec4(spot, 0.0, 1.0);
}`;

const ANT_FRAG = `#version 300 es
precision highp float;
uniform vec4 tint;
out vec4 colour;
void main() {
  colour = tint;
}`;

function build(gl, vert, frag) {
  const make = (kind, src) => {
    const part = gl.createShader(kind);
    gl.shaderSource(part, src);
    gl.compileShader(part);
    if (!gl.getShaderParameter(part, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(part));
    }
    return part;
  };

  const program = gl.createProgram();
  gl.attachShader(program, make(gl.VERTEX_SHADER, vert));
  gl.attachShader(program, make(gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program));
  }
  return program;
}

export class View {
  constructor(canvas, { ramp }) {
    const gl = canvas.getContext("webgl2", { antialias: false });
    if (!gl) throw new Error("this browser has no WebGL2");
    this.gl = gl;
    this.canvas = canvas;
    this.ramp = ramp;

    this.field = build(gl, VERT, FRAG);
    this.antly = build(gl, ANT_VERT, ANT_FRAG);

    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
    this.dots = gl.createBuffer();

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    for (const edge of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) {
      gl.texParameteri(gl.TEXTURE_2D, edge, gl.CLAMP_TO_EDGE);
    }
    for (const filter of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) {
      gl.texParameteri(gl.TEXTURE_2D, filter, gl.NEAREST);
    }
    this.size = 0;
    this.setSize(BASE);
  }

  // the field can grow when the view zooms out, and a webgl texture cannot be
  // resized in place, so make a new one whenever the count of cells changes
  setSize(size) {
    if (size === this.size) return;
    const gl = this.gl;
    if (this.size) {
      gl.deleteTexture(this.texture);
      this.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      for (const edge of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) {
        gl.texParameteri(gl.TEXTURE_2D, edge, gl.CLAMP_TO_EDGE);
      }
      for (const filter of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) {
        gl.texParameteri(gl.TEXTURE_2D, filter, gl.NEAREST);
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, size * TILES, size);
    this.packed = new Float32Array(size * size * CELL);
    this.size = size;
  }

  // rearrange the field into four side by side rgba tiles
  upload(field, size = this.size) {
    this.setSize(size);
    const SIZE = this.size;
    const packed = this.packed;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const from = (y * SIZE + x) * CELL;
        for (let tile = 0; tile < TILES; tile++) {
          const to = (y * SIZE * TILES + tile * SIZE + x) * 4;
          for (let c = 0; c < 4; c++) packed[to + c] = field[from + tile * 4 + c];
        }
      }
    }

    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texSubImage2D(
      gl.TEXTURE_2D, 0, 0, 0, SIZE * TILES, SIZE, gl.RGBA, gl.FLOAT, packed
    );
  }

  panel(frame, channel) {
    const gl = this.gl;
    gl.useProgram(this.field);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const spot = gl.getAttribLocation(this.field, "spot");
    gl.enableVertexAttribArray(spot);
    gl.vertexAttribPointer(spot, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(gl.getUniformLocation(this.field, "field"), 0);
    gl.uniform1i(gl.getUniformLocation(this.field, "channel"), channel);
    gl.uniform4fv(gl.getUniformLocation(this.field, "frame"), frame);
    gl.uniform3fv(gl.getUniformLocation(this.field, "low"), this.ramp[0]);
    gl.uniform3fv(gl.getUniformLocation(this.field, "high"), this.ramp[1]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // one little triangle per ant, pointing where it is about to step
  ants(list, tint, cells, alpha) {
    if (!list.length) return;
    const gl = this.gl;
    const SIZE = this.size;
    const reach = (cells / SIZE) * 2; // clip space size of one cell, times cells
    const verts = new Float32Array(list.length * 6);

    list.forEach((ant, i) => {
      const cx = ((ant.x + 0.5) / SIZE) * 2 - 1;
      const cy = 1 - ((ant.y + 0.5) / SIZE) * 2;
      const [rx, ry] = RING[ant.heading];
      const fx = rx * reach;
      const fy = -ry * reach; // clip space y runs the other way
      const sx = -fy * 0.62;  // sideways
      const sy = fx * 0.62;

      const at = i * 6;
      verts[at] = cx + fx;              // the tip
      verts[at + 1] = cy + fy;
      verts[at + 2] = cx - fx * 0.6 + sx;
      verts[at + 3] = cy - fy * 0.6 + sy;
      verts[at + 4] = cx - fx * 0.6 - sx;
      verts[at + 5] = cy - fy * 0.6 - sy;
    });

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.antly);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dots);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
    const spot = gl.getAttribLocation(this.antly, "spot");
    gl.enableVertexAttribArray(spot);
    gl.vertexAttribPointer(spot, 2, gl.FLOAT, false, 0, 0);
    gl.uniform4f(
      gl.getUniformLocation(this.antly, "tint"), tint[0], tint[1], tint[2], alpha
    );
    gl.drawArrays(gl.TRIANGLES, 0, list.length * 3);
    gl.disable(gl.BLEND);
  }

  fit() {
    const gl = this.gl;
    const box = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const wide = Math.round(box.width * dpr);
    const tall = Math.round(box.height * dpr);
    if (this.canvas.width !== wide || this.canvas.height !== tall) {
      this.canvas.width = wide;
      this.canvas.height = tall;
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }
}

export { TILES };
