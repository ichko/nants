// Wiring: the colony, the two views, and the controls around them.

import { Colony, BASE, MAX, CELL } from "./sim.js?v=34";
import { View } from "./view.js?v=34";

// if anything below throws, say so on the page: a phone has no console
window.addEventListener("error", (event) => {
  const box = document.getElementById("trouble");
  if (box) {
    box.textContent = `${event.message}`;
    box.classList.add("shown");
  }
});

const RAMP = [[0.13, 0.11, 0.09], [0.99, 0.87, 0.73]]; // ink to the alife sand

// one colour per creature, so a mixed field still reads at a glance
const COLOURS = {
  gecko: [0.69, 0.01, 0.0],
  ant: [0.10, 0.09, 0.08],
  butterfly: [0.60, 0.13, 0.66],
  turtle: [0.05, 0.45, 0.24],
  octopus: [0.90, 0.42, 0.05],
  snail: [0.08, 0.34, 0.72],
};

const colony = new Colony(BRAINS);
const stage = new View(document.getElementById("stage"), { ramp: RAMP });
const strip = new View(document.getElementById("strip"), { ramp: RAMP });

const dom = (id) => document.getElementById(id);
const speed = dom("speed");
const crowd = dom("crowd");
const brush = dom("brush");
const zoom = dom("zoom");
const tool = { value: "erase" };
const kind = { value: colony.kinds[0] };

const toolBar = dom("tool");
const stampBar = dom("stamp");

function showTool() {
  for (const button of toolBar.querySelectorAll("button")) {
    button.classList.toggle("is-on", button.dataset.tool === tool.value);
  }
  for (const button of stampBar.querySelectorAll("button")) {
    const picked = tool.value === "seed" && button.dataset.kind === kind.value;
    button.classList.toggle("is-on", picked);
  }
}

toolBar.addEventListener("click", (event) => {
  const pressed = event.target.closest("button[data-tool]");
  if (!pressed) return;
  tool.value = pressed.dataset.tool;
  showTool();
});

// picking a creature is also how you pick up the stamp
stampBar.addEventListener("click", (event) => {
  const pressed = event.target.closest("button[data-kind]");
  if (!pressed) return;
  kind.value = pressed.dataset.kind;
  tool.value = "seed";
  showTool();
});

// zooming out gives the ants more room; the drawing stays where it is
zoom.min = BASE;
zoom.max = MAX;
zoom.addEventListener("input", () => {
  const cells = Number(zoom.value);
  colony.resize(cells);
  dom("zoomRead").textContent = `${cells}x${cells}`;
});
const playing = { on: true };

const HOLD = 500;    // a beat on the empty grid, so the start is visible
const WINDUP = 7000; // then wind up to CRUISE over this long
const CRUISE = 500;  // steps a second, until the slider is touched
const FLOOR = 14;    // the rate it opens at, so it never looks stalled
const REDRAW = 120;  // never draw more often than this, however fast the screen

let owed = 0;  // steps we still owe at the chosen rate
let last = performance.now();
let drawn = 0; // when the picture was last redrawn
let began = 0; // set on the first drawn frame, not at load
let mine = false; // true once the visitor takes the slider

speed.addEventListener("input", () => { mine = true; });

// the opening: a pause, then a wind up, unless the visitor has taken over
function rate(now) {
  if (mine) return Number(speed.value);

  const gone = now - began;
  if (gone < HOLD) return 0;

  // opens at a walking pace and winds up from there, cubic, so the first
  // seconds stay readable without ever looking stalled
  const along = Math.min((gone - HOLD) / WINDUP, 1);
  const eased = Math.round(FLOOR + (CRUISE - FLOOR) * along * along * along);
  speed.value = eased;
  return eased;
}

function seedAt(x, y) {
  // all facing the same way, and all of whichever creature is picked
  colony.seed(x, y, Number(crowd.value), false, kind.value);
}

function reset(withColony) {
  colony.clear();
  if (withColony) seedAt(colony.size >> 1, colony.size >> 1);
}

// ---- drawing -------------------------------------------------------------

function paint() {
  stage.fit();
  stage.upload(colony.field, colony.size);
  stage.panel([-1, -1, 2, 2], -1);
  // the faster it runs, the more the ants get out of the way of the picture
  const rush = Math.min(Number(speed.value) / Number(speed.max), 1);
  const fade = 1 - 0.9 * rush;
  const reach = 1.1 * (BASE / colony.size); // triangles shrink with the squares
  for (const name of colony.kinds) {
    const mine = colony.ants.filter((ant) => ant.kind === name);
    if (mine.length) stage.ants(mine, COLOURS[name] || COLOURS.gecko, reach, fade);
  }

  // the scratch channels: one row, square, with the same gap on every side
  const shown = CELL - 3;
  const across = strip.canvas.clientWidth;
  const gap = 3; // screen pixels, the same between panels and round the edge
  const panel = (across - gap * (shown + 1)) / shown;

  strip.canvas.style.height = `${Math.round(panel + gap * 2)}px`;
  strip.fit();
  strip.upload(colony.field, colony.size);

  // the same pixel gap is a different amount of clip space across and down
  const tall = strip.canvas.clientHeight || panel + gap * 2;
  const stepX = (panel / across) * 2;
  const gapX = (gap / across) * 2;
  const stepY = (panel / tall) * 2;
  const gapY = (gap / tall) * 2;

  for (let i = 0; i < shown; i++) {
    strip.panel([-1 + gapX + i * (stepX + gapX), -1 + gapY, stepX, stepY], i + 3);
  }

  dom("stepCount").textContent = colony.t.toLocaleString();
  dom("antCount").textContent = colony.ants.length;
}

