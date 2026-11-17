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
// Turbo runs flat out only while the calculator computes. When a 10 ms step
// finds the CPU idle, the slice stops and pacing returns until the CPU is busy
// again, so idle time (auto power-off, cursor blink) passes at real speed.
let turboIdle = false;
let t0 = 0;                     // wall clock when emulated time was 0
let virtMs = 0;                 // emulated time run so far
let lastFrame = 0;
let uploads = 0;                // numbers the local copies of sent files

// ---- Storage (component 5): IndexedDB, used from the worker ----------------
// files:     'boot1', 'meta' { setId, savedAt, flashSize, blockSize }
// blocks:    byte offset in the flash image -> that NAND block, kept current.
//            Blocks never written (all 0xFF, erased) are left out. The image is
//            stored block by block because Chrome refuses single values over
//            about 127 MiB, and a CX flash image is 132 MiB.
// snapshots: 'latest' -> { core, setId, data (gzip), savedAt }
// A snapshot carries only the flash blocks changed since the last flash save,
// so it fits exactly the flash saved just before it: saving blocks alone
// deletes the snapshot, and saveState writes both in one transaction.
const CORE_ID = '__CORE__';     // build.py: hash of firebird.wasm; a snapshot fits only that build
const DB_NAME = 'nspire-web';
const AUTOSAVE_MS = 10000;      // real time between flash saves while running
// Flash image size -> NAND block size (pages per block x page size with spare
// area), as in flash.cpp's chips[]: CX 64 x 2112 bytes, classic 32 x 528.
const BLOCK_SIZES = { 138412032: 135168, 34603008: 16896 };

let db = null;
let setId = null;               // the stored setup being run (null: nothing stored)
let lastAutosave = 0;
let saving = false;
let dirtyPtr = 0;               // wasm buffer for the list of changed blocks

function openDb() {
  if (db) return Promise.resolve(db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      for (const name of ['files', 'blocks', 'snapshots'])
        if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
    };
    req.onsuccess = () => resolve((db = req.result));
    req.onerror = () => reject(req.error);
  });
}

// Runs fn(stores) in one read-write transaction; resolves once it committed.
async function transact(names, fn) {
  const d = await openDb();
  return new Promise((resolve, reject) => {
    const t = d.transaction(names, 'readwrite');
    fn(Object.fromEntries(names.map((n) => [n, t.objectStore(n)])));
    t.oncomplete = () => resolve();
    t.onerror = t.onabort = () => reject(t.error || new Error('transaction failed'));
  });
}

// One value by key, or with no key every { keys, values } in the store.
async function read(name, key) {
  const d = await openDb();
  return new Promise((resolve, reject) => {
    const store = d.transaction(name).objectStore(name);
    if (key !== undefined) {
      const r = store.get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    } else {
      const keys = store.getAllKeys();
      const values = store.getAll();
      values.onsuccess = () => resolve({ keys: keys.result, values: values.result });
      values.onerror = () => reject(values.error);
    }
  });
}

