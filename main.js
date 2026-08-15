// Wiring: the colony, the two views, and the controls around them.

import { Colony, SIZE, CELL } from "./sim.js";
import { View } from "./view.js";

// if anything below throws, say so on the page: a phone has no console
window.addEventListener("error", (event) => {
  const box = document.getElementById("trouble");
  if (box) {
    box.textContent = `${event.message}`;
    box.classList.add("shown");
  }
});

const RAMP = [[0.13, 0.11, 0.09], [0.99, 0.87, 0.73]]; // ink to the alife sand
const MAPLE = [0.69, 0.01, 0.0]; // #b00300

const colony = new Colony(WEIGHTS);
const stage = new View(document.getElementById("stage"), { ramp: RAMP });
const strip = new View(document.getElementById("strip"), { ramp: RAMP });

const dom = (id) => document.getElementById(id);
const speed = dom("speed");
const crowd = dom("crowd");
const brush = dom("brush");
const spin = dom("spin");
const tool = { value: "erase" };
const toolBar = dom("tool");
toolBar.addEventListener("click", (event) => {
  const pressed = event.target.closest("button[data-tool]");
  if (!pressed) return;
  tool.value = pressed.dataset.tool;
  for (const button of toolBar.querySelectorAll("button")) {
    button.classList.toggle("is-on", button === pressed);
  }
});
const playing = { on: true };

const HOLD = 500;    // stand still this long at the start
const WINDUP = 7000; // then wind up to CRUISE over this long
const CRUISE = 500;  // steps a second, until the slider is touched
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

  // a long slow crawl to begin with: cubic, so the first seconds stay readable
  const along = Math.min((gone - HOLD) / WINDUP, 1);
  const smooth = along * along * along;

  const eased = Math.round(CRUISE * smooth);
  speed.value = eased;
  return eased;
}

function seedAt(x, y) {
  colony.seed(x, y, Number(crowd.value), spin.checked);
}

function reset(withColony) {
  colony.clear();
  if (withColony) seedAt(SIZE >> 1, SIZE >> 1);
}

// ---- drawing -------------------------------------------------------------

function paint() {
  stage.fit();
  stage.upload(colony.field);
  stage.panel([-1, -1, 2, 2], -1);
  // the faster it runs, the more the ants get out of the way of the picture
  const rush = Math.min(Number(speed.value) / Number(speed.max), 1);
  stage.ants(colony.ants, MAPLE, 1.1, 1 - 0.9 * rush);

  strip.fit();
  strip.upload(colony.field);
  const shown = CELL - 3;  // the first three are the picture, shown above
  const gap = 0.004;       // hairline between channels
  const wide = (2 - gap * (shown - 1)) / shown;
  for (let i = 0; i < shown; i++) {
    strip.panel([-1 + i * (wide + gap), -1, wide, 2], i + 3);
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
    x: Math.floor(((clientX - box.left) / box.width) * SIZE),
    y: Math.floor(((clientY - box.top) / box.height) * SIZE),
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
  const across = (Number(brush.value) * 2 + 1) * (box.width / SIZE);

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

for (const [key, id] of [[" ", "play"], ["c", "clear"], ["r", "restart"]]) {
  window.addEventListener("keydown", (event) => {
    if (event.key === key && event.target === document.body) {
      event.preventDefault();
      dom(id).click();
    }
  });
}

reset(true);
requestAnimationFrame(tick);