function tick(now) {
  if (!began) began = now; // the opening starts when the page is actually up
  const wanted = rate(now);
  dom("speedRead").textContent = `${wanted}/s`;

  if (playing.on) {
    owed += ((now - last) / 1000) * wanted;
    const due = Math.min(Math.floor(owed), 400); // whole steps, and never freeze
    for (let i = 0; i < due; i++) colony.step();
    owed -= due;
  }
  last = now;

  // the simulation runs as fast as asked; the picture redraws far less often
  if (now - drawn >= 1000 / REDRAW) {
    drawn = now;
    paint();
  }
  requestAnimationFrame(tick);
}

// ---- input ---------------------------------------------------------------
// mouse and touch are wired separately. pointer events are tidier but a phone
// keeps handing the drag to the page, so touch is taken directly and swallowed.

const wrap = dom("fieldWrap");
const ghost = dom("ghost");
let dragging = false;

function cellAt(clientX, clientY) {
  const box = stage.canvas.getBoundingClientRect();
  return {
    x: Math.floor(((clientX - box.left) / box.width) * colony.size),
    y: Math.floor(((clientY - box.top) / box.height) * colony.size),
  };
}

// the eraser, shown faintly where the finger or pointer is
function showGhost(clientX, clientY) {
  if (tool.value !== "erase") {
    wrap.classList.remove("show-ghost");
    return;
  }
  const box = stage.canvas.getBoundingClientRect();
  const nest = wrap.getBoundingClientRect();
  const across = (Number(brush.value) * 2 + 1) * (box.width / colony.size);

  wrap.classList.add("show-ghost");
  ghost.style.width = `${across}px`;
  ghost.style.height = `${across}px`;
  ghost.style.left = `${clientX - nest.left}px`;
  ghost.style.top = `${clientY - nest.top}px`;
}

function press(clientX, clientY) {
  const { x, y } = cellAt(clientX, clientY);
  if (tool.value === "erase") {
    dragging = true;
    colony.erase(x, y, Number(brush.value));
  } else {
    seedAt(x, y);
  }
  showGhost(clientX, clientY);
}

function drag(clientX, clientY) {
  showGhost(clientX, clientY);
  if (!dragging) return;
  const { x, y } = cellAt(clientX, clientY);
  colony.erase(x, y, Number(brush.value));
}

const canvas = stage.canvas;

// ---- touch: taken directly, and never handed on to the page
canvas.addEventListener("touchstart", (event) => {
  event.preventDefault();
  const touch = event.changedTouches[0];
  press(touch.clientX, touch.clientY);
}, { passive: false });

canvas.addEventListener("touchmove", (event) => {
  event.preventDefault();
  const touch = event.changedTouches[0];
  drag(touch.clientX, touch.clientY);
}, { passive: false });

for (const kind of ["touchend", "touchcancel"]) {
  canvas.addEventListener(kind, (event) => {
    event.preventDefault();
    dragging = false;
    wrap.classList.remove("show-ghost");
  }, { passive: false });
}

// ---- mouse
canvas.addEventListener("mousedown", (event) => press(event.clientX, event.clientY));
canvas.addEventListener("mousemove", (event) => drag(event.clientX, event.clientY));
canvas.addEventListener("mouseleave", () => {
  dragging = false;
  wrap.classList.remove("show-ghost");
});
window.addEventListener("mouseup", () => { dragging = false; });
brush.addEventListener("input", () => wrap.classList.remove("show-ghost"));

// ---- buttons -------------------------------------------------------------

dom("play").addEventListener("click", (event) => {
  playing.on = !playing.on;
  event.target.textContent = playing.on ? "⏸ pause" : "▶ run";
  event.target.classList.toggle("is-on", playing.on);
});

dom("once").addEventListener("click", () => {
  for (let i = 0; i < 25; i++) colony.step();
});

dom("clear").addEventListener("click", () => reset(false));
dom("restart").addEventListener("click", () => {
  reset(true);
  began = 0; // play the opening again
});

const SHORTCUTS = { " ": "play", c: "clear", r: "restart" };

window.addEventListener("keydown", (event) => {
  // ctrl-c is for copying, not for clearing the field
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target !== document.body) return;
  if (!window.getSelection().isCollapsed) return; // something is selected

  const id = SHORTCUTS[event.key];
  if (!id) return;
  event.preventDefault();
  dom(id).click();
});

showTool();
reset(true);
requestAnimationFrame(tick);
