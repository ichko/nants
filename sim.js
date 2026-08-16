// The ant colony, ported straight from the python it was trained in.
// Each ant is memoryless: it reads its 3x3 patch, its own odometer and a clock,
// then writes to the cell below and turns left, straight on, or right.

const BASE = 48; // the field the ants were trained on, wrapping at the edges
const MAX = 256; // zoomed out: many more cells, same box on screen
const CELL = 16; // channels per cell: 3 visible, 13 the ants' own scratch
const HORIZON = 6000; // steps the clock is scaled to
const SPAN = 24; // what the odometer divides by, as trained: never rescaled
const LIMIT = 8; // nothing past this reaches the brain

const RING = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // up, right, down, left
const TURNS = [-1, 0, 1]; // left, straight on, right
const QCOS = [1, 0, -1, 0];
const QSIN = [0, 1, 0, -1];
const CLOCK_FREQS = [1, 2, 4, 8];
const COMPASS_FREQS = [1, 2, 4, 8];
const SOBEL = [-1, 0, 1, -2, 0, 2, -1, 0, 1].map((v) => v / 8);

const WHITE = [1, 1, 1]; // the visible channels start white, the rest at zero
const SENSE = 3 * CELL + 2 * CLOCK_FREQS.length + 35 + 2; // 93

