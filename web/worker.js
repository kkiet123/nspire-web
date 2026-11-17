// nspire-web worker host: runs Firebird's core (WebAssembly) off the page.
//
// The core never waits on its own (turbo_mode is on inside it). This worker
// paces it against the wall clock in 10 ms steps of emulated time, applies
// input between slices, and posts a frame only when the picture changed.
// Messages are the draft of contract B (see COMPONENTS.md).
'use strict';

// build.py replaces __BUILD__ with a hash of the build, so browsers never
// mix a cached old file with a new one.
importScripts('firebird.js?v=__BUILD__');

const W = 320, H = 240;
const SLICE_REAL_MS = 8;        // longest real time one slice may take
const MAX_DEBT_MS = 200;        // forget emulated time owed beyond this
const FRAME_MIN_GAP_MS = 15;    // at most ~60 frames per second
const MIN_HOLD_MS = 80;         // emulated time a key stays down at least
const MAX_HOLD_MS = 1000;       // ...and at most, if no keypad scan sees it (calculator off, ON key)

let M = null;                   // the Emscripten module
let running = false;
let turbo = false;
let t0 = 0;                     // wall clock when emulated time was 0
let virtMs = 0;                 // emulated time run so far
let lastFrame = 0;

// A press and its release can both arrive between two slices; applied
// together, the calculator would never see the key, and the boot loader scans
// the keypad only now and then. So a release waits until the key has been
// down for MIN_HOLD_MS of emulated time and a keypad scan has seen it
// (or MAX_HOLD_MS has passed).
const held = new Map();         // key id -> emulated time it went down
let pendingUps = [];            // { id, at, deadline, seen, up }

function press(id, apply) {
  pendingUps = pendingUps.filter((p) => p.id !== id);
  held.set(id, virtMs);
  apply(true);
}

function release(id, apply, seen) {
  const since = held.get(id);
  held.delete(id);
  if (running && since !== undefined) {
    pendingUps.push({ id, at: since + MIN_HOLD_MS, deadline: since + MAX_HOLD_MS, seen, up: () => apply(false) });
    releaseDue();
  } else {
    apply(false);
  }
}

function releaseDue() {
  if (pendingUps.length === 0) return;
  const isDue = (p) => virtMs >= p.deadline || (virtMs >= p.at && (!p.seen || p.seen()));
  const due = pendingUps.filter(isDue);
  pendingUps = pendingUps.filter((p) => !isDue(p));
  for (const p of due) p.up();
}

const post = (msg, transfer) => self.postMessage(msg, transfer || []);

createFirebird({
  locateFile: (path) => path + '?v=__BUILD__',
  print: (text) => post({ type: 'log', text }),
  printErr: (text) => post({ type: 'log', text }),
  onLog: (text) => post({ type: 'log', text }),
  onStatus: (text) => post({ type: 'status', text }),
  onSpeed: (ratio) => post({ type: 'speed', value: ratio }),
  onUsblink: (connected) => post({ type: 'usblink', connected }),
  onProgress: (what, value) => post({ type: 'progress', what: what === 1 ? 'os' : 'file', value }),
}).then((module) => {
  M = module;
  post({ type: 'ready' });
}).catch((err) => post({ type: 'error', message: 'Could not load firebird.wasm: ' + err }));

// A zero-delay way back into the loop: setTimeout(0) is clamped to 4 ms.
const channel = new MessageChannel();
channel.port1.onmessage = loop;
function schedule(ms) {
  if (ms <= 0) channel.port2.postMessage(0);
  else setTimeout(loop, ms);
}

function loop() {
  if (!running) return;
  const now = performance.now();
  let owed = (now - t0) - virtMs;
  if (owed > MAX_DEBT_MS) {          // slower than real time: don't pile up debt
    t0 += owed - MAX_DEBT_MS;
    owed = MAX_DEBT_MS;
  }

  const fast = turbo || M._nw_core_wants_fast() !== 0;
  const runMs = fast ? 100000 : Math.floor(owed / 10) * 10;
  if (runMs >= 10) {
    // Keep slices short while a release is waiting, so it isn't held too long.
    const cap = pendingUps.length ? 20 : runMs;
    virtMs += M._nw_run(Math.min(runMs, cap), SLICE_REAL_MS);
    if (fast) t0 = performance.now() - virtMs;   // stay in step after turbo
  }

  releaseDue();
  pushFrame();

  const left = (performance.now() - t0) - virtMs;
  schedule(fast || left >= 10 ? 0 : Math.ceil(10 - left));
}

