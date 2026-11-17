# Research 1: the `<nspire-emu>` web component (guide for Phase 3)

2026-11-17. Component [1] in `COMPONENTS.md`, written for the team (lane B): the team builds the component, Claude answers questions and reviews. Read from Firebird's `qml/Keypad.qml`, `qml/NButton.qml`, `qml/NDualButton.qml`, `qml/Touchpad.qml`, `keymap.h`, `qtkeypadbridge.cpp` and `core/keypad.cpp`, and from our `web/contract-b.md`.

**Update, 2026-11-17:** at the user's request Claude built the component from this guide: `web/nspire-emu.js`, with the demo `web/demo.html` (`http://localhost:8000/web/dist/demo.html` after `python web/build.py`). It implements the proposed API below, plus a `manual` attribute (start only when the page calls `load()` and `start()`), `sendFiles(files)` (documents and OS files while running, the TI files before) and an `lcd` event with `on: true` when the screen comes back. Its layout is measured from a photo of a CX CAS (Wikimedia Commons), in units where the screen is 320 × 240. The starter below stays as the smallest version.

## Look fixes from the team's photo (done 2026-11-17)

The team photographed its own CX CAS (`web/build/ref/real.webp`, git-ignored, local only). Colours below are corrected for the photo's warm light, with the white key text as the reference. All of the list below is now in `web/nspire-emu.js`, checked side by side with the photo.