function unpack(entry) {
  const raw = atob(entry.data);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

function brainOf(weights) {
  return {
    w1: unpack(weights.w1),
    write: unpack(weights.write),
    move: unpack(weights.move),
    b1: unpack(weights.b1),
    bWrite: unpack(weights.b_write),
    bMove: unpack(weights.b_move),
    width: weights.b1.shape[1],
  };
}

export class Colony {
  // brains: { name: weights }. Every ant carries the name of the one it uses,
  // so several creatures can be drawn on the one field at the same time.
  constructor(brains, size = BASE) {
    this.brains = {};
    for (const name of Object.keys(brains)) this.brains[name] = brainOf(brains[name]);
    this.kinds = Object.keys(this.brains);
    this.width = Math.max(...this.kinds.map((k) => this.brains[k].width));

    this.size = size;
    this.field = new Float32Array(size * size * CELL);
    this.sense = new Float32Array(SENSE);
    this.hidden = new Float32Array(this.width);
    this.ants = [];
    this.clear();
  }

  clear() {
    const SIZE = this.size;
    for (let i = 0; i < SIZE * SIZE; i++) {
      for (let c = 0; c < CELL; c++) {
        this.field[i * CELL + c] = c < 3 ? WHITE[c] : 0;
      }
    }
    this.ants = [];
    this.t = 0;
  }

  // Zooming keeps the drawing where it is and grows the field around it, so
  // the middle stays the middle and every square shrinks by the same amount.
  resize(size) {
    if (size === this.size) return;
    const was = this.size;
    const next = new Float32Array(size * size * CELL);
    for (let i = 0; i < size * size; i++) {
      for (let c = 0; c < CELL; c++) next[i * CELL + c] = c < 3 ? WHITE[c] : 0;
    }

    const shift = Math.round((size - was) / 2); // where the old corner lands
    for (let y = 0; y < was; y++) {
      const ny = y + shift;
      if (ny < 0 || ny >= size) continue;
      for (let x = 0; x < was; x++) {
        const nx = x + shift;
        if (nx < 0 || nx >= size) continue;
        const from = (y * was + x) * CELL;
        const to = (ny * size + nx) * CELL;
        for (let c = 0; c < CELL; c++) next[to + c] = this.field[from + c];
      }
    }

    this.ants = this.ants.filter((ant) => {
      ant.x += shift;
      ant.y += shift;
      ant.ox += shift;
      ant.oy += shift;
      return ant.x >= 0 && ant.x < size && ant.y >= 0 && ant.y < size;
    });

    this.size = size;
    this.field = next;
  }

  seed(x, y, count, spin, kind = this.kinds[0]) {
    const SIZE = this.size;
    for (let i = 0; i < count; i++) {
      const heading = spin ? (Math.random() * 4) | 0 : 0;
      this.ants.push({
        kind,
        x: ((x % SIZE) + SIZE) % SIZE,
        y: ((y % SIZE) + SIZE) % SIZE,
        ox: ((x % SIZE) + SIZE) % SIZE,
        oy: ((y % SIZE) + SIZE) % SIZE,
        heading,
        start: heading,
        flip: 1,
      });
    }
  }

  erase(cx, cy, radius) {
    const SIZE = this.size;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const x = ((cx + dx) % SIZE + SIZE) % SIZE;
        const y = ((cy + dy) % SIZE + SIZE) % SIZE;
        const at = (y * SIZE + x) * CELL;
        for (let c = 0; c < CELL; c++) this.field[at + c] = c < 3 ? WHITE[c] : 0;
      }
    }
  }

  // everything the ant knows, in the order the brain was trained to expect
  look(ant) {
    const SIZE = this.size;
    const s = this.sense;
    const flip = ant.flip;
    const c = QCOS[ant.heading];
    const sn = QSIN[ant.heading];

    // the cell below, and the sobel gradients across the 3x3 patch
    for (let ch = 0; ch < CELL; ch++) {
      let gx = 0;
      let gy = 0;
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          const y = ((ant.y - 1 + i) % SIZE + SIZE) % SIZE;
          const x = ((ant.x - 1 + j) % SIZE + SIZE) % SIZE;
          let v = this.field[(y * SIZE + x) * CELL + ch];
          v = v > LIMIT ? LIMIT : v < -LIMIT ? -LIMIT : v;
          gx += v * SOBEL[i * 3 + j];
          gy += v * SOBEL[j * 3 + i];
          if (i === 1 && j === 1) s[ch] = v;
        }
      }
      s[CELL + ch] = (gx * c + gy * sn) * flip; // ahead
      s[2 * CELL + ch] = gy * c - gx * sn; // aside
    }

    let at = 3 * CELL;
    const phase = (2 * Math.PI * this.t) / HORIZON;
    for (const f of CLOCK_FREQS) s[at++] = Math.sin(phase * f);
    for (const f of CLOCK_FREQS) s[at++] = Math.cos(phase * f);

    // where it is relative to where it woke up, the short way round the torus
    const half = SIZE / 2;
    let ax = (((ant.x - ant.ox + half) % SIZE) + SIZE) % SIZE - half;
    let ay = (((ant.y - ant.oy + half) % SIZE) + SIZE) % SIZE - half;
    ax /= SPAN;
    ay /= SPAN;
    const px = (ax * c + ay * sn) * flip;
    const py = ay * c - ax * sn;

    s[at++] = px;
    s[at++] = py;
    for (const f of COMPASS_FREQS) s[at++] = Math.sin(Math.PI * px * f);
    for (const f of COMPASS_FREQS) s[at++] = Math.sin(Math.PI * py * f);
    for (const f of COMPASS_FREQS) s[at++] = Math.cos(Math.PI * px * f);
    for (const f of COMPASS_FREQS) s[at++] = Math.cos(Math.PI * py * f);

    const radius = Math.hypot(px, py);
    const angle = Math.atan2(py, px);
    s[at++] = radius;
    for (const f of COMPASS_FREQS) s[at++] = Math.sin(angle * f);
    for (const f of COMPASS_FREQS) s[at++] = Math.cos(angle * f);
    for (const f of COMPASS_FREQS) s[at++] = Math.sin(Math.PI * radius * f);
    for (const f of COMPASS_FREQS) s[at++] = Math.cos(Math.PI * radius * f);

    const point = RING[(((ant.heading - ant.start) % 4) + 4) % 4];
    s[at++] = point[0] * flip;
    s[at++] = point[1];
    return s;
  }

  think(ant) {
    const SIZE = this.size;
    const brain = this.brains[ant.kind] || this.brains[this.kinds[0]];
    const s = this.look(ant);
    const h = this.hidden;
    const width = brain.width;

    for (let j = 0; j < width; j++) h[j] = brain.b1[j];
    for (let i = 0; i < SENSE; i++) {
      const v = s[i];
      if (v === 0) continue;
      const row = i * width;
      for (let j = 0; j < width; j++) h[j] += v * brain.w1[row + j];
    }
    for (let j = 0; j < width; j++) if (h[j] < 0) h[j] = 0;

    const at = (ant.y * SIZE + ant.x) * CELL;
    for (let c = 0; c < CELL; c++) {
      let d = brain.bWrite[c];
      for (let j = 0; j < width; j++) d += h[j] * brain.write[j * CELL + c];
      let v = this.field[at + c] + d;
      this.field[at + c] = v > LIMIT ? LIMIT : v < -LIMIT ? -LIMIT : v;
    }

    let best = -Infinity;
    const logits = [0, 0, 0];
    for (let m = 0; m < 3; m++) {
      let z = brain.bMove[m];
      for (let j = 0; j < width; j++) z += h[j] * brain.move[j * 3 + m];
      logits[m] = z;
      if (z > best) best = z;
    }
    let total = 0;
    for (let m = 0; m < 3; m++) {
      logits[m] = Math.exp(logits[m] - best);
      total += logits[m];
    }

    let pick = Math.random() * total;
    let move = 2;
    for (let m = 0; m < 3; m++) {
      pick -= logits[m];
      if (pick <= 0) { move = m; break; }
    }
    return move;
  }

  step() {
    const SIZE = this.size;
    for (const ant of this.ants) {
      const move = this.think(ant);
      ant.heading = (((ant.heading + TURNS[move] * ant.flip) % 4) + 4) % 4;
      const [dx, dy] = RING[ant.heading];
      ant.x = ((ant.x + dx) % SIZE + SIZE) % SIZE;
      ant.y = ((ant.y + dy) % SIZE + SIZE) % SIZE;
    }
    this.t++;
  }
}

export { BASE, MAX, CELL, HORIZON, RING };
