// nspire-web test page: a development harness for the emulator core.
// The real <nspire-emu> component is Phase 3 (the team's lane B).
'use strict';

const $ = (id) => document.getElementById(id);
const canvas = $('screen');
const ctx = canvas.getContext('2d');
const worker = new Worker('worker.js?v=__BUILD__');   // build.py fills in __BUILD__

function log(text) {
  const el = $('log');
  el.textContent += text + '\n';
  el.scrollTop = el.scrollHeight;
}
const setStatus = (text) => { $('status').textContent = text; };

let osData = null;         // kept for "Send OS over USB"
let turbo = false;

worker.onmessage = (event) => {
  const m = event.data;
  switch (m.type) {
    case 'ready': setStatus('ready: load the files'); break;
    case 'frame': ctx.putImageData(new ImageData(new Uint8ClampedArray(m.rgba), 320, 240), 0, 0); break;
    case 'speed': $('speed').textContent = Math.round(m.value * 100) + ' %'; break;
    case 'status': setStatus(m.text); log('[status] ' + m.text); break;
    case 'log': log(m.text); break;
    case 'usblink': log('[usb] ' + (m.connected ? 'connected' : 'disconnected')); break;
    case 'progress': setStatus(`sending ${m.what}: ${m.value} %`); break;
    case 'started': setStatus('running'); break;
    case 'error': setStatus('error'); log('[error] ' + m.message); break;
  }
};

// The model comes from the manufacturing data: product at 0x804 (high
// nibbles) and revision; features at 0x81C (see flash.cpp, manuf_data_804).
function readManuf(buf) {
  const v = new DataView(buf);
  return { product: (v.getUint16(0x804, true) << 4) | v.getUint16(0x806, true), features: v.getUint32(0x81C, true) };
}

// files: { boot1, flash?, boot2?, manuf?, diags?, os? } as ArrayBuffers
function useFiles(files) {
  if (!files.boot1) { setStatus('boot1 is missing'); return; }
  osData = files.os || null;
  const toWorker = { 'boot1.img': files.boot1 };
  if (files.flash) {
    toWorker['flash.img'] = files.flash;
    worker.postMessage({ type: 'files', files: toWorker });
  } else {
    if (!files.boot2) { setStatus('need a flash image, or boot2 to build one'); return; }
    Object.assign(toWorker, { 'boot2.img': files.boot2, 'manuf.img': files.manuf, 'diags.img': files.diags });
    const withOS = $('preloados').checked && !!files.os;
    if (withOS) toWorker['os.tcc'] = files.os;
    worker.postMessage({ type: 'files', files: toWorker });
    const model = files.manuf ? readManuf(files.manuf) : { product: 0x0F0, features: 0x05 };
    log(`[page] building a flash image: product 0x${model.product.toString(16)}, features 0x${model.features.toString(16)}, OS ${withOS ? 'preloaded' : 'not included'}`);
    worker.postMessage({ type: 'createFlash', product: model.product, features: model.features, manuf: !!files.manuf, diags: !!files.diags, os: withOS });
  }
  $('start').disabled = false;
  setStatus('files loaded: press Start');
}

async function fetchFile(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.arrayBuffer();
}

// Development shortcut: when the project root is served (python -m http.server
// in E:\nspire-web), the page sits at /web/dist/ and the dumps at /roms/.
$('devload').onclick = async () => {
  try {
    const base = '../../roms/';
    const [boot1, boot2, manuf, diags, os] = await Promise.all([
      'boot1.img.tns', 'boot2.img.tns', 'manuf.img.tns', 'diags.img.tns', 'TI-NspireCXCAS-4.5.5.79.tcc',
    ].map((n) => fetchFile(base + n)));
    useFiles({ boot1, boot2, manuf, diags, os });
  } catch (err) {
    log('[error] ' + err.message);
  }
};

