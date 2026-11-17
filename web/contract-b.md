# Contract B: the web component and the worker

Version 1, agreed 2026-11-17. This is how `<nspire-emu>` (component [1], the team's lane B) talks to the worker that runs the emulator (component [2], `web/worker.js`). Everything the component needs from the emulator goes through these messages; it never touches the WebAssembly module.

`web/fake-worker.js` speaks the same contract with a test pattern instead of the emulator, so the component can be built without TI files or the wasm build. The test page uses it with `index.html?fake`.

## Setup

```js
const worker = new Worker('worker.js');            // in web/dist/, next to firebird.js and firebird.wasm
worker.onmessage = (e) => handle(e.data);           // every message is a plain object with a `type`
worker.postMessage({ type: 'queryStorage' });       // may be sent at once: the worker queues until it is ready
```

- The page must be served over `http://localhost` (for example `python -m http.server 8000 --bind 127.0.0.1` in the project root); WebAssembly does not load from `file://`.
- One worker runs one calculator. To load other files, create a new worker (or reload the page).
- `build.py` adds `?v=<build id>` to these URLs in `web/dist/`; keep doing that in the component so browsers never mix old and new files.

## Lifecycle

```
worker created ──> ready
                   │
   ┌───────────────┴───────────────┐
   load { files, … } ──> loaded    queryStorage ──> storage { exists, snapshot }
   │                               │
   start ──> started               start { saved: true } ──> started { resumed }
   │                               │
   └──────────── running: frame, lcd, speed, status, log, usblink, progress
                 input: key, arrow, touch, turbo, sendFile, sendOS, reset, save
```

## Page → worker

| `type` | Fields | Reply | What it does |
|---|---|---|---|
| `load` | `files`: `{ boot1, flash }` or `{ boot1, boot2, manuf?, diags?, os? }` (ArrayBuffers); `osInFlash?`; `remember?` | `loaded` | Uses a full flash image, or builds one from boot2 (+ manuf, diags). With `osInFlash` the OS goes into the new image and the calculator offers to install it on the first boot (press `I`). With `remember` the setup is stored in this browser (replacing any earlier one). CX and CX CAS only; for a CX II, pass a full flash image. |
| `start` | `saved?` | `started` | Starts the loaded files; with `saved: true` the setup stored in this browser instead, resuming the saved snapshot when it fits, otherwise booting the saved flash. |
| `key` | `row`, `col`, `down` | none | A key of the keypad matrix (table below). Send `down: false` for every `down: true`. |
| `arrow` | `dir` (0 up, 1 down, 2 left, 3 right), `down` | none | The touchpad's arrow edges. |
| `touch` | `x`, `y` (0 to 1, top left is 0, 0), `contact`, `down` | none | The touchpad: `contact` while a finger touches, `down` while it is pressed (a click). |
| `turbo` | `on` | none | Full speed while the calculator computes; real speed while it waits. |
| `sendFile` | `name`, `data` | `progress` | Sends a `.tns` (or other) file over the emulated USB. `name` is the path on the calculator, `/` being My Documents (`'/test.tns'`, `'/Folder/test.tns'`). |
| `sendOS` | `data` | `progress` | Installs an OS file (`.tco`/`.tcc` for the CX) over the emulated USB. |
| `reset` | none | none | Resets the calculator, like the reset hole. |
| `save` | `snapshot?` (default `true`) | `storage` | Saves the changed flash blocks, and with `snapshot` the whole state, to this browser. Needs a setup loaded with `remember: true`. Call it when the page is hidden. |
| `queryStorage` | none | `storage` | What is saved in this browser. |
| `forget` | none | `storage` | Deletes what is saved in this browser. |
| `debug` | none | `debug` | Development only. |

## Worker → page

| `type` | Fields | When |
|---|---|---|
| `ready` | `protocol` (1), `build`, `core` | The worker can take messages (earlier ones were queued). |
| `loaded` | `model` (`{ product, features, name }` when a flash image was built, else `null`), `stored` | After `load`. |
| `started` | `resumed` | The emulator runs; `resumed` is true when a snapshot was restored. |
| `frame` | `rgba` (ArrayBuffer, 320 × 240 × 4 bytes, transferred) | Only when the picture changed, at most about 60 per second. Draw with `ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), 320, 240), 0, 0)`. |
| `lcd` | `on: false` | Once, when the calculator turns its screen off (powered off or asleep). The next `frame` means it is on again. |
| `speed` | `value` (1 = real speed) | About every 0.5 s while running. |
| `status` | `text` | Short English status lines ("Reset", "Send complete"). |
| `log` | `text` | The calculator's serial output and debug lines. |
| `usblink` | `connected` | The emulated USB cable state. |
| `progress` | `what` (`'file'` or `'os'`), `value` | 0 to 100 while sending; negative on an error. |
| `storage` | `exists`, `snapshot`, `blocks`, `savedAt` (ms), `error?` | After `queryStorage`, `save`, `forget`. `snapshot: true` means `start { saved: true }` resumes instantly. |
| `error` | `message`, `fatal?` | Something failed. With `fatal: true` the emulator stopped; reload to run again. |

## Keys

`key` uses Firebird's keypad matrix (`firebird/keymap.h`): the key at position `row * 11 + col` of this list. Names starting with `a` are the letters (`aa` = A), `n` the digits, `none…` are unused positions.

```
row 0: ret, enter, none, neg, space, az, ay, n0, punct, on, none1
row 1: ax, aw, av, n3, au, at, as, n1, pi, trig, pow10
row 2: ar, aq, ap, n6, ao, an, am, n4, ee, squ, none2
row 3: al, ak, aj, n9, ai, ah, ag, n7, div, exp, none3
row 4: af, ae, ad, none4, ac, ab, aa, equ, mult, pow, none5
row 5: none6, var, minus, pright, dot, pleft, n5, cat, metrix, del, pad
row 6: flag, none7, plus, doc, n2, menu, n8, esc, none8, tab, none9
row 7: none10 … none17, shift, ctrl, comma
```

What the worker guarantees, so the component doesn't have to:
- A tap is never lost: a release waits until the key has been down at least 80 ms of emulated time and a keypad scan has seen it (at most 1 s), and a second press of the same key waits until the release lasted 80 ms, so double taps count twice.
- The ON key works even when the calculator is off; ctrl + on turns it off, as on the real one. Holding on breaks a long calculation.

What the component must do:
- Send a release for every press, and release every held key when the page or element loses focus.
- Ignore keyboard auto-repeat (`event.repeat`): the calculator repeats keys by itself.
- Map PC keys: letters, digits and navigation by `KeyboardEvent.code`; symbols (`* + ( ) ^`) by `KeyboardEvent.key`, since they sit in different places on different layouts. Firebird's desktop mapping is in `firebird/qtkeypadbridge.cpp` and the test page's in `web/main.js`.

## Storage

- Stored per browser, in IndexedDB of the page's origin (`localhost:8000` is a different origin from `127.0.0.1:8000`).
- While running, the worker saves changed flash blocks every 10 s by itself, so documents survive a reload. A snapshot (the full state, about 3.5 s to write) is taken only on `save`, so send `save` when `document.visibilityState` becomes `hidden`. Closing the tab gives no time for it; the next start then boots the saved OS (about 45 s) instead of resuming (about 1.3 s).
- A snapshot only fits the core build that wrote it; after a rebuild, `start { saved: true }` boots the saved flash instead.

## Versioning

`ready.protocol` is 1. New optional fields and new message types keep it at 1; renaming or removing a message raises it. Not in version 1: copying files back from the calculator, listing its files, screenshots, the Press-to-Test LED, CX II flash building, pausing while the page is hidden.
