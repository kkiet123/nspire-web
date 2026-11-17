// nspire-emu.js: the <nspire-emu> web component (Phase 3).
//
// A TI-Nspire CX CAS in the page: body, screen, keypad and touchpad. TI's own
// OS runs in the Firebird emulator inside a Web Worker, and this element talks
// to that worker only through contract B (web/contract-b.md). Guide and API:
// research/1-nspire-emu.md.
//
//   <script type="module" src="nspire-emu.js"></script>
//   <nspire-emu boot1="boot1.img" flash="flash.img" remember></nspire-emu>
//
// Attributes: boot1, flash, boot2, manuf, diags, os (file URLs, relative to the
// page); remember (keep the calculator in this browser and resume it); turbo;
// zoom ("auto" or a scale); worker (URL relative to this file); manual (start
// only when the page calls load() and start()).
// Methods: load(files, options), start({ saved }), reset(), save(), forget(),
// sendFile(name, data), sendOS(data), sendFiles(files), press(name, ms).
// Events: every worker message but 'frame' (ready, loaded, started, lcd,
// speed, status, log, usblink, progress, storage, error); detail = the message.

// ---- Keys ----------------------------------------------------------------

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

function keyMessage(name) {
  const i = KEYMAP.indexOf(name);
  return { type: 'key', row: Math.floor(i / 11), col: i % 11 };
}

// PC keyboard, after Firebird's qtkeypadbridge.cpp. Symbols by event.key
// (they sit elsewhere on other layouts), the rest by event.code; a key is
// released by the same event.code that pressed it.
const BY_KEY = {
  '(': 'pleft', ')': 'pright', '*': 'mult', '/': 'div', '+': 'plus', '-': 'minus', '_': 'minus',
  '^': 'pow', '=': 'equ', '.': 'dot', ',': 'comma', '<': 'ee', '|': 'pi', '?': 'punct', '>': 'flag',
  '\\': 'trig', '@': 'squ', '[': 'exp', ']': 'pow10', ';': 'metrix', "'": 'cat', '`': 'neg', ' ': 'space',
};
const BY_CODE = {
  Escape: 'esc', End: 'pad', Tab: 'tab', Home: 'on', PageUp: 'doc', PageDown: 'menu',
  ControlLeft: 'ctrl', ControlRight: 'ctrl', ShiftLeft: 'shift', ShiftRight: 'shift', Insert: 'var',
  Backspace: 'del', Delete: 'del', Enter: 'enter', NumpadEnter: 'enter', Space: 'space',
  F1: 'pleft', F2: 'pright', F3: 'div',
};
for (let i = 0; i < 26; i++) BY_CODE['Key' + String.fromCharCode(65 + i)] = 'a' + String.fromCharCode(97 + i);
for (let i = 0; i < 10; i++) BY_CODE['Digit' + i] = BY_CODE['Numpad' + i] = 'n' + i;
const ARROWS = { ArrowUp: 0, ArrowDown: 1, ArrowLeft: 2, ArrowRight: 3 };

// ---- Layout ----------------------------------------------------------------
// Units: the screen is 320 x 240 units, as on the calculator. Positions and
// colours come from a photo of a CX CAS (Wikimedia Commons, "TI-nspire CX
// CAS.jpg"); the empty margins are a little smaller, so it fits a laptop
// screen.
const W = 424, H = 860;

const svg = (box, body) => `<svg viewBox="${box}" aria-hidden="true">${body}</svg>`;
const ICON = {
  pad: svg('0 0 16 16', '<rect x="2.5" y="1.5" width="11" height="13" rx="1.5"/><path d="M5 5h6M5 8.5h1.5M9.5 8.5h1.5M5 11.5h1.5M9.5 11.5h1.5"/>'),
  home: svg('0 0 16 16', '<path d="M2.5 8.5 8 3.5l5.5 5M4.5 7v6.5h7V7"/>'),
  templates: svg('0 0 20 14', '<rect x="1.5" y="1.5" width="7" height="11" rx=".5"/><rect x="11.5" y="1.5" width="7" height="4.5" rx=".5"/><rect x="11.5" y="8" width="7" height="4.5" rx=".5"/>'),
  catalog: svg('0 0 20 14', '<path d="M10 3.2C7.6 1.6 4.6 1.3 1.5 2.3v9.8c3.1-1 6.1-.7 8.5.9 2.4-1.6 5.4-1.9 8.5-.9V2.3c-3.1-1-6.1-.7-8.5.9zM10 3.2V13"/>'),
  flag: svg('0 0 16 16', '<path d="M4 14.5V2h8.5l-2.2 3 2.2 3H4"/>'),
  menu: svg('0 0 16 12', '<rect x="1.5" y="1.5" width="13" height="9" rx="1"/><path d="M4 4.5h8M4 7.5h5"/>'),
};