$('usefiles').onclick = async () => {
  const read = async (id) => ($(id).files[0] ? $(id).files[0].arrayBuffer() : null);
  useFiles({
    boot1: await read('f-boot1'), flash: await read('f-flash'), boot2: await read('f-boot2'),
    manuf: await read('f-manuf'), diags: await read('f-diags'), os: await read('f-os'),
  });
};

$('start').onclick = () => { worker.postMessage({ type: 'start' }); canvas.focus(); };
$('turbo').onclick = () => {
  turbo = !turbo;
  $('turbo').textContent = 'Turbo: ' + (turbo ? 'on' : 'off');
  worker.postMessage({ type: 'turbo', on: turbo });
};
$('sendos').onclick = () => {
  if (!osData) { log('[error] no OS file loaded'); return; }
  worker.postMessage({ type: 'sendOS', data: osData });
};
$('reset').onclick = () => worker.postMessage({ type: 'reset' });
$('saveflash').onclick = () => worker.postMessage({ type: 'saveFlash' });

// ---- Keys --------------------------------------------------------------
// Keypad matrix from firebird/keymap.h: index = row * 11 + col.
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

// PC key (KeyboardEvent.code, layout independent) -> calculator key,
// following Firebird's desktop mapping (qtkeypadbridge.cpp).
const CODE_MAP = {
  Escape: 'esc', Tab: 'tab', End: 'pad', Home: 'on', PageUp: 'doc', PageDown: 'menu',
  ControlLeft: 'ctrl', ControlRight: 'ctrl', ShiftLeft: 'shift', ShiftRight: 'shift',
  Insert: 'var', Backspace: 'del', Delete: 'del', Enter: 'enter', NumpadEnter: 'enter',
  Space: 'space', Period: 'dot', NumpadDecimal: 'dot', Comma: 'comma',
  Minus: 'minus', NumpadSubtract: 'minus', NumpadAdd: 'plus', NumpadMultiply: 'mult',
  Slash: 'div', NumpadDivide: 'div', Equal: 'equ', Backslash: 'trig', BracketLeft: 'exp',
  BracketRight: 'pow10', F1: 'pleft', F2: 'pright', Semicolon: 'metrix', Quote: 'cat', Backquote: 'neg',
};
for (let i = 0; i < 26; i++) CODE_MAP['Key' + String.fromCharCode(65 + i)] = 'a' + String.fromCharCode(97 + i);
for (let i = 0; i < 10; i++) { CODE_MAP['Digit' + i] = 'n' + i; CODE_MAP['Numpad' + i] = 'n' + i; }
const ARROWS = { ArrowUp: 0, ArrowDown: 1, ArrowLeft: 2, ArrowRight: 3 };

function sendKey(name, down) {
  const index = KEYMAP.indexOf(name);
  if (index >= 0) worker.postMessage({ type: 'key', row: Math.floor(index / 11), col: index % 11, down });
}

const pressed = new Set();
function onKey(event, down) {
  const code = event.code;
  if (code in ARROWS) {
    event.preventDefault();
    if (event.repeat) return;      // the calculator repeats keys by itself
    worker.postMessage({ type: 'arrow', dir: ARROWS[code], down });
    down ? pressed.add(code) : pressed.delete(code);
  } else if (code in CODE_MAP) {
    event.preventDefault();
    if (event.repeat) return;
    sendKey(CODE_MAP[code], down);
    down ? pressed.add(code) : pressed.delete(code);
  }
}
canvas.addEventListener('keydown', (e) => onKey(e, true));
canvas.addEventListener('keyup', (e) => onKey(e, false));
canvas.addEventListener('blur', () => {        // release everything held
  for (const code of pressed) {
    if (code in ARROWS) worker.postMessage({ type: 'arrow', dir: ARROWS[code], down: false });
    else sendKey(CODE_MAP[code], false);
  }
  pressed.clear();
});
canvas.addEventListener('pointerdown', () => canvas.focus());

$('on').onclick = () => {
  sendKey('on', true);
  setTimeout(() => sendKey('on', false), 150);
  canvas.focus();
};
