// Key timing in web/worker.js: what the calculator sees for quick taps.
//
//   node tests/worker-keys.js
//   (Windows without Node on PATH: E:\emsdk\node\24.19.0_64bit\bin\node.exe tests\worker-keys.js)
//
// Loads worker.js in a vm context with a fake core and steps emulated time
// 10 ms at a time, as loop() does. It reaches into the worker's own names
// (M, running, virtMs, applyDue), so rename them here too if they change.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'worker.js'), 'utf8');
const MIN_HOLD_MS = 80;

// events: [emulated ms, down] for one key; the fake keypad scan sees a key
// once it has been down for seenAfterMs.
function run(events, seenAfterMs = 0) {
  const ctx = { self: {}, importScripts() {}, createFirebird: () => new Promise(() => {}),
    MessageChannel, setTimeout, clearTimeout, performance, console };
  ctx.self.postMessage = () => {};
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const now = () => vm.runInContext('virtMs', ctx);
  const seen = [];            // [ms, down]: changes as the calculator sees them
  let downSince = null;
  ctx.fakeM = {
    _nw_key(row, col, down) {
      const last = seen.length ? seen[seen.length - 1][1] : false;
      if (!!down !== last) seen.push([now(), !!down]);
      downSince = down ? (downSince ?? now()) : null;
    },
    _nw_key_seen: () => (downSince !== null && now() - downSince >= seenAfterMs ? 1 : 0),
    _nw_arrow() {},
    _nw_core_wants_fast: () => 0,
  };
  vm.runInContext('M = fakeM; running = true; virtMs = 0;', ctx);
  for (let t = 0; t <= 1500; t += 10) {
    vm.runInContext(`virtMs = ${t}; applyDue();`, ctx);
    for (const [at, down] of events)
      if (at === t) ctx.self.onmessage({ data: { type: 'key', row: 0, col: 7, down } });
  }
  const presses = seen.filter(([, down]) => down).length;
  const shortest = Math.min(...seen.slice(1).map(([t], i) => t - seen[i][0]));
  return { text: seen.map(([t, down]) => (down ? 'down@' : 'up@') + t).join(' '), presses, shortest };
}

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
  if (!ok) failed++;
}

for (const [name, events, want] of [
  ['single quick tap (20 ms)', [[0, true], [20, false]], 1],
  ['double tap of one key (0-30, 70-100 ms)', [[0, true], [30, false], [70, true], [100, false]], 2],
  ['slower double tap (0-40, 90-130 ms)', [[0, true], [40, false], [90, true], [130, false]], 2],
]) {
  const r = run(events);
  check(name, r.presses === want && r.shortest >= MIN_HOLD_MS,
    `${r.text} -> ${r.presses} press(es), shortest state ${r.shortest} ms (want ${want}, >= ${MIN_HOLD_MS})`);
}

const late = run([[0, true], [20, false]], 300);
check('release waits for the keypad scan (seen at 300 ms)', late.text === 'down@0 up@300', late.text);

process.exit(failed ? 1 : 0);