// Every key: [name, label (HTML), x, y, width, height, style, ctrl label above it, spoken name].
function keypad() {
  const keys = [
    ['esc', 'esc', 37, 317, 49, 26, 'fn', '↶'],
    ['pad', ICON.pad, 37, 365, 49, 26, 'fn', 'save', 'scratchpad'],
    ['tab', 'tab', 37, 413, 49, 26, 'fn'],
    ['on', ICON.home + 'on', 338, 317, 49, 26, 'fn', 'off', 'on'],
    ['doc', 'doc ▸', 338, 365, 49, 26, 'fn', '+ page', 'doc'],
    ['menu', 'menu', 338, 413, 49, 26, 'fn', ICON.menu],
    ['ctrl', 'ctrl', 37, 470, 49, 25, 'ctrl'],
    ['shift', '⇧shift', 126, 470, 46, 25, 'fn small', 'CAPS', 'shift'],
    ['var', 'var', 252, 470, 46, 25, 'fn', 'sto→'],
    ['del', 'del', 338, 470, 49, 25, 'fn', 'clear'],
  ];
  const rowY = [512, 556, 600, 644];
  const leftPairs = [
    [['equ', '=', '≠≥▸'], ['trig', 'trig', '?']],
    [['pow', '^', 'ⁿ√x'], ['squ', 'x²', '√']],
    [['exp', 'eˣ', 'ln'], ['pow10', '10ˣ', 'log']],
    [['pleft', '(', '[ ]'], ['pright', ')', '{ }']],
  ];
  const numbers = [
    [['n7', '7'], ['n8', '8'], ['n9', '9']],
    [['n4', '4'], ['n5', '5'], ['n6', '6']],
    [['n1', '1'], ['n2', '2'], ['n3', '3']],
    [['n0', '0'], ['dot', '.', 'capture'], ['neg', '(−)', 'ans', 'negative']],
  ];
  const rightPairs = [
    [['metrix', ICON.templates, ':=', 'templates'], ['cat', ICON.catalog, '∞β°', 'catalog']],
    [['mult', '×', '"□"'], ['div', '÷']],
    [['plus', '+', '◐+'], ['minus', '−', '◐−']],
  ];
  rowY.forEach((y, r) => {
    leftPairs[r].forEach(([name, label, ctrl], i) => keys.push([name, label, 37 + i * 36, y, 33, 28, 'pair', ctrl]));
    numbers[r].forEach(([name, label, ctrl, spoken], i) => keys.push([name, label, 126 + i * 63, y, 46, 28, 'num', ctrl, spoken]));
    if (r < 3) rightPairs[r].forEach(([name, label, ctrl, spoken], i) => keys.push([name, label, 318 + i * 36, y, 33, 28, 'pair', ctrl, spoken]));
  });
  keys.push(['enter', 'enter', 318, rowY[3], 69, 28, 'fn', '≈']);
  const letters = [
    [['ee', 'EE'], 'A', 'B', 'C', 'D', 'E', 'F', 'G', ['punct', '?!▸', 'punctuation']],
    [['pi', 'π▸', 'pi'], 'H', 'I', 'J', 'K', 'L', 'M', 'N', ['flag', ICON.flag, 'flag']],
    [['comma', ','], 'O', 'P', 'Q', 'R', 'S', 'T', 'U', ['ret', '↵', 'return']],
    [null, 'V', 'W', 'X', 'Y', 'Z', ['space', '␣', 'space']],
  ];
  letters.forEach((row, r) => row.forEach((k, c) => {
    if (!k) return;
    const [name, label, spoken] = typeof k === 'string' ? ['a' + k.toLowerCase(), k] : k;
    const width = name === 'space' ? 68.5 : 29;
    keys.push([name, label, 41 + c * 39.5, 690 + r * 34, width, 24, 'letter', '', spoken]);
  }));
  return keys;
}

