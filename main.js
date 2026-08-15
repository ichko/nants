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

// ---- pointer -------------------------------------------------------------

function cellUnder(event) {
  const box = stage.canvas.getBoundingClientRect();
  return {
    x: Math.floor(((event.clientX - box.left) / box.width) * SIZE),
    y: Math.floor(((event.clientY - box.top) / box.height) * SIZE),
  };
}

let dragging = false;
const wrap = dom("fieldWrap");
const ghost = dom("ghost");

// show the eraser faintly, so you can see what you are about to remove
function showGhost(event) {
  if (tool.value !== "erase") {
    wrap.classList.remove("show-ghost");
    stage.canvas.style.cursor = "crosshair";
    return;
  }
  const box = stage.canvas.getBoundingClientRect();
  const cell = box.width / SIZE;
  const across = (Number(brush.value) * 2 + 1) * cell;

  wrap.classList.add("show-ghost");
  stage.canvas.style.cursor = "none";
  ghost.style.width = `${across}px`;
  ghost.style.height = `${across}px`;
  ghost.style.left = `${event.clientX - box.left + (box.left - wrap.getBoundingClientRect().left)}px`;
  ghost.style.top = `${event.clientY - box.top + (box.top - wrap.getBoundingClientRect().top)}px`;
}

// touch listeners are passive by default, so say otherwise and swallow the gesture
for (const kind of ["touchstart", "touchmove"]) {
  stage.canvas.addEventListener(kind, (event) => event.preventDefault(),
                                { passive: false });
}

stage.canvas.addEventListener("pointermove", showGhost);
stage.canvas.addEventListener("pointerenter", showGhost);
stage.canvas.addEventListener("pointerleave", () => wrap.classList.remove("show-ghost"));
brush.addEventListener("input", () => wrap.classList.remove("show-ghost"));

stage.canvas.addEventListener("pointerdown", (event) => {
  event.preventDefault(); // keep the touch, do not let the page take it
  const { x, y } = cellUnder(event);
  if (tool.value === "erase") {
    dragging = true;
    stage.canvas.setPointerCapture(event.pointerId);
    colony.erase(x, y, Number(brush.value));
  } else {
    seedAt(x, y);
  }
});

stage.canvas.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  event.preventDefault();
  const { x, y } = cellUnder(event);
  colony.erase(x, y, Number(brush.value));
});

for (const done of ["pointerup", "pointercancel", "pointerleave"]) {
  stage.canvas.addEventListener(done, () => { dragging = false; });
}

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
