# Leniaghton — web demo

Serve the folder and open it — the page uses ES modules, which Chrome refuses to
load straight off `file://`:

```
python3 -m http.server 8017 --bind 127.0.0.1   # then open localhost:8017
```

Nothing to install beyond that; the trained brain ships in `weights.js`.

## What you are looking at

A colony of ants walks a 48×48 wrapping grid. Each ant is memoryless: at every
step it reads its own 3×3 patch through fixed sobel kernels, how far it has
walked from where it woke up, and how far through the run a clock is. From that
alone it decides what to add to the cell beneath it and whether to turn left,
carry straight on, or turn right. It then steps forward.

Nobody has a map, nobody remembers anything, and nobody talks. The gecko is what
14,483 trained parameters make of that.

## Controls

| | |
|---|---|
| speed | simulation steps per second |
| pointer does | drop a crowd of ants, or erase a patch of field |
| ants per drop | how many ants a click places |
| eraser size | radius of the eraser, in cells |
| random facing | give each new ant a random heading instead of a shared one |
| nudge | advance 25 steps while paused |
| restart | clear, then place one crowd in the middle |

Space toggles running, `c` clears, `r` restarts.

## Things worth trying

- **Cut a piece off** a finished gecko with the eraser, then watch it fill back
  in. Nothing in training ever showed the ants damage.
- **Drop a second crowd** somewhere else. It builds its own gecko around that
  spot, because every ant paints relative to where *it* woke up.
- **Tick "random facing"** and drop a crowd. The picture collapses into a
  four-fold symmetric blob: the ants no longer agree which way is up, and the
  best any of them can do is paint the average of the four rotations.
- **Put two crowds close together** and watch the paintings sum where they meet.
  The ants have no way to notice they disagree.

## The strip below the field

Each cell carries 16 numbers. The first three are the picture you see. The other
thirteen are the ants' own scratch space, and the strip shows all sixteen at
once, dark for low values and pale for high.

## Files

| file | what it is |
|---|---|
| `sim.js` | the colony, ported from the training code |
| `view.js` | WebGL2 drawing for the field and the channel strip |
| `main.js` | controls and the animation loop |
| `weights.js` | the trained brain, base64 float32 |
| `export_weights.py` | regenerates `weights.js` from a run folder |

To point the demo at a different training run:

```
uv run python demo/export_weights.py out/<run-folder>
```

The port is checked against the python: the sensed vector agrees to 4e-7 and the
move logits to 1e-6.