const STYLE = `
:host { display: inline-block; vertical-align: top; outline: none; -webkit-tap-highlight-color: transparent; }
.calc { position: relative; width: ${W}px; height: ${H}px; box-sizing: border-box;
  border-radius: 22px 22px 40px 40px / 22px 22px 48px 48px;
  background: linear-gradient(90deg, #3a3935, #1d1c1a 3%, #171614 50%, #1d1c1a 97%, #3a3935);
  box-shadow: 0 12px 34px rgba(0, 0, 0, .38), inset 0 1px 0 rgba(255, 255, 255, .1);
  font-family: "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif;
  user-select: none; -webkit-user-select: none; cursor: default; }
:host(:focus-visible) .calc { box-shadow: 0 0 0 3px #5b9dff, 0 12px 34px rgba(0, 0, 0, .38); }
.calc.drop { box-shadow: 0 0 0 4px #43a047, 0 12px 34px rgba(0, 0, 0, .38); }
.lower { position: absolute; left: 10px; right: 10px; top: 452px; bottom: 12px;
  border-radius: 10px 10px 30px 30px / 10px 10px 38px 38px;
  background: linear-gradient(#2a2926, #242320 60%, #21201d);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .07), 0 -1px 0 #0d0d0c; }
.brand, .cas { position: absolute; top: 13px; color: #d7d1c5; font-size: 16px; line-height: 20px; }
.brand { left: 44px; font-style: italic; font-weight: 300; letter-spacing: .3px; }
.cas { right: 44px; font-weight: 700; letter-spacing: .6px; }
.bezel { position: absolute; left: 44px; top: 40px; width: 336px; height: 256px; border-radius: 6px;
  background: #060606; box-shadow: inset 0 0 0 1px #2b2a28, inset 0 0 10px #000; }
canvas { position: absolute; left: 52px; top: 48px; width: 320px; height: 240px; background: #000; image-rendering: pixelated; }
.key { position: absolute; box-sizing: border-box; display: flex; align-items: center; justify-content: center; gap: 1px;
  border-radius: 6px; color: #f4f3ef; font-size: 12px; font-weight: 600; line-height: 1; white-space: nowrap;
  cursor: pointer; touch-action: none;
  background: linear-gradient(#3a3935, #1c1b19 70%);
  box-shadow: 0 2px 0 #080807, 0 3px 4px rgba(0, 0, 0, .45), inset 0 1px 0 rgba(255, 255, 255, .13); }
.key::after { content: ''; position: absolute; inset: -4px; }
.key.small { font-size: 11px; }
.key.num { background: linear-gradient(#7d7b76, #5c5a56 75%); font-size: 17px; font-weight: 700; }
.key.pair { font-size: 13px; }
.key.letter { font-size: 11.5px; border-radius: 5px; }
.key.ctrl { background: linear-gradient(#d6e7ec, #a9c3cb 75%); color: #16262f; }
.key.down, .key.latched { transform: translateY(1.5px); filter: brightness(1.35);
  box-shadow: 0 .5px 0 #080807, inset 0 1px 3px rgba(0, 0, 0, .45); }
.key.latched { outline: 1.5px solid #79b8ff; outline-offset: 1px; }
.key svg { width: 15px; height: 13px; flex: none; }
.label { position: absolute; height: 10px; display: flex; align-items: center; justify-content: center;
  color: #a7b3b1; font-size: 8.5px; font-weight: 600; white-space: nowrap; pointer-events: none; }
.label svg { width: 11px; height: 8px; }
svg { fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.touchpad { position: absolute; left: 126px; top: 312px; width: 172px; height: 130px; box-sizing: border-box;
  border: 3px solid #b4b1a7; border-radius: 22px; touch-action: none; cursor: pointer;
  background: radial-gradient(ellipse at 50% 35%, #2d2b28, #191816 75%);
  box-shadow: inset 0 2px 8px #000, 0 1px 2px #000; }
.ring { position: absolute; left: 50%; top: 50%; width: 34px; height: 34px; margin: -17px 0 0 -17px; box-sizing: border-box;
  border: 1.5px solid #8f8c83; border-radius: 9px; pointer-events: none; }
.arrow { position: absolute; color: #c9c6bc; font-size: 7px; line-height: 7px; pointer-events: none; }
.dot { position: absolute; width: 12px; height: 12px; margin: -6px 0 0 -6px; border-radius: 50%; display: none;
  pointer-events: none; background: rgba(130, 130, 255, .75); }
.dot.down { background: rgba(237, 242, 0, .8); }
.credit { position: absolute; left: 0; right: 0; bottom: 22px; text-align: center; color: #6e6c66; font-size: 9px; letter-spacing: .3px; }
`;

