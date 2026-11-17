// nspire-web fake worker: speaks contract B (web/contract-b.md) without the
// emulator, so the web component can be built and tested with no TI files and
// no WebAssembly build. Use it exactly like worker.js:
//
//   new Worker('fake-worker.js')        (the test page: index.html?fake)
//
// Frames are a test pattern that shows the last key, arrow and touchpad
// input it received. ctrl + on turns the "screen" off, on turns it back on.
// sendFile and sendOS report progress; storage lives only in this worker.
'use strict';

const PROTOCOL = 1;
const W = 320, H = 240;

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
const ARROW_NAMES = ['up', 'down', 'left', 'right'];

const post = (msg, transfer) => self.postMessage(msg, transfer || []);

let loaded = false;
let running = false;
let turbo = false;
let lcdOn = true;
let stored = null;              // { savedAt, snapshot } once 'load' with remember
let held = new Set();           // keys and arrows held down now
let lastInput = 'none yet';
let touch = null;               // { x, y, contact, down }
let tick = 0;
let dirty = true;

const canvas = new OffscreenCanvas(W, H);
const g = canvas.getContext('2d', { willReadFrequently: true });

function draw() {
  // Colour bars, a moving band, and the input state.
  const bars = ['#ffffff', '#ffff00', '#00ffff', '#00ff00', '#ff00ff', '#ff0000', '#0000ff', '#000000'];
  bars.forEach((c, i) => { g.fillStyle = c; g.fillRect(i * 40, 0, 40, 60); });
  g.fillStyle = '#e8e8e8';
  g.fillRect(0, 60, W, H - 60);
  g.fillStyle = '#4a6fa5';
  g.fillRect((tick * 4) % (W + 40) - 40, 60, 40, 8);         // proves frames keep coming
  g.fillStyle = '#000';
  g.font = 'bold 14px sans-serif';
  g.fillText('nspire-web fake worker', 10, 90);
  g.font = '12px sans-serif';
  g.fillText('Contract B v' + PROTOCOL + (turbo ? ' - turbo on' : ''), 10, 110);
  g.fillText('Last input: ' + lastInput, 10, 135);
  g.fillText('Held: ' + ([...held].join(' ') || '-'), 10, 155);
  g.fillText('Touchpad: ' + (touch ? `x ${touch.x.toFixed(2)} y ${touch.y.toFixed(2)}` +
    `${touch.contact ? ' contact' : ''}${touch.down ? ' down' : ''}` : '-'), 10, 175);
  g.fillText('Frame ' + tick, 10, 225);
  // Touch position as a dot in a mini touchpad.
  g.strokeStyle = '#555';
  g.strokeRect(240, 150, 64, 48);
  if (touch && (touch.contact || touch.down)) {
    g.fillStyle = touch.down ? '#c00' : '#555';
    g.beginPath();
    g.arc(240 + touch.x * 64, 150 + touch.y * 48, 4, 0, Math.PI * 2);
    g.fill();
  }
}

function sendFrame() {
  draw();
  const rgba = g.getImageData(0, 0, W, H).data.buffer;
  post({ type: 'frame', rgba }, [rgba]);
}

// About 10 frames a second, plus one right after every input.
setInterval(() => {
  if (!running || !lcdOn) return;
  tick++;
  dirty = true;
}, 100);
setInterval(() => {
  if (running && lcdOn && dirty) {
    dirty = false;
    sendFrame();
  }
}, 16);
setInterval(() => {
  if (running) post({ type: 'speed', value: turbo ? 2.5 : 1.0 });
}, 500);

function input(text) {
  lastInput = text;
  dirty = true;
  post({ type: 'log', text: '[fake] ' + text });
}

function storageInfo() {
  post({ type: 'storage', exists: !!stored, snapshot: !!(stored && stored.snapshot), blocks: stored ? 125 : 0,
    savedAt: stored ? stored.savedAt : null });
}

function fakeTransfer(what) {
  post({ type: 'usblink', connected: true });
  let value = 0;
  const timer = setInterval(() => {
    value = Math.min(100, value + 20);
    post({ type: 'progress', what, value });
    if (value === 100) {
      clearInterval(timer);
      post({ type: 'status', text: what === 'os' ? 'OS installed (fake)' : 'Send complete' });
    }
  }, 200);
}

self.onmessage = (event) => {
  const msg = event.data;
  switch (msg.type) {
    case 'load': {
      // The real worker needs boot1 and a flash image or boot2; the fake one
      // takes anything, so the component can be tested without TI files.
      const f = msg.files || {};
      if (!f.boot1 || !(f.flash || f.boot2)) post({ type: 'log', text: '[fake] note: the real worker needs boot1 and a flash image or boot2' });
      loaded = true;
      if (msg.remember) stored = { savedAt: Date.now(), snapshot: false };
      post({ type: 'loaded', model: f.flash ? null : { product: 0x0F0, features: 0x05, name: 'CX CAS HW-A (fake)' }, stored: !!msg.remember });
      return;
    }
    case 'start':
      if (running) return;
      if (msg.saved ? !stored : !loaded) {
        post({ type: 'error', message: msg.saved ? 'Could not load the saved setup: nothing is saved' : 'Load the files first.' });
        return;
      }
      running = true;
      post({ type: 'started', resumed: !!(msg.saved && stored.snapshot) });
      dirty = true;
      return;
    case 'key': {
      const name = KEYMAP[msg.row * 11 + msg.col] || `row ${msg.row} col ${msg.col}`;
      msg.down ? held.add(name) : held.delete(name);
      input(`key ${name} ${msg.down ? 'down' : 'up'}`);
      if (msg.down && name === 'on') {
        if (held.has('ctrl') && lcdOn) {        // ctrl + on: off
          lcdOn = false;
          post({ type: 'lcd', on: false });
        } else if (!lcdOn) {                    // on: back on
          lcdOn = true;
          dirty = true;
        }
      }
      return;
    }
    case 'arrow':
      msg.down ? held.add(ARROW_NAMES[msg.dir]) : held.delete(ARROW_NAMES[msg.dir]);
      input(`arrow ${ARROW_NAMES[msg.dir]} ${msg.down ? 'down' : 'up'}`);
      return;
    case 'touch':
      touch = { x: msg.x, y: msg.y, contact: !!msg.contact, down: !!msg.down };
      dirty = true;
      lastInput = 'touch';
      return;
    case 'turbo':
      turbo = !!msg.on;
      dirty = true;
      return;
    case 'sendFile':
      input(`sendFile ${msg.name} (${msg.data ? msg.data.byteLength : 0} bytes)`);
      fakeTransfer('file');
      return;
    case 'sendOS':
      input(`sendOS (${msg.data ? msg.data.byteLength : 0} bytes)`);
      fakeTransfer('os');
      return;
    case 'reset':
      tick = 0;
      held.clear();
      lcdOn = true;
      dirty = true;
      post({ type: 'status', text: 'Reset' });
      return;
    case 'save':
      if (!stored) { post({ type: 'error', message: 'Nothing to save to: load the files with remember: true first.' }); return; }
      stored = { savedAt: Date.now(), snapshot: msg.snapshot !== false };
      storageInfo();
      return;
    case 'queryStorage':
      storageInfo();
      return;
    case 'forget':
      stored = null;
      storageInfo();
      return;
    case 'debug':
      post({ type: 'debug', info: [], virtMs: tick * 100 });
      return;
    default:
      post({ type: 'error', message: 'Unknown message: ' + msg.type });
  }
};

post({ type: 'ready', protocol: PROTOCOL, build: 'fake', core: 'fake' });