function pushFrame() {
  const now = performance.now();
  if (now - lastFrame < FRAME_MIN_GAP_MS) return;
  if (M._nw_frame_update() !== 1) return;
  lastFrame = now;
  const ptr = M._nw_frame_rgba();
  const rgba = M.HEAPU8.slice(ptr, ptr + W * H * 4);
  post({ type: 'frame', rgba: rgba.buffer }, [rgba.buffer]);
}

function writeFiles(files) {
  for (const [name, data] of Object.entries(files)) {
    if (data) M.FS.writeFile('/' + name, new Uint8Array(data));
  }
}

function start() {
  if (running) return;
  if (!M._nw_start(0)) {
    post({ type: 'error', message: 'The emulator did not start (check boot1 and the flash image).' });
    return;
  }
  running = true;
  virtMs = 0;
  t0 = performance.now();
  post({ type: 'started' });
  schedule(0);
}

self.onmessage = (event) => {
  const msg = event.data;
  if (!M) {
    post({ type: 'error', message: 'Not ready yet.' });
    return;
  }
  try {
    switch (msg.type) {
      case 'files':          // { files: { 'boot1.img': ArrayBuffer, ... } }
        writeFiles(msg.files);
        break;
      case 'createFlash': {  // { product, features, manuf, diags, os }
        const ok = M._nw_create_flash(msg.product, msg.features, msg.manuf ? 1 : 0, msg.diags ? 1 : 0, msg.os ? 1 : 0);
        post(ok ? { type: 'status', text: 'Flash image created' } : { type: 'error', message: 'Could not create the flash image.' });
        break;
      }
      case 'start':
        start();
        break;
      case 'key': {          // { row, col, down }
        const apply = (down) => M._nw_key(msg.row, msg.col, down ? 1 : 0);
        const seen = () => M._nw_key_seen(msg.row, msg.col) !== 0;
        const id = 'k' + msg.row + ':' + msg.col;
        msg.down ? press(id, apply) : release(id, apply, seen);
        break;
      }
      case 'arrow': {        // { dir: 0 up, 1 down, 2 left, 3 right, down }
        const apply = (down) => M._nw_arrow(msg.dir, down ? 1 : 0);
        const id = 'a' + msg.dir;
        msg.down ? press(id, apply) : release(id, apply);
        break;
      }
      case 'touch':          // { x, y in 0..1, contact, down }
        M._nw_touch(msg.x, msg.y, msg.contact ? 1 : 0, msg.down ? 1 : 0);
        break;
      case 'turbo':
        turbo = !!msg.on;
        break;
      case 'sendOS':         // { data: ArrayBuffer }
        M.FS.writeFile('/send.tcc', new Uint8Array(msg.data));
        M.ccall('nw_send_os', null, ['string'], ['/send.tcc']);
        break;
      case 'sendFile':       // { name, data }
        M.FS.writeFile('/upload.tns', new Uint8Array(msg.data));
        M.ccall('nw_send_file', null, ['string', 'string'], ['/upload.tns', msg.name]);
        break;
      case 'reset':
        M._nw_reset();
        break;
      case 'debug': {
        const ptr = M._nw_debug_info();
        post({ type: 'debug', info: Array.from(new Int32Array(M.HEAPU8.buffer, ptr, 32)), virtMs });
        break;
      }
      case 'saveFlash':
        post(M._nw_save_flash() ? { type: 'status', text: 'Flash saved' } : { type: 'error', message: 'Saving the flash failed.' });
        break;
      default:
        post({ type: 'error', message: 'Unknown message: ' + msg.type });
    }
  } catch (err) {
    post({ type: 'error', message: String(err && err.stack || err) });
  }
};