const DROP_HINT = ['Drop your TI files here:', 'boot1 and a flash image, or', 'boot1, boot2 (+ manuf, diags, OS)'];
const OS_FILE = /\.(tco|tcc|tco2|tcc2|tct2)$/i;

class NspireEmu extends HTMLElement {
  static get observedAttributes() { return ['zoom', 'turbo']; }

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${STYLE}</style>
      <div class="calc" part="body">
        <div class="lower"></div>
        <div class="brand">nspire-web</div><div class="cas">CAS</div>
        <div class="bezel"></div>
        <canvas width="320" height="240" part="screen"></canvas>
        <div class="touchpad" role="button" aria-label="touchpad">
          <span class="arrow" style="left: 50%; top: 6px; transform: translateX(-50%)">▲</span>
          <span class="arrow" style="left: 50%; bottom: 6px; transform: translateX(-50%)">▼</span>
          <span class="arrow" style="left: 7px; top: 50%; transform: translateY(-50%)">◀</span>
          <span class="arrow" style="right: 7px; top: 50%; transform: translateY(-50%)">▶</span>
          <div class="ring"></div><div class="dot"></div>
        </div>
        <div class="credit">nspire-web · Firebird emulator · GPLv3</div>
      </div>`;
    this.calc = root.querySelector('.calc');
    this.canvas = root.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.pad = root.querySelector('.touchpad');
    this.dot = root.querySelector('.dot');
    this.keyEls = new Map();
    for (const [name, label, x, y, w, h, style, ctrl, spoken] of keypad()) {
      const el = document.createElement('div');
      el.className = 'key ' + style;
      el.style.cssText = `left: ${x}px; top: ${y}px; width: ${w}px; height: ${h}px`;
      el.innerHTML = label;
      el.dataset.key = name;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', spoken || el.textContent || name);
      this.calc.append(el);
      this.keyEls.set(name, el);
      if (ctrl) {
        const tag = document.createElement('div');
        tag.className = 'label';
        tag.style.cssText = `left: ${x - 8}px; top: ${y - 11}px; width: ${w + 16}px`;
        tag.innerHTML = ctrl;
        this.calc.append(tag);
      }
    }
    this.sources = new Map();   // key name -> what holds it down (pointers, PC keys, latch, press())
    this.kbd = new Map();       // event.code -> key name, or an arrow direction
    this.pointers = new Map();  // pointerId -> key name
    this.tp = null;             // the pointer on the touchpad
    this.onResize = () => {
      cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = requestAnimationFrame(() => this.fit());
    };
    this.onDpr = () => this.fit();
    this.onVisibility = () => {
      if (document.visibilityState !== 'hidden') return;
      this.releaseAll();
      if (this.started && this.hasAttribute('remember')) this.save();   // a snapshot takes about 3.5 s
    };
    this.wireKeys();
    this.wireTouchpad();
    this.wireKeyboard();
    this.wireDrop();
  }

  connectedCallback() {
    if (this.worker) return;                       // moved within the page: keep running
    if (!this.hasAttribute('tabindex')) this.tabIndex = 0;
    this.setAttribute('role', 'application');
    this.setAttribute('aria-label', 'TI-Nspire CX CAS calculator');
    this.started = false;
    this.booted = false;
    this.frames = 0;
    this.lcdOff = false;
    const url = new URL((this.getAttribute('worker') || 'worker.js') + '?v=__BUILD__', import.meta.url);
    this.worker = new Worker(url);
    this.worker.onmessage = (e) => this.onMessage(e.data);
    this.worker.onerror = (e) => this.fail('The emulator could not start: ' + (e.message || 'see the console'));
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.fit();
    this.screenText(['Starting...']);
    if (this.hasAttribute('turbo')) this.post({ type: 'turbo', on: true });
    this.post({ type: 'queryStorage' });          // the worker queues it until it is ready
  }

  disconnectedCallback() {
    setTimeout(() => {                             // removed for good, not moved: stop the emulator
      if (this.isConnected || !this.worker) return;
      this.worker.terminate();
      this.worker = null;
      window.removeEventListener('resize', this.onResize);
      document.removeEventListener('visibilitychange', this.onVisibility);
      if (this.dprQuery) this.dprQuery.removeEventListener('change', this.onDpr);
    });
  }

  attributeChangedCallback(name) {
    if (!this.worker) return;
    if (name === 'zoom') this.fit();
    if (name === 'turbo') this.post({ type: 'turbo', on: this.hasAttribute('turbo') });
  }

  get turbo() { return this.hasAttribute('turbo'); }
  set turbo(on) { this.toggleAttribute('turbo', !!on); }

  // ---- Public methods (contract A draft, research/1-nspire-emu.md) ----------

  // files: { boot1, flash } or { boot1, boot2, manuf?, diags?, os? }, as
  // ArrayBuffers, Blobs or Files. Resolves when the worker says 'loaded'.
  async load(files, { osInFlash = false, remember = this.hasAttribute('remember') } = {}) {
    const buffers = {};
    for (const [kind, data] of Object.entries(files)) {
      if (data) buffers[kind] = data instanceof Blob ? await data.arrayBuffer() : data;
    }
    return new Promise((resolve, reject) => {
      this.waitLoad = { resolve, reject };
      this.post({ type: 'load', files: buffers, osInFlash, remember });
    });
  }
  start({ saved = false } = {}) { this.post({ type: 'start', saved }); }
  reset() { this.post({ type: 'reset' }); }
  save({ snapshot = true } = {}) { this.post({ type: 'save', snapshot }); }
  forget() { this.post({ type: 'forget' }); }

  async sendFile(name, data) {
    const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
    return this.transfer('file', { type: 'sendFile', name, data: buffer });
  }
  async sendOS(data) {
    const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
    return this.transfer('os', { type: 'sendOS', data: buffer });
  }
  // Files the user picked or dropped: documents and OS files while running;
  // before that, the TI files to start from.
  async sendFiles(files) {
    files = [...files];
    if (!this.started) return this.useDroppedFiles(files);
    for (const file of files) {
      const send = OS_FILE.test(file.name) ? this.sendOS(file) : this.sendFile('/' + file.name, file);
      await send.catch(() => {});                  // the 'progress' and 'error' events tell the page
    }
  }
  // Taps a key, as a finger would (for scripted tests).
  async press(name, ms = 100) {
    if (!KEYMAP.includes(name)) throw new Error('Unknown key: ' + name);
    this.setKey(name, 'api', true);
    await new Promise((r) => setTimeout(r, ms));
    this.setKey(name, 'api', false);
  }

  // ---- Worker messages (contract B) ------------------------------------------

  post(msg) { if (this.worker) this.worker.postMessage(msg); }

  onMessage(m) {
    switch (m.type) {
      case 'frame':
        this.ctx.putImageData(new ImageData(new Uint8ClampedArray(m.rgba), 320, 240), 0, 0);
        this.frames++;
        if (this.lcdOff) {
          this.lcdOff = false;
          this.dispatchEvent(new CustomEvent('lcd', { detail: { type: 'lcd', on: true } }));
        }
        return;
      case 'lcd':
        this.lcdOff = true;
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, 320, 240);
        break;
      case 'ready':
        if (m.protocol !== 1) console.warn(`<nspire-emu> expects contract B version 1, the worker speaks ${m.protocol}`);
        break;
      case 'storage':
        if (!this.booted) {
          this.booted = true;
          this.autostart(m);
        }
        break;
      case 'loaded':
        if (this.waitLoad) this.waitLoad.resolve(m);
        this.waitLoad = null;
        break;
      case 'started':
        this.started = true;
        break;
      case 'progress':
        if (this.waitTransfer && m.what === this.waitTransfer.what && (m.value < 0 || m.value >= 100)) {
          const { resolve, reject } = this.waitTransfer;
          this.waitTransfer = null;
          m.value < 0 ? reject(new Error('The transfer failed')) : resolve();
        }
        break;
      case 'error':
        if (this.waitLoad) this.waitLoad.reject(new Error(m.message));
        this.waitLoad = null;
        if (!this.frames || m.fatal) this.screenText(['Error', ...wrap(m.message, 44)], '#ff8a80');
        break;
    }
    this.dispatchEvent(new CustomEvent(m.type, { detail: m }));
  }

  // One file transfer at a time; resolves at 100 %.
  transfer(what, msg) {
    const run = () => new Promise((resolve, reject) => {
      this.waitTransfer = { what, resolve, reject };
      this.post(msg);
    });
    this.transfers = (this.transfers || Promise.resolve()).then(run, run);
    return this.transfers;
  }

  // Start by itself: resume what this browser saved, else the files named by
  // the attributes, else wait for the user to drop their files.
  async autostart(storage) {
    if (this.hasAttribute('manual')) return;
    if (storage.exists && this.hasAttribute('remember')) {
      this.screenText(['Resuming the saved calculator...']);
      this.start({ saved: true });
      return;
    }
    const files = {};
    for (const kind of ['boot1', 'flash', 'boot2', 'manuf', 'diags', 'os']) {
      if (this.getAttribute(kind)) files[kind] = new URL(this.getAttribute(kind), document.baseURI);
    }
    if (!files.boot1) {
      this.screenText(DROP_HINT);
      return;
    }
    try {
      this.screenText(['Loading the TI files...']);
      await Promise.all(Object.entries(files).map(async ([kind, url]) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${url.pathname}: HTTP ${res.status}`);
        files[kind] = await res.arrayBuffer();
      }));
      await this.load(files, { osInFlash: !!files.os && !files.flash });
      this.start();
    } catch (err) {
      this.fail(err.message);
      this.screenText(['Could not load the TI files:', ...wrap(err.message, 44), '', ...DROP_HINT]);
    }
  }

  async useDroppedFiles(files) {
    const got = this.dropped || (this.dropped = {});
    for (const file of files) {
      const name = file.name.toLowerCase();
      const kind = ['boot1', 'boot2', 'manuf', 'diags'].find((k) => name.includes(k))
        || (OS_FILE.test(name) ? 'os' : /flash|\.img$/.test(name) ? 'flash' : null);
      if (kind) got[kind] = file;
    }
    if (!got.boot1 || !(got.flash || got.boot2)) {
      this.screenText(['Got: ' + (Object.keys(got).join(', ') || 'nothing yet'),
        'Still needed: ' + [got.boot1 ? '' : 'boot1', got.flash || got.boot2 ? '' : 'a flash image or boot2'].filter(Boolean).join(', ')]);
      return;
    }
    this.screenText(['Loading your files...']);
    try {
      await this.load(got, { osInFlash: !!got.os && !got.flash });
      this.start();
    } catch (err) {
      this.dropped = null;
      this.screenText(['Could not use these files:', ...wrap(err.message, 44)], '#ff8a80');
    }
  }

  fail(message) {
    this.dispatchEvent(new CustomEvent('error', { detail: { type: 'error', message } }));
    if (!this.frames) this.screenText(['Error', ...wrap(message, 44)], '#ff8a80');
  }

  screenText(lines, color = '#c9c9c9') {
    const g = this.ctx;
    g.fillStyle = '#000';
    g.fillRect(0, 0, 320, 240);
    g.fillStyle = color;
    g.font = '13px "Segoe UI", system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    lines.forEach((line, i) => g.fillText(line, 160, 120 + (i - (lines.length - 1) / 2) * 19));
  }

  // ---- Size --------------------------------------------------------------
  // The screen gets a whole number of device pixels per calculator pixel, so
  // it stays sharp: the whole body is zoomed by k / devicePixelRatio, with
  // the largest k that fits the window (or the zoom attribute). Only when even
  // k = 1 does not fit does it scale freely, and smoothly.
  fit() {
    const dpr = window.devicePixelRatio || 1;
    const asked = Number(this.getAttribute('zoom'));
    let zoom = 0, sharp = true;
    if (asked > 0) {
      zoom = Math.max(1, Math.round(asked * dpr)) / dpr;
    } else {
      const room = Math.min((window.innerHeight - 8) / H, (window.innerWidth - 8) / W);
      const k = Math.floor(room * dpr + 1e-6);
      if (k >= 1) zoom = k / dpr;
      else { zoom = Math.max(.3, room); sharp = false; }
    }
    this.calc.style.zoom = zoom;
    this.canvas.style.imageRendering = sharp ? 'pixelated' : 'auto';
    // devicePixelRatio changes with browser zoom, Windows scaling and other
    // monitors, not always with a resize event.
    if (this.dprQuery) this.dprQuery.removeEventListener('change', this.onDpr);
    this.dprQuery = matchMedia(`(resolution: ${dpr}dppx)`);
    this.dprQuery.addEventListener('change', this.onDpr);
  }

  // ---- Input ---------------------------------------------------------------

  // A key is down while anything holds it: a pointer, a PC key, the
  // right-click latch or press(). The worker hears each change once.
  setKey(name, source, down) {
    let holders = this.sources.get(name);
    if (!holders) this.sources.set(name, holders = new Set());
    const before = holders.size > 0;
    if (down) holders.add(source); else holders.delete(source);
    const now = holders.size > 0;
    if (before === now) return;
    this.post({ ...keyMessage(name), down: now });
    const el = this.keyEls.get(name);
    if (el) el.classList.toggle('down', now);
  }

  // Pointer, keyboard and touchpad holds end; right-click latches stay.
  releaseAll() {
    for (const [id, name] of this.pointers) this.setKey(name, 'p' + id, false);
    this.pointers.clear();
    for (const [code, what] of this.kbd) {
      if (typeof what === 'number') this.post({ type: 'arrow', dir: what, down: false });
      else this.setKey(what, 'k' + code, false);
    }
    this.kbd.clear();
    if (this.tp) this.endTouch(true);
  }

  wireKeys() {
    const calc = this.calc;
    calc.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('.key');
      if (!el) return;
      e.preventDefault();
      this.focus({ preventScroll: true });
      const name = el.dataset.key;
      if (e.button === 2) {                        // right click: latch until the next right click
        const on = !el.classList.contains('latched');
        el.classList.toggle('latched', on);
        this.setKey(name, 'latch', on);
        return;
      }
      if (e.button !== 0 || this.pointers.has(e.pointerId)) return;
      capture(el, e.pointerId);                    // the release comes even if the finger slides off
      this.pointers.set(e.pointerId, name);
      this.setKey(name, 'p' + e.pointerId, true);
    });
    const up = (e) => {
      const name = this.pointers.get(e.pointerId);
      if (!name) return;
      this.pointers.delete(e.pointerId);
      this.setKey(name, 'p' + e.pointerId, false);
    };
    calc.addEventListener('pointerup', up);
    calc.addEventListener('pointercancel', up);
    calc.addEventListener('lostpointercapture', up);
    calc.addEventListener('contextmenu', (e) => e.preventDefault());
    this.addEventListener('blur', () => this.releaseAll());
  }

  // The touchpad, after Firebird's Touchpad.qml: moving with the finger down
  // moves the cursor; a quick tap is a click (down for 100 ms); holding still
  // for 200 ms presses and holds; a press at an edge is an arrow key.
  wireTouchpad() {
    const pad = this.pad;
    pad.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.tp) return;
      e.preventDefault();
      this.focus({ preventScroll: true });
      capture(pad, e.pointerId);
      const tp = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, down: false, lifted: false };
      tp.hold = setTimeout(() => { tp.hold = 0; tp.down = true; this.touch(tp); }, 200);
      this.tp = tp;
      this.touch(tp);
    });
    pad.addEventListener('pointermove', (e) => {
      const tp = this.tp;
      if (!tp || e.pointerId !== tp.id) return;
      tp.x = e.clientX;
      tp.y = e.clientY;
      if (tp.hold && Math.hypot(tp.x - tp.x0, tp.y - tp.y0) > 5) { clearTimeout(tp.hold); tp.hold = 0; }
      this.touch(tp);
    });
    const end = (e) => { if (this.tp && e.pointerId === this.tp.id) this.endTouch(e.type === 'pointercancel'); };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
  }

  endTouch(cancelled) {
    const tp = this.tp;
    this.tp = null;
    const lift = () => { tp.down = false; tp.lifted = true; this.touch(tp); };
    if (tp.hold && !cancelled) {                   // released before 200 ms: a click
      clearTimeout(tp.hold);
      tp.hold = 0;
      tp.down = true;
      this.touch(tp);
      setTimeout(lift, 100);
    } else {
      clearTimeout(tp.hold);
      lift();
    }
  }

  touch(tp) {
    const r = this.pad.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (tp.x - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (tp.y - r.top) / r.height));
    const contact = !tp.lifted;
    this.post({ type: 'touch', x, y, contact, down: tp.down });
    this.dot.style.display = contact ? 'block' : 'none';
    this.dot.style.left = x * 100 + '%';
    this.dot.style.top = y * 100 + '%';
    this.dot.classList.toggle('down', tp.down);
  }

  // PC keyboard: a physical key (event.code) releases exactly what it
  // pressed, even when Shift changed event.key in between.
  wireKeyboard() {
    this.addEventListener('keydown', (e) => {
      if (e.isComposing || e.key === 'Process') return;
      if (this.kbd.has(e.code)) { e.preventDefault(); return; }   // auto-repeat: the calculator repeats keys itself
      if (e.repeat) return;
      const enter = e.code === 'Enter' || e.code === 'NumpadEnter';
      const name = enter && e.altKey ? 'ret' : BY_KEY[e.key] || BY_CODE[e.code];
      if (name) {
        e.preventDefault();
        this.kbd.set(e.code, name);
        this.setKey(name, 'k' + e.code, true);
      } else if (e.code in ARROWS) {
        e.preventDefault();
        this.kbd.set(e.code, ARROWS[e.code]);
        this.post({ type: 'arrow', dir: ARROWS[e.code], down: true });
      }
    });
    this.addEventListener('keyup', (e) => {
      if (!this.kbd.has(e.code)) return;
      e.preventDefault();
      const what = this.kbd.get(e.code);
      this.kbd.delete(e.code);
      if (typeof what === 'number') this.post({ type: 'arrow', dir: what, down: false });
      else this.setKey(what, 'k' + e.code, false);
    });
  }

  // Drop .tns documents or an OS file on the calculator to send them; before
  // it runs, drop the TI files to start from.
  wireDrop() {
    this.addEventListener('dragover', (e) => {
      if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      this.calc.classList.add('drop');
    });
    this.addEventListener('dragleave', () => this.calc.classList.remove('drop'));
    this.addEventListener('drop', (e) => {
      e.preventDefault();
      this.calc.classList.remove('drop');
      if (e.dataTransfer && e.dataTransfer.files.length) this.sendFiles(e.dataTransfer.files);
    });
  }
}

// Pointer capture, when the browser has the pointer (a scripted or an
// already-lifted pointer has none; the key still works, without capture).
function capture(el, pointerId) {
  try { el.setPointerCapture(pointerId); } catch { /* no active pointer */ }
}

function wrap(text, width) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    if (line && (line + ' ' + word).length > width) { lines.push(line); line = word; } else line = line ? line + ' ' + word : word;
  }
  if (line) lines.push(line);
  return lines.slice(0, 5);
}

customElements.define('nspire-emu', NspireEmu);