Second pass, after the user's review (2026-11-17), with each font picked by setting candidates next to enlarged crops of the photo:
- Wider grey side rails (15 units); below the touchpad matte black, a little lighter than the glass, not grey.
- "TI-" thin Segoe UI; a calligraphic n (Garamond italic) and "spire" (Segoe UI bold italic), both silver; "CX" white, Century Gothic bold italic; "CAS" silver Segoe UI bold.
- "Texas Instruments" in Constantia small caps (wedge serifs, close to TI's wordmark) after a simplified TI logo (Texas with "ti"; replace it with TI's artwork when the team has it).
- The keys around the touchpad use a bold humanist face (Segoe UI Bold, larger); the row under the touchpad, the number rows and enter use Segoe UI Semibold, slimmer; the letter keys use Arial Rounded MT Bold; ctrl labels are Segoe UI Semibold.
- Third pass (the user's review): the letter keys are small squares, 24 × 24 units, about 60 % of the column pitch as measured on the photo, with smaller letters (11.5) and a smaller "EE"; more space above the screen (screen top at 62); "CX" in the same face as "spire" (Segoe UI bold italic); "CAS" on the model name's baseline.
- Fourth pass (the user's review): the model name is centred (measured: centre at 212, the body's middle) and "CAS" ends at the screen's right edge (372), on the same baseline; the silver text's box reaches below the baseline, so the p keeps its tail; the TI logo is a bold white i, slanted like the imaginary unit, over a t of which only the crossbar's two ends show; the letter keys are 20 % smaller (19 × 19) with the letters unchanged.
- Fifth pass (the user's review): matte, not glossy: keys and panels are flat colours (keys keep a faint top edge), with no reflection on the black top and a satin touchpad ring. A grain of white specks was tried and dropped at the user's word: matte is enough. Number keys are a little darker grey; "(−)" is smaller and thinner (regular weight); the decimal point is a round dot centred 35 % up the key (measured).
- Left as they are: where these Windows fonts are missing, the browser falls back to Segoe UI or a system face.
- **Names (the user's decision: the team works with TI):** "TI-nspire CX" centred at the top ("TI-" thin, "nspire" italic with a script-like n, "CX" light cyan), "CAS" bold white on the right, "Texas Instruments" in small caps at the bottom. No TI emblem drawn (use TI's own file if they give one). Move the "nspire-web · Firebird" credit from the body to the demo page.
- **Colours:** ctrl key pale yellow (about `#f0e3a4`) with dark text; ctrl labels pale cyan (about `#b5e2ee`); number keys and X, Y, Z mid grey; touchpad ring metallic champagne; glossy black glass from the top down to the touchpad band; dark grey lower panel; lighter grey side rails.
- **Fonts:** key labels in a bold rounded face: Arial Rounded MT Bold is installed here. Declare it with `@font-face { src: local(...) }` in the document, since `@font-face` is ignored inside a shadow root. "nspire" in a bold italic (try Candara), "Texas Instruments" in small caps (Candara).
- **Key symbols:** pad: three slanted lines and a calculator; esc label: an undo arrow; doc ▾; menu label: a page with a cursor; shift: an outline ⇧; del with ← below; trig with ▸ below; ^ as a chevron; labels |≠≥▸, ? in a circle, ⁿ√x, √ with a bar, ":=", "∞β°", '"□"', □ over □ (fraction), ◐▸ and ◂◐ (contrast); templates: |□|{⁝; space: ⎵. Each pair (= trig, ^ x², eˣ 10ˣ, ( ), templates catalog, × ÷, + −) is one rocker key with a groove.
- **Touchpad:** a rounded square in the middle with a grabbing hand (cyan, ctrl) over a click cursor with rays (white); around the pad: above, a curved arrow with tiles; below, a page with a curved arrow; left, a page with ◀; right, a page with ▶.

## What to build

`<nspire-emu>` is the calculator people see and touch: one custom element with a Shadow DOM. Phase 3 is done when a blank HTML page that loads `nspire-emu.js` and contains `<nspire-emu>` gives a working calculator.

| Part | Job | Section |
|---|---|---|
| Body | The calculator's shape and colours, like your own CX CAS | The keypad |
| Screen | The 320 × 240 picture, sharp at any zoom | The screen |
| Keypad | 70 keys | The keypad, Pointer input |
| Touchpad | Cursor, click, arrows at the edges | The touchpad |
| PC keyboard | Typing on the computer's keyboard | PC keyboard |
| Files and storage | The user's TI files, `.tns` documents, resuming | Files and storage |
| API | Attributes, methods and events for the page (contract A) | Proposed API |

The component never touches the emulator: it only exchanges contract B messages with a worker. Build it against `web/fake-worker.js`, which needs no TI files and no build, and switch to `web/worker.js` at the end.

## Start here

1. In `E:\nspire-web`, serve the project: `python -m http.server 8000 --bind 127.0.0.1` (the bind keeps `roms/` off the network).
2. Copy the starter below into `web/nspire-emu.js` and the demo into `web/demo.html`.
3. Open `http://localhost:8000/web/demo.html`. The fake worker's test pattern appears. Press the three keys under it, or click it and type: the pattern shows what arrived.
4. Grow it milestone by milestone (Order of work, below).

The starter was tested against the fake worker on 2026-11-17: clicks, a press dragged off the key, Shift + 9, auto-repeat, focus loss, arrows and a devicePixelRatio change. It covers the parts that are easy to get wrong; everything else is yours.

`web/nspire-emu.js`:

```js
// nspire-emu.js: a starting point for <nspire-emu> (Phase 3; guide:
// research/1-nspire-emu.md). It talks to the worker only through contract B
// (web/contract-b.md) and shows the patterns that are easy to get wrong:
// drawing frames, sharp pixels, and keys that are always released. The body,
// the full keypad, the touchpad, files and the public API are yours to build.

// Keypad matrix (firebird/keymap.h): the key at index row * 11 + col.
const KEYMAP = [
  'ret', 'enter', 'none', 'neg', 'space', 'az', 'ay', 'n0', 'punct', 'on', 'none1',
  'ax', 'aw', 'av', 'n3', 'au', 'at', 'as', 'n1', 'pi', 'trig', 'pow10',
  'ar', 'aq', 'ap', 'n6', 'ao', 'an', 'am', 'n4', 'ee', 'squ', 'none2',
  'al', 'ak', 'aj', 'n9', 'ai', 'ah', 'ag', 'n7', 'div', 'exp', 'none3',
  'af', 'ae', 'ad', 'none4', 'ac', 'ab', 'aa', 'equ', 'mult', 'pow', 'none5',
  'none6', 'var', 'minus', 'pright', 'dot', 'pleft', 'n5', 'cat', 'metrix', 'del', 'pad',
  'flag', 'none7', 'plus', 'doc', 'n2', 'menu', 'n8', 'esc', 'none8', 'tab', 'none9',
  'none10', 'none11', 'none12', 'none13', 'none14', 'none15', 'none16', 'none17', 'shift', 'ctrl', 'comma',
];

// PC keys: symbols by event.key (they sit elsewhere on other layouts), the
// rest by event.code. Fill in the rest from the table in the guide.
const BY_KEY = { '(': 'pleft', ')': 'pright', '*': 'mult', '+': 'plus', '-': 'minus', '/': 'div', '^': 'pow', '=': 'equ' };
const BY_CODE = {
  Escape: 'esc', Tab: 'tab', Enter: 'enter', Backspace: 'del', Space: 'space', Period: 'dot',
  ControlLeft: 'ctrl', ControlRight: 'ctrl', ShiftLeft: 'shift', ShiftRight: 'shift',
};
for (let i = 0; i < 26; i++) BY_CODE['Key' + String.fromCharCode(65 + i)] = 'a' + String.fromCharCode(97 + i);
for (let i = 0; i < 10; i++) BY_CODE['Digit' + i] = 'n' + i;
const ARROWS = { ArrowUp: 0, ArrowDown: 1, ArrowLeft: 2, ArrowRight: 3 };

// The contract B message for a calculator key, without `down`.
function keyMessage(name) {
  const i = KEYMAP.indexOf(name);
  return { type: 'key', row: Math.floor(i / 11), col: i % 11 };
}

class NspireEmu extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).innerHTML = `
      <style>
        :host { display: inline-block; }
        canvas { display: block; image-rendering: pixelated; background: #000; }
        .key { display: inline-block; padding: 4px 10px; margin: 4px 4px 0 0; border-radius: 4px;
               background: #223; color: #fff; font: bold 14px sans-serif; cursor: pointer;
               touch-action: none; user-select: none; -webkit-user-select: none; }
        .key.down { background: #556; }
      </style>
      <canvas width="320" height="240"></canvas>
      <div class="keypad">
        <span class="key" data-key="esc">esc</span><span class="key" data-key="aa">A</span><span class="key" data-key="enter">enter</span>
      </div>`;
    this.canvas = this.shadowRoot.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.held = new Map();               // PC key (event.code) -> the message it pressed
  }

  connectedCallback() {
    if (this.worker) return;             // moved within the page: keep running
    const url = new URL((this.getAttribute('worker') || 'worker.js') + '?v=__BUILD__', import.meta.url);
    this.worker = new Worker(url);
    this.worker.onmessage = (e) => this.onMessage(e.data);
    this.tabIndex = 0;                   // focusable, so it receives PC keys
    this.addEventListener('keydown', (e) => this.onKey(e, true));
    this.addEventListener('keyup', (e) => this.onKey(e, false));
    this.addEventListener('blur', () => this.releaseAll());
    for (const el of this.shadowRoot.querySelectorAll('[data-key]')) this.wireKey(el);
    this.fit();
  }

  // Worker -> page. Frames go on the canvas; every other message also
  // becomes an event on the element, with the message as event.detail.
  onMessage(m) {
    if (m.type === 'frame') {
      this.ctx.putImageData(new ImageData(new Uint8ClampedArray(m.rgba), 320, 240), 0, 0);
      return;
    }
    if (m.type === 'lcd') this.ctx.fillRect(0, 0, 320, 240);   // screen off: black
    this.dispatchEvent(new CustomEvent(m.type, { detail: m }));
  }

  // Page -> worker. Wait for the 'loaded' event before start().
  load(files, options = {}) { this.worker.postMessage({ type: 'load', files, ...options }); }
  start(options = {}) { this.worker.postMessage({ type: 'start', ...options }); }

  // Sharp pixels: a whole number of device pixels per calculator pixel.
  // devicePixelRatio changes with browser zoom and between monitors, not
  // always with a resize event, so watch it. Call fit() once; it re-arms.
  fit() {
    const zoom = Number(this.getAttribute('zoom')) || 2;
    const k = Math.max(1, Math.round(zoom * devicePixelRatio));
    this.canvas.style.width = 320 * k / devicePixelRatio + 'px';
    matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', () => this.fit(), { once: true });
  }

  // On-screen key. Pointer capture keeps the release coming even if the
  // finger slides off; every pointer holds its own key, so two can be held.
  wireKey(el) {
    const msg = keyMessage(el.dataset.key);
    let down = false;
    const release = () => {
      if (!down) return;
      down = false;
      el.classList.remove('down');
      this.worker.postMessage({ ...msg, down: false });
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || down) return;
      el.setPointerCapture(e.pointerId);
      down = true;
      el.classList.add('down');
      this.worker.postMessage({ ...msg, down: true });
    });
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    window.addEventListener('blur', release);
  }

  // PC keyboard. A physical key (event.code) releases exactly what it
  // pressed, even when Shift changed event.key in between.
  onKey(e, down) {
    if (down) {
      if (e.repeat || this.held.has(e.code)) {          // the calculator repeats keys itself
        if (this.held.has(e.code)) e.preventDefault();
        return;
      }
      const name = BY_KEY[e.key] || BY_CODE[e.code];
      const msg = name ? keyMessage(name) : e.code in ARROWS ? { type: 'arrow', dir: ARROWS[e.code] } : null;
      if (!msg) return;                                 // not a calculator key: leave it to the browser
      e.preventDefault();
      this.held.set(e.code, msg);
      this.worker.postMessage({ ...msg, down: true });
    } else if (this.held.has(e.code)) {
      e.preventDefault();
      this.worker.postMessage({ ...this.held.get(e.code), down: false });
      this.held.delete(e.code);
    }
  }

  releaseAll() {
    for (const msg of this.held.values()) this.worker.postMessage({ ...msg, down: false });
    this.held.clear();
  }
}

customElements.define('nspire-emu', NspireEmu);
```

`web/demo.html`:

```html
<!doctype html>
<meta charset="utf-8">
<title>nspire-emu demo</title>
<script type="module" src="nspire-emu.js?v=__BUILD__"></script>
<nspire-emu id="calc" worker="fake-worker.js"></nspire-emu>
<p>Speed: <span id="speed">-</span></p>
<script type="module">
  const calc = document.getElementById('calc');
  calc.addEventListener('loaded', () => calc.start());
  calc.addEventListener('speed', (e) => { document.getElementById('speed').textContent = Math.round(e.detail.value * 100) + ' %'; });
  calc.addEventListener('error', (e) => console.error(e.detail.message));
  calc.load({ boot1: new ArrayBuffer(16), boot2: new ArrayBuffer(16) });   // the fake worker takes any files
</script>
```

Once it works with the fake worker, switch to the real one:
1. In `web/build.py`, add `'nspire-emu.js'` and `'demo.html'` to `PAGE_FILES`. The build copies them into `web/dist/` and fills in `__BUILD__`. It copies text files only, so ask Claude when you need images there.
2. In the demo, drop `worker="fake-worker.js"` and load real files (Files and storage).
3. Run `python web/build.py` and open `http://localhost:8000/web/dist/demo.html`.

## The keypad

Firebird draws the CX keypad in `qml/Keypad.qml`, 265 × 340 units. Every key carries a `keymap_id`, which is `row * 11 + col` in `firebird/keymap.h`: the matrix contract B uses. In the starter, `keyMessage(name)` turns a key name into its `row` and `col`.

```
┌──────────────────────────────────────────────────────────┐
│ esc            ┌────────────────────┐             ⌂ on   │
│ pad [save]     │      touchpad      │       doc [+page]  │
│ tab            └────────────────────┘    menu [context]  │
│                                                          │
│ ctrl        shift [CAPS]       var [sto→]    del [clear] │
│ =  | trig        7    8    9         templates | catalog │
│ ^  | x²          4    5    6                 × | ÷       │
│ eˣ | 10ˣ         1    2    3                 + | −       │
│ (  | )           0    .   (−)              enter [≈]     │
│                                                          │
│ EE   A   B   C   D   E   F   G   ?!▸                     │
│ π▸   H   I   J   K   L   M   N   flag                    │
│ ,    O   P   Q   R   S   T   U   ↵                       │
│      V   W   X   Y   Z   space                           │
└──────────────────────────────────────────────────────────┘
```

Brackets hold the ctrl functions printed above the keys. All 70 keys as data, area by area (checked against `KEYMAP`: every name once, none missing):

```js
// One entry per key: [label, name in KEYMAP, ctrl label printed above it].
// row = Math.floor(KEYMAP.indexOf(name) / 11), col = KEYMAP.indexOf(name) % 11.
const KEYPAD = {
  leftOfTouchpad:  [['esc', 'esc'], ['pad', 'pad', 'save'], ['tab', 'tab']],
  rightOfTouchpad: [['⌂ on', 'on'], ['doc', 'doc', '+page'], ['menu', 'menu', 'context menu']],
  underTouchpad:   [['ctrl', 'ctrl'], ['shift', 'shift', 'CAPS'], ['var', 'var', 'sto→'], ['del', 'del', 'clear']],
  leftPairs:       [['=', 'equ', '≠≥>'], ['trig', 'trig', '?'], ['^', 'pow', 'ⁿ√x'], ['x²', 'squ', '√'],
                    ['eˣ', 'exp', 'ln'], ['10ˣ', 'pow10', 'log'], ['(', 'pleft', '[ ]'], [')', 'pright', '{ }']],
  numbers:         [['7', 'n7'], ['8', 'n8'], ['9', 'n9'], ['4', 'n4'], ['5', 'n5'], ['6', 'n6'],
                    ['1', 'n1'], ['2', 'n2'], ['3', 'n3'], ['0', 'n0'], ['.', 'dot', 'capture'], ['(−)', 'neg', 'ans']],
  rightPairs:      [['templates', 'metrix', ':='], ['catalog', 'cat', '∞β°'], ['×', 'mult', '"□"'], ['÷', 'div'],
                    ['+', 'plus', 'contrast +'], ['−', 'minus', 'contrast −'], ['enter', 'enter', '≈']],
  letters: [   // 4 rows of 9 columns; null is a gap; space is 2 columns wide
    [['EE', 'ee'], ['A', 'aa'], ['B', 'ab'], ['C', 'ac'], ['D', 'ad'], ['E', 'ae'], ['F', 'af'], ['G', 'ag'], ['?!▸', 'punct']],
    [['π▸', 'pi'], ['H', 'ah'], ['I', 'ai'], ['J', 'aj'], ['K', 'ak'], ['L', 'al'], ['M', 'am'], ['N', 'an'], ['flag', 'flag']],
    [[',', 'comma'], ['O', 'ao'], ['P', 'ap'], ['Q', 'aq'], ['R', 'ar'], ['S', 'as'], ['T', 'at'], ['U', 'au'], ['↵', 'ret']],
    [null, ['V', 'av'], ['W', 'aw'], ['X', 'ax'], ['Y', 'ay'], ['Z', 'az'], ['space', 'space']],
  ],
};
```

- **CX and CX II:** Firebird has one matrix and one keypad for both. We emulate a CX CAS, so copy the printed labels and colours from yours; some of Firebird's ctrl labels are approximations (it shows none for ÷).
- **Firebird's look, as a fallback:** body `#444`, the band around the touchpad `#111`, keys `#223` with bold white labels, number keys `#555`, the ctrl key `#bbf` with dark text, ctrl labels `#68cce0`, a 1 px `#888` border and 4 px corners. Sizes in its 265 × 340 units: most keys 30 × 20 (33 wide in the number block), letter keys 18 × 18, each key of a pair 25 × 20, enter 50 × 20, and a band 90 high around the touchpad.
- **Icons:** `firebird/resources/keyimages/` has 7 PNGs (GPLv3, like the whole project): templates, catalog, flag, context menu, the question mark and contrast + / −. Or draw them in SVG.
- **Looking real:** draw the body with CSS or SVG, or lay the keys over a photo you took of your own calculator. Don't copy TI's product photos or logo from the web.

## Pointer input (on-screen keys)

- Press on `pointerdown`, never on `click`: `click` fires on release.
- Call `setPointerCapture` on press and release on `pointerup` and `pointercancel`, so a finger that slides off still releases (the starter does this).
- One pointer per key: two fingers hold two keys, such as shift + a letter or a reset combination. Firebird gives every key its own multi-touch area for the same reason.
- `touch-action: none` on the keys and the touchpad, so the browser neither scrolls nor zooms (which cancels the press); `user-select: none`; `-webkit-tap-highlight-color: transparent`.
- Firebird makes each key's hit area 1.3 times its size: leave no dead gaps between keys.
- In Firebird, a right click latches a key down until the next right click, so a mouse can hold several keys. Worth copying; prevent the context menu on the keypad. On the calculator, ctrl and shift also work when pressed and released before the next key (check on yours).
- Show pressed keys, also when the PC keyboard pressed them.
- Release everything when the window loses focus or the page is hidden.

## PC keyboard

- Make the element focusable (`tabIndex = 0`) and show the focus, so users see where their keys go. Tab is a calculator key, so focus stays in; clicking outside leaves.
- Map symbols by `event.key` and everything else by `event.code`, checking `event.key` first: Shift + 9 is `(` on a US layout but something else on others.
- Release by `event.code`: remember what each physical key pressed and release exactly that. Firebird does the same with scan codes (`qtkeypadbridge.cpp`): press Shift, press 9 (`(`), release Shift, release 9 (now `9`) must release `(`.
- Ignore `event.repeat`. Call `preventDefault()` only for keys you map, so the browser's other shortcuts keep working. Ctrl+N, Ctrl+T, Ctrl+W and Ctrl+Tab always go to the browser.
- PC Shift is also the calculator's shift (as in Firebird), so typing `(` sends shift + `(`. Check that the calculator still types `(`; if not, leave shift out while sending a symbol.
- Vietnamese typing tools (Unikey, EVKey) rewrite keys in Telex mode: they send Backspace plus an accented letter, which the calculator would take as `del` and an unknown key. Test with Unikey on; tell users, and set the demo laptop, to switch it to English (E) while using the calculator.
- Firebird's mapping, in browser terms:

| PC key | Calculator key |
|---|---|
| Esc, End, Tab | esc, pad, tab |
| Home, Page Up, Page Down | on, doc, menu |
| Ctrl, Shift, Insert | ctrl, shift, var |
| Backspace, Delete | del |
| A–Z, 0–9, Space, Enter | the same keys |
| Alt + Enter | ↵ (`ret`) |
| `.` and `` ` `` | . and (−) |
| `=` `\` `^` `@` | = trig ^ x² |
| `[` `]` | eˣ 10ˣ |
| `(` or F1, `)` or F2 | ( ) |
| `;` `'` | templates, catalog |
| `*`, `/` or F3, `+`, `-` | × ÷ + − |
| `<` `\|` `,` `?` `>` | EE π , ?!▸ flag |
| Arrow keys | The touchpad's edges (contract B `arrow`) |

Firebird also maps Alt + letters: Alt+D doc, Alt+M menu, Alt+V var, Alt+E EE, Alt+W ?!▸, Alt+F flag, Alt+Q =, Alt+T trig, Alt+P ^, Alt+2 x², Alt+X eˣ, Alt+1 10ˣ, Alt+O templates, Alt+C catalog, Alt+A ×. Browsers use some Alt keys themselves (in Chrome, Alt+D and Alt+F), so test any you copy.

## The touchpad

- Contract B `touch { x, y, contact, down }`: `x` and `y` from 0 to 1, top left 0, 0. `contact` means a finger is on the pad, `down` that the pad is pressed (a click). The core scales them to its own range and flips `y` (`touchpad_set_state` in `core/keypad.cpp`).
- Moving while `contact` is on moves the cursor by the change in position, like a laptop touchpad: the core adds a quarter of each move to the counters the OS reads. The first event of a touch only sets the position.
- Pressing (`down`) near an edge is an arrow, in the middle a click: the real touchpad is also a clickpad. The worker's `arrow` message presses the exact edge for the PC arrow keys.
- Firebird's mouse rules (`qml/Touchpad.qml`), worth copying. Send `touch` with the current position on every change:
  1. Press: `contact` on, `down` off; start a 200 ms timer.
  2. Move more than 5 px: stop the timer (a drag moves the cursor).
  3. The timer fires (held still for 200 ms): `down` on (press and hold, for dragging things).
  4. Release before the timer fired: a click: `down` on for 100 ms, then everything off.
  5. Release otherwise: everything off.
- Show the finger: Firebird draws a dot, yellow while down, blue while only touching.

## The screen

- Draw each `frame` with `putImageData`. Frames come only when the picture changes, at most about 60 a second; there is nothing to draw between them.
- `lcd { on: false }`: the calculator turned its screen off (asleep or off). Paint it black; the next `frame` means it is on again.
- Sharp pixels: keep the canvas at 320 × 240 with `image-rendering: pixelated`, and make its CSS width 320 × k / devicePixelRatio for a whole number k, so every calculator pixel is k × k device pixels. `fit()` in the starter does this and runs again when devicePixelRatio changes: browser zoom, Windows scaling, or moving the window to a projector. A resize event does not always come with it.
- `speed` (about every 0.5 s; 1 = real speed) and `status`: show them small, outside the calculator.

## Files and storage

- `load` takes boot1 with a flash image, or boot1 with boot2 (+ manuf, diags, OS) to build one. Wait for `loaded` before `start`: with `remember`, the real worker is still storing the files until then.
- `remember: true` stores the setup in this browser. On every visit, send `queryStorage`; when `storage.exists`, offer to resume (`start { saved: true }`), which takes about 1.3 s with a snapshot.
- Send `save` when `document.visibilityState` becomes `hidden`: the snapshot takes about 3.5 s, too long for the moment a tab closes.
- `.tns` documents: let users drop them on the calculator, send `sendFile { name: '/' + file.name, data }` and show `progress`.
- TI files never ship with the component: the user picks them (a file input or a drop), or a page passes URLs (in development, `/roms/`). Keep `roms/` out of git.

## Proposed API (contract A, draft)

`PLAN.md` lists the attributes `boot1` and `flash`, the methods `start()`, `reset()` and `sendFile()`, and the events `ready`, `error` and `speed`. Below is a fuller draft to start the discussion. The team decides and writes the result in `web/contract-a.md`.

```html
<script type="module" src="nspire-emu.js"></script>
<nspire-emu boot1="files/boot1.img.tns" flash="files/flash.img" remember></nspire-emu>
```

| Kind | Name | Meaning |
|---|---|---|
| Attribute | `boot1`, `flash` | URLs of the files; or `boot1` with `boot2`, `manuf`, `diags`, `os` to build a flash image |
| Attribute | `remember` | Store the setup in this browser and resume it next time |
| Attribute | `turbo` | Full speed while the calculator computes |
| Attribute | `zoom` | Screen size in CSS pixels per calculator pixel, rounded to sharp pixels |
| Attribute | `worker` | Worker URL, relative to `nspire-emu.js` (`fake-worker.js` while developing) |
| Method | `load(files, options)` → Promise | Files as ArrayBuffers or `File`s; resolves on `loaded` |
| Method | `start({ saved })`, `reset()`, `save()`, `forget()` | As in contract B |
| Method | `sendFile(name, file)`, `sendOS(file)` → Promise | Resolve at 100 %, reject on an error |
| Method | `press(name, ms = 100)` | Taps a key, so the Phase 5 tests can script the calculator |
| Event | `ready`, `loaded`, `started`, `speed`, `status`, `lcd`, `progress`, `storage`, `error` | `event.detail` is the contract B message (the starter does this already) |

## Order of work

Every step but the last can be tested with the fake worker.
1. The starter runs (`web/nspire-emu.js`, `web/demo.html`).
2. Body and the full keypad, looking like your calculator (key data above).
3. Key input: the pointer rules, the right-click latch, the PC keyboard table.
4. The touchpad.
5. The screen: sharp pixels, LCD off, speed and status.
6. Files and storage: pick or drop files, resume, save when hidden, `.tns` with progress.
7. The API (contract A), then the real worker: build, load your files from `/roms/`, test on the real OS.

With several people: (a) body and keypad look; (b) input: keys, PC keyboard, touchpad; (c) screen, files, storage and the API. The parts meet in `nspire-emu.js`, so agree on the key data format (above) first.

## What Claude checks in review

- Only contract B messages; nothing reaches into `firebird.js`.
- Every press gets exactly one release: pointer up or cancel, focus loss, a hidden page. No auto-repeat is sent.
- `start` only after `loaded` (or, to resume, after `storage` with `exists`).
- Sharp pixels at 100 %, 125 % and 150 % Windows scaling and with browser zoom.
- `save` on `visibilitychange`; no TI files in git or in the page.
- Smooth: no work per frame besides `putImageData`, no layout changes on every frame.
- A blank page with only `<nspire-emu>` works.

## Answers to the research questions in `COMPONENTS.md` [1]

- Row and column of every key: the key data above. Firebird uses one matrix and one keypad for the CX and the CX II.
- `touchpad_set_state` and `Touchpad.qml`: The touchpad, above.
- PC keys (`code` or `key`, auto-repeat, focus loss, Vietnamese typing tools): PC keyboard, above. Still to test: Unikey on the demo laptop.
- Pointer input (two keys at once, multi-touch, `pointercancel`): Pointer input, above.
- Sharp scaling: The screen, above.
