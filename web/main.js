// nspire-web test page: a development harness for the emulator core.
// The real <nspire-emu> component is Phase 3 (the team's lane B). It talks to
// the worker through contract B (web/contract-b.md), as this page does.
// Open it with ?fake to use fake-worker.js: no TI files or wasm needed.
'use strict';

const $ = (id) => document.getElementById(id);
const canvas = $('screen');
const ctx = canvas.getContext('2d');
const FAKE = new URLSearchParams(location.search).has('fake');
const worker = new Worker((FAKE ? 'fake-worker.js' : 'worker.js') + '?v=__BUILD__');   // build.py fills in __BUILD__

function log(text) {
  const el = $('log');
  el.textContent += text + '\n';
  el.scrollTop = el.scrollHeight;
}
const setStatus = (text) => { $('status').textContent = text; };

let osData = null;         // kept for "Send OS over USB"
let turbo = false;
let started = false;

worker.onmessage = (event) => {
  const m = event.data;
  switch (m.type) {
    case 'ready':
      setStatus('ready: load the files');
      log(`[page] worker ready: contract B v${m.protocol}, build ${m.build}${FAKE ? ' (fake worker)' : ''}`);
      worker.postMessage({ type: 'queryStorage' });  // anything saved in this browser?
      break;
    case 'loaded':
      $('start').disabled = started;
      setStatus('files loaded: press Start');
      if (m.model) log(`[page] built a flash image for: ${m.model.name}`);
      break;
    case 'storage':
      if (m.exists) {
        $('resume').disabled = started;
        $('saved').textContent = `Saved ${new Date(m.savedAt).toLocaleString()}: ` +
          (m.snapshot ? 'with a snapshot (resumes where you left off)' : 'flash only (boots the saved OS)') +
          `, ${m.blocks} flash blocks stored`;
        if (!started) setStatus('a saved setup exists: press "Resume saved"');
      } else {
        $('resume').disabled = true;
        $('saved').textContent = m.error ? 'Storage unavailable: ' + m.error : 'Nothing saved yet';
      }
      break;
    case 'frame': ctx.putImageData(new ImageData(new Uint8ClampedArray(m.rgba), 320, 240), 0, 0); break;
    case 'lcd':                // the calculator turned its screen off
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 320, 240);
      ctx.fillStyle = '#777';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('LCD off (press ON)', 160, 124);
      break;
    case 'speed': $('speed').textContent = Math.round(m.value * 100) + ' %'; break;
    case 'status': setStatus(m.text); log('[status] ' + m.text); break;
    case 'log': log(m.text); break;
    case 'usblink': log('[usb] ' + (m.connected ? 'connected' : 'disconnected')); break;
    case 'progress': setStatus(`sending ${m.what}: ${m.value} %`); break;
    case 'started':
      started = true;
      $('resume').disabled = true;
      $('start').disabled = true;
      setStatus(m.resumed ? 'running (resumed where it was saved)' : 'running');
      break;
    case 'error': setStatus('error'); log('[error] ' + m.message); break;
  }
};

// files: { boot1, flash } or { boot1, boot2, manuf?, diags?, os? } as ArrayBuffers
function useFiles(files) {
  if (!files.boot1) { setStatus('boot1 is missing'); return; }
  osData = files.os || null;
  const remember = $('remember').checked;
  const send = files.flash ? { boot1: files.boot1, flash: files.flash }
    : { boot1: files.boot1, boot2: files.boot2, manuf: files.manuf, diags: files.diags, os: files.os };
  worker.postMessage({ type: 'load', files: send, osInFlash: $('preloados').checked, remember });
  if (remember && navigator.storage && navigator.storage.persist) {
    // Ask the browser not to evict our storage when the disk gets full.
    navigator.storage.persist().then((ok) => log('[storage] persistent storage ' + (ok ? 'granted' : 'not granted')));
  }
  setStatus('loading the files...');
}

async function fetchFile(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.arrayBuffer();
}

// Development shortcut: when the project root is served (python -m http.server
// 8000 --bind 127.0.0.1 in E:\nspire-web; the bind keeps /roms/ off the
// network), the page sits at /web/dist/ and the dumps at /roms/.
$('devload').onclick = async () => {
  if (FAKE) {                     // the fake worker needs no real files
    useFiles({ boot1: new ArrayBuffer(16), boot2: new ArrayBuffer(16) });
    return;
  }
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
$('saveflash').onclick = () => worker.postMessage({ type: 'save', snapshot: false });
$('resume').onclick = () => { worker.postMessage({ type: 'start', saved: true }); canvas.focus(); };
$('savestate').onclick = () => worker.postMessage({ type: 'save' });
$('forget').onclick = () => worker.postMessage({ type: 'forget' });

// Save the whole state when the page is hidden or closed, so the next visit
// resumes where this one stopped. (The worker also saves changed flash blocks
// every 10 s while running.)
const saveState = () => { if (started) worker.postMessage({ type: 'save' }); };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveState(); });
window.addEventListener('pagehide', saveState);

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
