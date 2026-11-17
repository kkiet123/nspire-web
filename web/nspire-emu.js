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
// Units: the screen is 320 x 240 units, as on the calculator. Positions,
// colours and symbols come from photos of a CX CAS (the team's own, and
// Wikimedia Commons "TI-nspire CX CAS.jpg"); the empty margins are a little
// smaller, so it fits a laptop screen.
const W = 424, H = 860;

// An icon drawn at its own size: one view-box unit is one layout unit.
const svg = (w, h, body) => `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">${body}</svg>`;
const fill = (body) => `<g fill="currentColor" stroke="none">${body}</g>`;
const grid = (xs, ys, w, h) => ys.map((y) => xs.map((x) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx=".3"/>`).join('')).join('');
const ICON = {
  // On the keys
  pad: svg(20, 14, '<path d="M2 13 5.5 1M4.6 13 8.1 1M7.2 13 10.7 1"/><rect x="11.5" y="1" width="7.5" height="12" rx="1"/><path d="M13 3.4h4.5"/>'
    + fill(grid([12.9, 14.9, 16.9], [5.6, 7.9, 10.2], 1.4, 1.2))),
  home: svg(15, 14, '<path d="M1.5 7.2 7.5 2l6 5.2"/><path d="M3.2 5.8V13h3.4V9.4h1.8V13h3.4V5.8"/><path d="M10.6 4.6V2.1h1.5v3.8"/>'),
  shift: svg(11, 13, '<path d="M5.5 1.2 1 6.8h2.6V12h3.8V6.8H10z"/>'),
  back: svg(17, 5, '<path d="M16 2.5H2.5M5.2.5 2 2.5l3.2 2" stroke-width="1.4"/>'),
  caret: svg(15, 9, '<path d="M2 7.6 7.5 2.2l5.5 5.4" stroke-width="2"/>'),
  templates: svg(19, 12, '<path d="M1.5 1.5v9M7.3 1.5v9"/><rect x="2.9" y="4" width="3" height="4" rx=".4"/>'
    + '<path d="M12.6 1.5c-1.1 0-1.4.5-1.4 1.4v1.5c0 .8-.4 1.6-1.2 1.6.8 0 1.2.8 1.2 1.6v1.5c0 .9.3 1.4 1.4 1.4"/>'
    + '<rect x="14.3" y="2" width="3" height="3" rx=".4"/><rect x="14.3" y="7" width="3" height="3" rx=".4"/>'),
  catalog: svg(20, 12, '<path d="M10 2.6C8 1.3 4.9 1 1.5 1.8v8.9c3.4-.8 6.5-.5 8.5.8 2-1.3 5.1-1.6 8.5-.8V1.8C15.1 1 12 1.3 10 2.6zM10 2.6v8.9"/>'),
  flag: svg(12, 13, '<path d="M2.5 12.5V1.5h8l-2 2.8 2 2.8h-8"/>'),
  ret: svg(14, 10, '<path d="M12.5 1v5.5H2"/><path d="M4.8 3.6 2 6.5l2.8 2.9"/>'),
  space: svg(18, 8, '<path d="M2 1.5v5h14v-5" stroke-width="2.2" stroke-linecap="butt" stroke-linejoin="miter"/>'),
  // The TI logo, simplified: Texas, and on it a bold white i, slanted like
  // the imaginary unit, laid over a t, so that only the two ends of the t's
  // crossbar show beside the i. Replace it with TI's own artwork when the
  // team has it.
  ti: svg(18, 17, fill('<path d="M.4 7.3 4.9 7 5 .5h3.8v2.8c1.2.6 2.4.9 3.8 1.1l3.8.4v2.3l.5 3.3-1.5.7-1.6 1-1.7 1.2.3 2.8-3-2.3-1.8-2.9-3 .6-1.5-.9z"/>')
    + '<g stroke="#1d1c1b" stroke-width="3.1"><path d="M10.9 5.6 8.6 11.6q-.4 1.1.9.5"/><path d="M8 7.6h4.3" stroke-width="2.1"/></g>'
    + '<circle cx="11.5" cy="3.7" r="1.55" fill="#1d1c1b" stroke="none"/>'
    + '<g stroke="#f7f7f4"><path d="M8.1 7.6h4.1" stroke-width="1.1" stroke-linecap="butt"/><path d="M10.9 5.6 8.6 11.6q-.4 1.1.9.5" stroke-width="2.1"/></g>'
    + '<circle cx="11.5" cy="3.7" r="1" fill="#f7f7f4" stroke="none"/>'),
  // ctrl functions, printed above the keys
  undo: svg(11, 9, '<path d="M3.5 3h4a3 3 0 0 1 0 6H5"/><path d="M5.5 1 3.2 3l2.3 2"/>'),
  context: svg(13, 10, '<path d="M1 1h7.5v8H1z"/><path d="M2.7 3.3h4M2.7 5.3h4M2.7 7.3h2.5"/><path d="M9 5v4.3l1.1-1 .9 1.6.8-.4-.9-1.6h1.5z" fill="currentColor" stroke-width=".5"/>'),
  help: svg(10, 10, '<circle cx="5" cy="5" r="4.2"/><path d="M3.7 3.9a1.35 1.35 0 1 1 1.9 1.25c-.4.2-.6.5-.6.9v.3"/>' + fill('<circle cx="5" cy="7.7" r=".6"/>')),
  root: svg(12, 9, '<path d="M1 5.2l1.6 2.3L5.2 1.2h6"/>'),
  frac: svg(6, 10, '<rect x="1.4" y=".7" width="3.2" height="3" rx=".4"/><path d="M.6 5h4.8"/><rect x="1.4" y="6.3" width="3.2" height="3" rx=".4"/>'),
  quoted: svg(13, 8, '<path d="M1.3 1.2v2M3 1.2v2M10 1.2v2M11.7 1.2v2"/><rect x="4.6" y="2" width="3.8" height="3.8" rx=".5"/>'),
  contrastUp: svg(14, 9, '<circle cx="4.6" cy="4.5" r="3.6"/><path d="M4.6.9a3.6 3.6 0 0 0 0 7.2z" fill="currentColor"/>' + fill('<path d="M10 2.2v4.6l3-2.3z"/>')),
  contrastDown: svg(14, 9, fill('<path d="M4 2.2v4.6L1 4.5z"/>') + '<circle cx="9.4" cy="4.5" r="3.6"/><path d="M9.4.9a3.6 3.6 0 0 1 0 7.2z" fill="currentColor"/>'),
  // The touchpad and the ctrl + arrow functions around it
  hand: svg(13, 11, '<path d="M3 6.2V3.6a1 1 0 0 1 2 0v1.8M5 5V2.8a1 1 0 0 1 2 0v2.4M7 5V3.2a1 1 0 0 1 2 0V6M9 5.2a1 1 0 0 1 2 0v1.6c0 2.2-1.6 3.6-3.8 3.6H6.4C4.6 10.4 3.4 9.4 2.6 8L1.4 6a.9.9 0 0 1 1.5-1z"/>'),
  click: svg(13, 12, '<path d="M4.2 1v1.8M1 4.2h1.8M1.8 1.8 3 3M6.6 1.8 5.5 3M1.8 6.6 3 5.5"/>' + fill('<path d="M5.6 5.2 11.8 7.6l-2.5.9 1.9 2.3-1 .8-1.8-2.3-1.5 2.2z"/>')),
  up: svg(7, 5, fill('<path d="M3.5.5 6.5 4.5h-6z"/>')),
  down: svg(7, 5, fill('<path d="M3.5 4.5 6.5.5h-6z"/>')),
  left: svg(5, 7, fill('<path d="M.5 3.5 4.5.5v6z"/>')),
  right: svg(5, 7, fill('<path d="M4.5 3.5.5.5v6z"/>')),
  edgeTop: svg(26, 12, '<path d="M2 11.2c.2-3.4 2.2-5.6 5.6-6"/><path d="M5.4 3.2l2.4 1.8-2 2.3"/>'
    + fill(grid([10, 15.2, 20.4], [1.6], 4.2, 3.2) + grid([10, 15.2], [6], 4.2, 3.2))),
  edgeBottom: svg(24, 12, '<path d="M1.5 2h7.2l3 3v6H1.5z"/><path d="M8.7 2v3h3"/><path d="M21.5 1c-.4 3-1.9 5-4.8 6.2"/><path d="M16.9 4.6l-.4 2.7 2.7.5"/>'),
  edgeLeft: svg(13, 13, '<path d="M1.5 1.5h7l3 3v7h-10z"/><path d="M8.5 1.5v3h3"/>' + fill('<path d="M7.6 5v4.6L4.5 7.3z"/>')),
  edgeRight: svg(13, 13, '<path d="M1.5 1.5h7l3 3v7h-10z"/><path d="M8.5 1.5v3h3"/>' + fill('<path d="M4.6 5v4.6l3.1-2.3z"/>')),
};

// The keys use a bold rounded face, as on the calculator: Arial Rounded MT
// Bold where installed. @font-face is ignored inside a shadow root, so it
// goes into the document.
function addFonts() {
  if (document.getElementById('nspire-emu-fonts')) return;
  const style = document.createElement('style');
  style.id = 'nspire-emu-fonts';
  style.textContent = '@font-face { font-family: "Nspire Keys"; font-weight: 700; src: local("Arial Rounded MT Bold"), local("ArialRoundedMTBold"); }';
  document.head.append(style);
}

// Every key: [name, label (HTML), x, y, width, height, style, ctrl label above it, spoken name].
function keypad() {
  const stack = (top, below) => `<span class="stack">${top}${below}</span>`;
  const keys = [
    ['esc', 'esc', 37, 331, 49, 26, 'fn', ICON.undo],
    ['pad', ICON.pad, 37, 379, 49, 26, 'fn', 'save', 'scratchpad'],
    ['tab', 'tab', 37, 427, 49, 26, 'fn'],
    ['on', ICON.home + 'on', 338, 331, 49, 26, 'fn', 'off', 'on'],
    ['doc', 'doc<span class="tri">▾</span>', 338, 379, 49, 26, 'fn', '+page', 'doc'],
    ['menu', 'menu', 338, 427, 49, 26, 'fn', ICON.context],
    // The row under the touchpad, the number rows and enter use a lighter,
    // slimmer face than the keys around the touchpad ('mid').
    ['ctrl', 'ctrl', 37, 484, 49, 25, 'ctrl mid'],
    ['shift', ICON.shift + 'shift', 126, 484, 46, 25, 'fn mid small', 'CAPS', 'shift'],
    ['var', 'var', 252, 484, 46, 25, 'fn mid', 'sto→'],
    ['del', stack('del', ICON.back), 338, 484, 49, 25, 'fn mid', 'clear', 'del'],
  ];
  const rowY = [526, 570, 614, 658];
  const sym = (s) => `<span class="sym">${s}</span>`;
  const leftPairs = [
    [['equ', sym('='), '|≠≥▸', '='], ['trig', stack('trig', '<span class="tri">▸</span>'), ICON.help, 'trig']],
    [['pow', ICON.caret, 'ⁿ√x', 'power'], ['squ', 'x²', ICON.root]],
    [['exp', 'eˣ', 'ln'], ['pow10', '10ˣ', 'log']],
    [['pleft', sym('('), '[ ]', '('], ['pright', sym(')'), '{ }', ')']],
  ];
  const numbers = [
    [['n7', '7'], ['n8', '8'], ['n9', '9']],
    [['n4', '4'], ['n5', '5'], ['n6', '6']],
    [['n1', '1'], ['n2', '2'], ['n3', '3']],
    [['n0', '0'], ['dot', '<span class="dp"></span>', 'capture', 'decimal point'], ['neg', '<span class="neg">(−)</span>', 'ans', 'negative']],
  ];
  const rightPairs = [
    [['metrix', ICON.templates, ':=', 'templates'], ['cat', ICON.catalog, '∞β°', 'catalog']],
    [['mult', sym('×'), ICON.quoted, 'multiply'], ['div', sym('÷'), ICON.frac, 'divide']],
    [['plus', sym('+'), ICON.contrastUp, 'plus'], ['minus', sym('−'), ICON.contrastDown, 'minus']],
  ];
  // Each pair is one rocker key with a groove, as on the calculator.
  const pair = (i) => (i ? 'pair pairR' : 'pair pairL');
  rowY.forEach((y, r) => {
    leftPairs[r].forEach(([name, label, ctrl, spoken], i) => keys.push([name, label, 37 + i * 35.5, y, 34, 28, pair(i), ctrl, spoken]));
    numbers[r].forEach(([name, label, ctrl, spoken], i) => keys.push([name, label, 126 + i * 63, y, 46, 28, 'num', ctrl, spoken]));
    if (r < 3) rightPairs[r].forEach(([name, label, ctrl, spoken], i) => keys.push([name, label, 318 + i * 35.5, y, 34, 28, pair(i), ctrl, spoken]));
  });
  keys.push(['enter', 'enter', 318, rowY[3], 69.5, 28, 'fn mid', '≈']);
  const letters = [
    [['ee', '<span class="ee">EE</span>', 'EE'], 'A', 'B', 'C', 'D', 'E', 'F', 'G', ['punct', '?!▸', 'punctuation']],
    [['pi', 'π▸', 'pi'], 'H', 'I', 'J', 'K', 'L', 'M', 'N', ['flag', ICON.flag, 'flag']],
    [['comma', ','], 'O', 'P', 'Q', 'R', 'S', 'T', 'U', ['ret', ICON.ret, 'return']],
    [null, 'V', 'W', 'X', 'Y', 'Z', ['space', ICON.space, 'space']],
  ];
  letters.forEach((row, r) => row.forEach((k, c) => {
    if (!k) return;
    const [name, label, spoken] = typeof k === 'string' ? ['a' + k.toLowerCase(), k] : k;
    // Letter keys are small squares (19 units), centred in their columns,
    // as on the calculator; space spans two columns.
    const width = name === 'space' ? 58.5 : 19;
    const style = ['X', 'Y', 'Z'].includes(label) ? 'letter grey' : 'letter';   // grey on the calculator
    keys.push([name, label, 45.5 + c * 39.5, 706.5 + r * 31, width, 19, style, '', spoken]);
  }));
  return keys;
}

// A fine grain for the matte plastic, as on the calculator: faint white
// specks, tiled over the side rails, the keypad and the keys.
const GRAIN = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='90' height='90'>"
  + "<filter id='g'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/>"
  + "<feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .5 -.2'/></filter>"
  + "<rect width='90' height='90' filter='url(#g)'/></svg>")}")`;

const STYLE = `
:host { display: inline-block; vertical-align: top; outline: none; -webkit-tap-highlight-color: transparent; }
.calc { position: relative; width: ${W}px; height: ${H}px; box-sizing: border-box;
  border-radius: 24px 24px 44px 44px / 24px 24px 56px 56px;
  /* the grey side rails */
  background: ${GRAIN}, linear-gradient(90deg, #353331, #67635e 1.3%, #5a5753 2.6%, #4b4845 3.6%, #4b4845 96.4%, #5a5753 97.4%, #67635e 98.7%, #353331);
  box-shadow: 0 12px 34px rgba(0, 0, 0, .4), inset 0 1px 0 rgba(255, 255, 255, .14);
  font-family: "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif; font-weight: 700;
  user-select: none; -webkit-user-select: none; cursor: default; }
:host(:focus-visible) .calc { box-shadow: 0 0 0 3px #5b9dff, 0 12px 34px rgba(0, 0, 0, .4); }
.calc.drop { box-shadow: 0 0 0 4px #43a047, 0 12px 34px rgba(0, 0, 0, .4); }
/* Glossy black glass from the top down to the touchpad band, a grey keypad below. */
.glass { position: absolute; left: 15px; right: 15px; top: 6px; height: 464px; border-radius: 17px 17px 4px 4px; overflow: hidden;
  background: linear-gradient(178deg, #1c1b1a, #080808 16%, #050505); box-shadow: inset 0 1px 0 rgba(255, 255, 255, .1), 0 0 0 1px #111; }
.glass::after { content: ''; position: absolute; inset: 0;
  background: linear-gradient(116deg, rgba(255, 255, 255, .04), rgba(255, 255, 255, .012) 24%, transparent 42%); }
/* Below the touchpad: black too, a little lighter and matte. */
.lower { position: absolute; left: 15px; right: 15px; top: 470px; bottom: 11px;
  border-radius: 3px 3px 32px 32px / 3px 3px 42px 42px;
  background: ${GRAIN}, linear-gradient(#1d1c1b, #191817 50%, #171615);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .08), 0 -1px 0 #000, 0 0 0 1px #121110; }
/* "TI-nspire CX" and "CAS": a thin TI-, a calligraphic n, silver "spire" and "CAS". */
/* One baseline for the model name and "CAS". */
/* Laid over the screen's width: the model name centred, "CAS" ending at
   the screen's right edge, both on one baseline. */
.brand { position: absolute; left: 52px; right: 52px; top: 16px; display: grid; grid-template-columns: 1fr auto 1fr;
  align-items: baseline; white-space: nowrap; }
.model { grid-column: 2; display: flex; align-items: baseline; }
.model .ti { font: 300 19px/1 "Segoe UI", system-ui, sans-serif; letter-spacing: 1px; color: #efeeea; }
.model .n { font: italic 400 34px/1 Garamond, "Palatino Linotype", Georgia, serif; margin-left: -3px; }
.model .spire { font: italic 700 25px/1 "Segoe UI", system-ui, sans-serif; letter-spacing: -.2px; margin: 0 4px 0 -6px; }
.model .cx { font: italic 700 19px/1 "Segoe UI", system-ui, sans-serif; color: #f5f5f2; letter-spacing: .6px; }
/* Silver text: the gradient is clipped to the glyphs, so the box must reach
   below the baseline, or the tail of the p disappears. */
.silver { padding: 0 3px .32em; background: linear-gradient(#ffffff, #e9eaec 28%, #aeb2b8 44%, #eceef0 60%, #c6cace 74%, #9a9ea4);
  -webkit-background-clip: text; background-clip: text; color: transparent; }
.cas { grid-column: 3; justify-self: end; margin-right: -3.4px; font: 700 23px/1 "Segoe UI", system-ui, sans-serif; letter-spacing: .4px; }
.maker { position: absolute; left: 0; right: 0; top: 830px; display: flex; align-items: center; justify-content: center; gap: 5px; color: #c4c7c1; }
.maker span { font: 700 14.5px/1 Constantia, "Palatino Linotype", Georgia, serif; font-variant: small-caps; letter-spacing: .5px; }
.bezel { position: absolute; left: 49px; top: 59px; width: 326px; height: 246px; border-radius: 2px; background: #000; box-shadow: 0 0 0 1px #1f1f1f; }
canvas { position: absolute; left: 52px; top: 62px; width: 320px; height: 240px; background: #000; image-rendering: pixelated; }
.key { position: absolute; box-sizing: border-box; display: flex; align-items: center; justify-content: center; gap: 1.5px;
  border-radius: 6px; color: #f6f4ef; font-size: 16.5px; line-height: 1; letter-spacing: -.1px; white-space: nowrap;
  cursor: pointer; touch-action: none;
  /* Matte, not glossy: a nearly flat colour with grain, a faint top edge. */
  background: ${GRAIN}, linear-gradient(#2c2b29, #252422 55%, #21201e);
  box-shadow: 0 1.5px 0 #0a0a09, 0 2px 3px rgba(0, 0, 0, .45), inset 0 1px 0 rgba(255, 255, 255, .07), inset 0 -1px 0 rgba(0, 0, 0, .3); }
.key::after { content: ''; position: absolute; inset: -4px; }
/* Bold humanist face around the touchpad; semibold and slimmer in the number rows. */
.key.mid { font-weight: 600; font-size: 15.5px; }
.key.small { font-size: 13.5px; }
.key.num, .key.grey { background: ${GRAIN}, linear-gradient(#73716d, #6c6a66 55%, #666460); }
.key.num { font-weight: 600; font-size: 21px; }
.key.pair { font-weight: 600; font-size: 15px; }
.key .sym { font-size: 19px; font-weight: 700; }
.key.pairL { border-radius: 6px 2px 2px 6px; }
.key.pairR { border-radius: 2px 6px 6px 2px; }
/* Letters: square keys with a big, round, bold face. */
.key.letter { font-family: "Nspire Keys", "Segoe UI", sans-serif; font-weight: 700; font-size: 11.5px; letter-spacing: 0; border-radius: 4px; }
.key .ee { font-size: 9.5px; }
/* (−) is smaller and thinner than the digits; the decimal point sits 35 % up the key. */
.key .neg { font-size: 15.5px; font-weight: 400; letter-spacing: .6px; }
.key .dp { position: absolute; left: 50%; bottom: 35%; width: 3.6px; height: 3.6px; margin: 0 0 -1.8px -1.8px;
  border-radius: 50%; background: currentColor; }
.key.ctrl { background: ${GRAIN}, linear-gradient(#ece2ae, #e3d6a0 55%, #dacd96); color: #3b3423; }
.key.down, .key.latched { transform: translateY(1.5px); filter: brightness(1.25);
  box-shadow: 0 .5px 0 #0a0a09, inset 0 1px 2px rgba(0, 0, 0, .4); }
.key.latched { outline: 1.5px solid #79b8ff; outline-offset: 1px; }
.key svg { flex: none; }
.stack { display: flex; flex-direction: column; align-items: center; gap: 1.5px; }
.tri { font-size: 7px; }
.label { position: absolute; height: 10px; display: flex; align-items: center; justify-content: center;
  color: #b9e1eb; font-family: "Segoe UI", system-ui, sans-serif; font-weight: 600; font-size: 9.5px; white-space: nowrap; pointer-events: none; }
svg { fill: none; stroke: currentColor; stroke-width: 1.3; stroke-linecap: round; stroke-linejoin: round; }
/* The touchpad: a metal ring around a black pad. */
.touchpad { position: absolute; left: 126px; top: 326px; width: 172px; height: 130px; box-sizing: border-box; padding: 5px;
  border-radius: 30px; touch-action: none; cursor: pointer;
  background: linear-gradient(150deg, #ddd3c6, #b9ad9f 30%, #958a7f 65%, #b0a597);
  box-shadow: 0 1px 3px rgba(0, 0, 0, .8), inset 0 0 0 1px rgba(0, 0, 0, .35); }
.surface { position: relative; height: 100%; border-radius: 25px; overflow: hidden;
  background: radial-gradient(ellipse at 50% 28%, #2b2927, #0d0c0b 72%);
  box-shadow: inset 0 2px 6px #000, inset 0 -1px 0 rgba(255, 255, 255, .07); }
.ring { position: absolute; left: 50%; top: 50%; width: 40px; height: 40px; margin: -20px 0 0 -20px; box-sizing: border-box;
  border: 2px solid #ecebe7; border-radius: 11px; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 2px; color: #f1f0ec; pointer-events: none; }
.hand { display: flex; color: #b9e1eb; }
.arrow, .edge { position: absolute; display: flex; color: #e5e4e0; pointer-events: none; }
.dot { position: absolute; width: 12px; height: 12px; margin: -6px 0 0 -6px; border-radius: 50%; display: none;
  pointer-events: none; background: rgba(130, 130, 255, .75); }
.dot.down { background: rgba(237, 242, 0, .8); }
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
        <div class="glass"></div>
        <div class="lower"></div>
        <div class="brand">
          <div class="model"><span class="ti">TI-</span><span class="n silver">n</span><span class="spire silver">spire</span><span class="cx">CX</span></div>
          <div class="cas silver">CAS</div>
        </div>
        <div class="bezel"></div>
        <canvas width="320" height="240" part="screen"></canvas>
        <div class="touchpad" role="button" aria-label="touchpad">
          <div class="surface">
            <span class="arrow" style="left: 50%; top: 5px; transform: translateX(-50%)">${ICON.up}</span>
            <span class="arrow" style="left: 50%; bottom: 5px; transform: translateX(-50%)">${ICON.down}</span>
            <span class="arrow" style="left: 6px; top: 50%; transform: translateY(-50%)">${ICON.left}</span>
            <span class="arrow" style="right: 6px; top: 50%; transform: translateY(-50%)">${ICON.right}</span>
            <div class="ring"><span class="hand">${ICON.hand}</span>${ICON.click}</div>
            <div class="dot"></div>
          </div>
        </div>
        <div class="edge" style="left: 199px; top: 311px">${ICON.edgeTop}</div>
        <div class="edge" style="left: 206px; top: 457.5px">${ICON.edgeBottom}</div>
        <div class="edge" style="left: 105.5px; top: 384.5px">${ICON.edgeLeft}</div>
        <div class="edge" style="left: 305.5px; top: 384.5px">${ICON.edgeRight}</div>
        <div class="maker">${ICON.ti}<span>Texas Instruments</span></div>
      </div>`;
    this.calc = root.querySelector('.calc');
    this.canvas = root.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.pad = root.querySelector('.touchpad');
    this.surface = root.querySelector('.surface');   // the touch area inside the metal ring
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
    addFonts();
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
    const r = this.surface.getBoundingClientRect();
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