async function count(name) {
  const d = await openDb();
  return new Promise((resolve, reject) => {
    const r = d.transaction(name).objectStore(name).count();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function setupId(boot1, flash) {
  const hex = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  return (await hex(boot1)) + '-' + (await hex(flash));
}

// Remembers the files now in the in-memory file system as the saved setup,
// replacing whatever was saved before.
async function storeSetup() {
  const boot1 = M.FS.readFile('/boot1.img');
  const flash = M.FS.readFile('/flash.img');
  const blockSize = BLOCK_SIZES[flash.length];
  if (!blockSize) throw new Error(`unexpected flash image size ${flash.length}`);
  const id = await setupId(boot1, flash);
  let stored = 0;
  await transact(['files', 'blocks', 'snapshots'], (s) => {
    s.files.put(boot1.buffer, 'boot1');
    s.files.put({ setId: id, savedAt: Date.now(), flashSize: flash.length, blockSize }, 'meta');
    s.blocks.clear();
    s.snapshots.clear();
    for (let offset = 0; offset < flash.length; offset += blockSize) {
      const block = flash.subarray(offset, offset + blockSize);
      if (block.every((b) => b === 0xFF)) continue;          // erased: left out
      s.blocks.put(block.slice().buffer, offset);
      stored++;
    }
  });
  setId = id;
  post({ type: 'status', text: `Saved this setup in the browser (${stored} flash blocks)` });
}

// Copies out the flash blocks changed since the last save and marks them
// saved in the core. Synchronous, and cheap when nothing changed.
function collectDirtyBlocks() {
  if (!dirtyPtr) dirtyPtr = M._malloc(2048 * 2);
  const n = M._nw_flash_dirty_blocks(dirtyPtr, 2048);
  if (n === 0) return [];
  const indices = Array.from(new Uint16Array(M.HEAPU8.buffer, dirtyPtr, n));
  M._nw_save_flash();                     // writes those blocks into /flash.img
  const size = M._nw_flash_block_size();
  const stream = M.FS.open('/flash.img', 'r');
  try {
    return indices.map((i) => {
      const data = new Uint8Array(size);
      M.FS.read(stream, data, 0, size, i * size);
      return { offset: i * size, data };
    });
  } finally {
    M.FS.close(stream);
  }
}

// Saves the changed flash blocks, and with withSnapshot a snapshot that fits
// them. Saving blocks without one deletes the older snapshot, which no longer fits.
async function persist(withSnapshot) {
  if (!setId || !running || saving) return false;
  saving = true;
  try {
    const blocks = collectDirtyBlocks();
    let snapshot = null;
    if (withSnapshot && M._nw_core_wants_fast() === 0 && M._nw_suspend()) {  // not during a USB transfer
      snapshot = M.FS.readFile('/snapshot.gz');
      M.FS.unlink('/snapshot.gz');
    }
    if (!blocks.length && !snapshot) return true;
    const id = setId;
    await transact(['blocks', 'snapshots'], (s) => {
      for (const b of blocks) s.blocks.put(b.data.buffer, b.offset);
      if (snapshot) s.snapshots.put({ core: CORE_ID, setId: id, data: snapshot.buffer, savedAt: Date.now() }, 'latest');
      else s.snapshots.delete('latest');
    });
    return true;
  } catch (err) {
    post({ type: 'error', message: 'Saving failed: ' + err });
    return false;
  } finally {
    saving = false;
  }
}

// Starts from the saved setup: the flash image with its saved blocks, and the
// snapshot when it fits this build and this flash.
async function restore() {
  const meta = await read('files', 'meta');
  if (!meta) {
    post({ type: 'error', message: 'Nothing is saved in this browser yet.' });
    return;
  }
  const [boot1, blocks, snap] = await Promise.all([
    read('files', 'boot1'), read('blocks'), read('snapshots', 'latest'),
  ]);
  const flash = new Uint8Array(meta.flashSize).fill(0xFF);   // blocks left out are erased
  blocks.keys.forEach((offset, i) => flash.set(new Uint8Array(blocks.values[i]), offset));
  M.FS.writeFile('/boot1.img', new Uint8Array(boot1));
  M.FS.writeFile('/flash.img', flash, { canOwn: true });
  setId = meta.setId;
  if (snap && snap.core === CORE_ID && snap.setId === meta.setId) {
    M.FS.writeFile('/snapshot.gz', new Uint8Array(snap.data));
    const resumed = start(true);
    M.FS.unlink('/snapshot.gz');
    if (resumed) {
      post({ type: 'status', text: 'Resumed from the saved state' });
      return;
    }
    post({ type: 'log', text: '[storage] the snapshot did not load; booting from the saved flash' });
  }
  if (start(false)) post({ type: 'status', text: 'Booting from the saved flash' });
}

async function probe() {
  try {
    const meta = await read('files', 'meta');
    const snap = meta ? await read('snapshots', 'latest') : null;
    post({
      type: 'saved', exists: !!meta, blocks: meta ? await count('blocks') : 0,
      snapshot: !!(snap && snap.core === CORE_ID && snap.setId === meta.setId),
      savedAt: meta ? meta.savedAt : null,
    });
  } catch (err) {
    post({ type: 'saved', exists: false, error: String(err) });
  }
}

async function forget() {
  await transact(['files', 'blocks', 'snapshots'], (s) => { s.files.clear(); s.blocks.clear(); s.snapshots.clear(); });
  setId = null;
  post({ type: 'status', text: 'Forgot the saved setup' });
}

// A press and its release can both arrive between two slices; applied
// together, the calculator would never see the key, and the boot loader scans
// the keypad only now and then. So each key's changes wait in a queue: a
// release waits until the key has been down for MIN_HOLD_MS of emulated time
// and a keypad scan has seen it (or MAX_HOLD_MS has passed), and a new press
// waits until the key has been up for MIN_HOLD_MS, so a quick double tap
// counts twice instead of merging into one press.
const keys = new Map();         // key id -> { apply, seen, down, since, queue: [down, ...] }

function keyChange(id, down, apply, seen) {
  let k = keys.get(id);
  if (!k) keys.set(id, (k = { down: false, since: -Infinity, queue: [] }));
  k.apply = apply;
  k.seen = seen;
  k.queue.push(!!down);
  applyDue();
}

function canChange(k) {
  if (!running) return true;    // before start there is no emulated time to wait for
  const age = virtMs - k.since;
  if (!k.down) return age >= MIN_HOLD_MS;
  return age >= MAX_HOLD_MS || (age >= MIN_HOLD_MS && (!k.seen || k.seen()));
}

function applyDue() {
  for (const k of keys.values()) {
    while (k.queue.length && canChange(k)) {
      k.down = k.queue.shift();
      k.since = virtMs;
      k.apply(k.down);
    }
  }
}

const keysWaiting = () => [...keys.values()].some((k) => k.queue.length > 0);

const post = (msg, transfer) => self.postMessage(msg, transfer || []);

createFirebird({
  locateFile: (path) => path + '?v=__BUILD__',
  print: (text) => post({ type: 'log', text }),
  printErr: (text) => post({ type: 'log', text }),
  onLog: (text) => post({ type: 'log', text }),
  // Autosave would otherwise flash "Flash: Saved N modified blocks" in the status line.
  onStatus: (text) => post(text.startsWith('Flash: Saved') ? { type: 'log', text } : { type: 'status', text }),
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
  try {
    step();
  } catch (err) {
    // A crash inside the core (abort, memory error) would otherwise end the
    // loop silently and leave a frozen screen. Stop and say why instead.
    running = false;
    post({ type: 'error', message: 'The emulator stopped: ' + String(err && err.stack || err) });
  }
}

function step() {
  const now = performance.now();
  let owed = (now - t0) - virtMs;
  if (owed > MAX_DEBT_MS) {          // slower than real time: don't pile up debt
    t0 += owed - MAX_DEBT_MS;
    owed = MAX_DEBT_MS;
  }

  const usbFast = M._nw_core_wants_fast() !== 0;  // a USB transfer runs at full speed
  const turboFast = turbo && !turboIdle;
  const fast = usbFast || turboFast;
  const runMs = fast ? 100000 : Math.floor(owed / 10) * 10;
  if (runMs >= 10) {
    // Keep slices short while a key change is waiting, so it isn't held too long.
    const cap = keysWaiting() ? 20 : runMs;
    virtMs += M._nw_run(Math.min(runMs, cap), SLICE_REAL_MS, turboFast && !usbFast ? 1 : 0);
    if (turbo) turboIdle = M._nw_last_busy_ticks() === 0;
    if (fast) t0 = performance.now() - virtMs;   // stay in step after turbo
  }

  applyDue();
  pushFrame();

  if (setId && now - lastAutosave > AUTOSAVE_MS) {
    lastAutosave = now;
    persist(false);
  }

  const left = (performance.now() - t0) - virtMs;
  schedule(fast || left >= 10 ? 0 : Math.ceil(10 - left));
}

function pushFrame() {
  const now = performance.now();
  if (now - lastFrame < FRAME_MIN_GAP_MS) return;
  const result = M._nw_frame_update();
  if (result === 2) {                  // LCD off (calculator off or asleep)
    lastFrame = now;
    post({ type: 'lcd', on: false });
    return;
  }
  if (result !== 1) return;
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

// fromSnapshot: resume /snapshot.gz instead of booting. Returns whether it runs.
function start(fromSnapshot = false) {
  if (running) return true;
  if (!M._nw_start(fromSnapshot ? 1 : 0)) {
    if (!fromSnapshot) post({ type: 'error', message: 'The emulator did not start (check boot1 and the flash image).' });
    return false;
  }
  running = true;
  virtMs = 0;
  t0 = performance.now();
  lastAutosave = t0;
  post({ type: 'started' });
  schedule(0);
  return true;
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
        keyChange('k' + msg.row + ':' + msg.col, msg.down, apply, seen);
        break;
      }
      case 'arrow':          // { dir: 0 up, 1 down, 2 left, 3 right, down }
        keyChange('a' + msg.dir, msg.down, (down) => M._nw_arrow(msg.dir, down ? 1 : 0));
        break;
      case 'touch':          // { x, y in 0..1, contact, down }
        M._nw_touch(msg.x, msg.y, msg.contact ? 1 : 0, msg.down ? 1 : 0);
        break;
      case 'turbo':
        turbo = !!msg.on;
        turboIdle = false;
        break;
      case 'sendOS':         // { data: ArrayBuffer }
        M.FS.writeFile('/send.tcc', new Uint8Array(msg.data));
        M.ccall('nw_send_os', null, ['string'], ['/send.tcc']);
        break;
      case 'sendFile': {     // { name: path on the calculator, '/' = My Documents; data }
        // One local copy per transfer: the USB queue reads it only when its turn
        // comes, so a shared name would let a second upload overwrite the first.
        // shortcut: copies stay in memory until reload; delete them after the transfer if big files get sent often.
        const local = '/upload-' + (++uploads) + '.tns';
        M.FS.writeFile(local, new Uint8Array(msg.data));
        const remote = msg.name.startsWith('/') ? msg.name : '/' + msg.name;
        M.ccall('nw_send_file', null, ['string', 'string'], [local, remote]);
        break;
      }
      case 'reset':
        M._nw_reset();
        break;
      case 'debug': {
        const ptr = M._nw_debug_info();
        post({ type: 'debug', info: Array.from(new Int32Array(M.HEAPU8.buffer, ptr, 32)), virtMs });
        break;
      }
      case 'saveFlash':
        if (setId) persist(false).then((ok) => ok && post({ type: 'status', text: 'Flash saved in the browser' }));
        else post(M._nw_save_flash() ? { type: 'status', text: 'Flash saved (in memory only)' } : { type: 'error', message: 'Saving the flash failed.' });
        break;
      case 'probe':          // -> { type: 'saved', exists, snapshot, blocks, savedAt }
        probe();
        break;
      case 'store':          // remember the loaded files as the saved setup
        storeSetup().catch((err) => post({ type: 'error', message: 'Could not save the setup: ' + err }));
        break;
      case 'restore':        // start from the saved setup (snapshot if it fits)
        restore().catch((err) => post({ type: 'error', message: 'Could not load the saved setup: ' + err }));
        break;
      case 'saveState':      // flash blocks + snapshot, e.g. when the page is hidden
        persist(true).then((ok) => ok && running && post({ type: 'status', text: 'State saved' }));
        break;
      case 'forget':
        forget().catch((err) => post({ type: 'error', message: 'Could not clear the saved setup: ' + err }));
        break;
      default:
        post({ type: 'error', message: 'Unknown message: ' + msg.type });
    }
  } catch (err) {
    post({ type: 'error', message: String(err && err.stack || err) });
  }
};
