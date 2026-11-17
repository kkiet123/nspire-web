# Components: the big picture

What `<nspire-emu>` is made of, how the parts talk to each other, and what we still have to find out about each part. Work order: research a component, write the findings down, then build it. When each part gets built is in `PLAN.md`.

## The picture

```
 Page (our demo, or the judge's):  <nspire-emu boot1="…" flash="…">
        │  A: attributes, methods, events
        ▼
 [1] <nspire-emu>     main thread      body, keypad, touchpad, PC keys, screen, file drop, API
        │ ▲  B: messages (down: keys, touch, files; up: frames, speed, status)
        ▼ │
 [2] Worker host      Web Worker       run loop, pacing, frame pipe, virtual files, errors
        │ ▲  C: exported C functions, virtual file names
        ▼ │
 [3] Bridge           web/bridge.cpp   functions for JS, the callbacks the core expects
        │ ▲  D: core API down, gui_* and throttle_* callbacks up
        ▼ │
 [4] Emulator core    firebird/core    CPU, memory, NAND flash, LCD, keypad, timers, USB, CX / CX II

 Feeding in:  [5] Storage (IndexedDB) <-> [2]    [6] TI files -> [1] -> [2]    [7] Toolchain builds [3] + [4]
 Across all:  [8] Speed and smoothness           [9] Fidelity tests            [10] Hand-in and license
```

## Overview

| # | Component | Job | Owner | Phase |
|---|---|---|---|---|
| 1 | `<nspire-emu>` | What people see and touch, and the public API | Team | 3 |
| 2 | Worker host | Runs the emulator off the page at the right speed; input in, frames out | Claude; tuning shared | 1–2, 4 |
| 3 | Bridge | Thin C++ layer between JavaScript and the core | Claude | 1 |
| 4 | Emulator core | Firebird's model of the calculator hardware | Claude (small patches) | 1–2, 5 |
| 5 | Storage | Keeps TI files, saved documents and snapshots across page reloads | Shared | 4 |
| 6 | TI files and model | Boot files dumped from our own calculator, the OS from TI's site | Team dumps, Claude checks | 2 |
| 7 | Toolchain and build | Turns the C/C++ into WebAssembly | Claude | 0–1 |
| 8 | Speed and smoothness | Real-calculator speed, a smooth page, a fast start | Shared | 4 |
| 9 | Fidelity tests | Shows it behaves like the real calculator | Team; Claude fixes | 5 |
| 10 | Hand-in and license | README, GPLv3 source, no TI files in git, the demo | Team and Claude | 6 |

## The components

### 1. `<nspire-emu>` (main thread; team)
- **Parts:** custom element with Shadow DOM; calculator body and keypad; touchpad; PC keyboard mapping; the 320×240 screen on a canvas, scaled up sharply; loading files (boot1, flash, `.tns` documents, OS); speed and status display.
- **Port from Firebird:** `qml/Keypad.qml` (layout, key to row and column), `qml/Touchpad.qml`, `keymap.h` and `qtkeypadbridge.cpp` (PC keys), `resources/keyimages/` (GPLv3).
- **To research:**
  - [ ] The (row, column) of every key for `keypad_set_key(row, col, state)`, and whether the keypad differs between CX and CX II.
  - [ ] What `touchpad_set_state(float x, float y, bool contact, bool down)` expects, and how `Touchpad.qml` turns a drag or a click into it.
  - [ ] PC keys: `KeyboardEvent.code` or `.key`; Vietnamese input methods (Unikey, Telex) getting in the way; ignoring auto-repeat (the calculator repeats keys by itself); releasing every key when the page loses focus (Firebird's TODO has this for the touchpad's arrow keys).
  - [ ] Pointer input: holding two keys at once, multi-touch, `pointercancel`.
  - [ ] Sharp scaling: whole-number zoom and `devicePixelRatio`.
- **Can start now** against a fake worker that sends a test pattern, once contract B is agreed.

### 2. Worker host (Web Worker, JavaScript; Claude, tuning shared)
- **Parts:** loading the wasm; the message protocol with [1]; the run loop (run a slice, give the thread back, repeat); pacing to real speed, and turbo; the frame pipe; virtual files (Emscripten's in-memory file system) holding boot1 and the flash image; a queue for file transfers; errors and reset.
- **To research:**
  - [x] Slice length: input delay against throughput (4 ms? 16 ms?), and how to give the thread back without the browser's timer delay (`setTimeout` or `MessageChannel`). Answer: at most 8 ms of real time per slice; `MessageChannel` for zero-delay turns (`research/2-7-first-web-build.md`).
  - [x] Pacing: how Firebird's throttle (`throttle_timer_wait`, `cycle_count_delta`, the scheduler in `schedule.c`) maps onto the wall clock in a worker. Answer: the core runs with `turbo_mode` on; the worker runs the emulated time it owes in 10 ms steps and drops debt beyond 200 ms. Measured: about 100 % at idle and boot.
  - [x] Frames: post a buffer on each change, or draw from the worker into an `OffscreenCanvas` that [1] hands over? Convert RGB565 to RGBA in C++ (as the old port's `paintLCD` did) or in JavaScript? Answer for now: RGBA in C, a transferred buffer only after an LCD refresh with a changed picture. `OffscreenCanvas` not tried yet.
  - [x] Quick taps: hold a release until a keypad scan has seen the key (`nw_key_seen`), at least 80 ms and at most 1 s of emulated time.
  - [ ] "LCD off": show it when the LCD stops refreshing, instead of keeping the last picture.
  - [x] Knowing when the LCD changed: hook the LCD controller instead of redrawing at 60 Hz (on Firebird's TODO). Answer: the bridge provides `gif_new_frame()`, which `lcd_event` calls on every refresh.
  - [ ] What browsers do to a worker in a hidden tab, and keeping the emulated clock right afterwards.

### 3. Bridge (`web/bridge.cpp`; Claude)
- **Functions for JavaScript (contract C):** start from boot1 and flash, create a flash image from the dumped parts (`flash_create_new()`), run for a slice, key, touchpad, read the frame and whether it changed, send a file or an OS, save and restore a snapshot, save flash changes, speed, turbo, reset.
- **Callbacks the core expects (contract D, declared in `core/emu.h`):** `gui_do_stuff`, `gui_show_speed`, `gui_status_printf`, `gui_debug_printf`, `gui_debug_vprintf`, `gui_perror`, `gui_putchar` and `gui_getchar` (serial port), `gui_set_busy`, `gui_usblink_changed`, `gui_debugger_entered_or_left`, `gui_debugger_request_input`, `throttle_timer_on`, `throttle_timer_off`, `throttle_timer_wait`.
- **Examples to learn from:** `emuthread.cpp` (the Qt app), `headless/main.cpp` (a small frontend without Qt), `emscripten/main.cpp` (the old web port; every callback is a stub).
- **To research:**
  - [x] How `emu_loop()` in `core/emu.cpp` works, so a "run one slice and return" entry point can reuse it with a small patch. The old port copied the loop body instead. Answer: split it into `emu_loop_begin()` + `emu_loop_run()` (`research/3-4-core-loop.md`).
  - [x] Errors: `error()` → `return_to_loop()` → `emu_longjmp`, which is `assert(false)` under Emscripten today. Make it a real longjmp. Answer: setjmp/longjmp via wasm exceptions, and no interactive debugger.
  - [x] Which callbacks matter in the browser, and where their output goes (console, status line, speed %). Answer: the contract D table in `research/3-4-core-loop.md`.

### 4. Emulator core (`firebird/core`, reused; Claude for patches)
- **Parts:** ARM9 CPU interpreter (`cpu.cpp`, `arm_interpreter.cpp`, `thumb_interpreter.cpp`, `coproc.cpp`); memory and MMU (`mem.c`, `mmu.c`); NAND flash, saving it, and creating flash images (`flash.cpp`); peripherals (`misc.c`, `interrupt.c`, `lcd.c`, `keypad.cpp`, `serial.c`, `des.c`, `sha256.c`); USB and file transfer (`usb.c`, `usblink.c`, `usblink_queue.cpp`, and on the CX II `usb_cx2.cpp`, `usblink_cx2.cpp`); CX II hardware (`cx2.cpp`); the event scheduler (`schedule.c`); snapshots (`*_suspend`, `*_resume`); the web OS layer `os/os-emscripten.c`.
- **Left out in wasm:** the JIT (`translate_*`, `asmcode_*.S`). `core/emu.h` sets `NO_TRANSLATION` on anything that isn't x86 or ARM, so wasm runs the interpreter only. The debugger and GDB stub can stay in, unused.
- **The model is not a setting:** `flash.cpp` reads `product`, `features` and `asic_user_flags` from the flash image's manufacturing data. CX means `product >= 0x0F0`, CX II `product >= 0x1C0`.
- **To research:**
  - [ ] Where the interpreter spends its time, once it runs.
  - [ ] CX II gaps (only if we ever switch to a CX II): Firebird's TODO lists the LCD's "Magic VRAM" and the PMU bits; there are also black-screen freezes and touchpad and file-transfer reports.
  - [x] Where the emulated real-time clock gets its time (the judge may check the date and time). Answer: the PC's clock plus an offset the OS sets.
  - [x] Whether sleep, auto power-off, the battery level and Press-to-Test (with its LED) are emulated. Answer: idle and "off" are cheap waits on the CX; the battery reads a fixed voltage; the LED registers exist but nothing shows them.

### 5. Storage (IndexedDB; shared)
- **Keeps:** the TI files, so they are chosen once; the calculator's flash changes, because a document saved on the real calculator survives switching it off, so here it must survive a page reload; snapshots, for an instant start.
- **Known:** `os-emscripten.c` maps `flash.img` copy-on-write, so changes stay in memory only. `flash.cpp` has `flash_save_changes()` and `flash_save_as()`.
- **To research:**
  - [ ] What `flash_save_changes()` writes (the whole image or the changed blocks), and how to store only the changes.
  - [ ] When to save: after a file transfer or a document save, on a timer, on `visibilitychange` or `pagehide`.
  - [ ] Sizes of the flash image and a snapshot, compression (Firebird already uses zlib), browser storage limits.
  - [ ] A snapshot belongs to one boot1 and flash (its header stores their paths) and to one `SNAPSHOT_VER`: when to throw it away.

### 6. TI files and model (team dumps its own calculator; Claude researches and checks)
- **Nobody supplies them** (2026-11-15). Route: boot1 and boot2 from our own calculator with Ndless and PolyDumper, the OS from education.ti.com. Findings: `research/6-ti-files.md`.
- **Needed:** boot1, plus a flash image from Firebird's flash creator (`flash_create_new()`): on the CX from boot2 + OS (+ optional manuf, diags); on the CX II from manuf + bootloader + installer (+ diags), with the boot ROM keys added by eMMUlate. OS files are `.tco` / `.tcc` on the CX and `.tco2` / `.tcc2` / `.tct2` on the CX II.
- **Bring your own files:** the product ships no TI code. Users load files from their own calculator; our demo laptop has ours.
- **To research:**
  - [ ] Our calculators: model, OS version, CX hardware revision (they decide the route).
  - [ ] The judge's exact model and OS version (ask the teacher).
  - [x] What Firebird's flash creator needs for each model.
  - [x] How to get the files without help: dump our own calculator.
  - [ ] PolyDumper's current version and what it writes on each model.
  - [ ] How to check the files: boot them in our build (or the desktop Firebird); record their SHA-256.

### 7. Toolchain and build (Claude)
- **Parts:** emsdk 7.0.0 in `E:\emsdk`, `web/build.py`, output in `web/dist/`.
- **Sources:** all of `core/` except the JIT, plus `os/os-emscripten.c` and `web/bridge.cpp`. `headless/Makefile` has the current list; the old `emscripten/Makefile` misses `keypad.cpp`, `cx2.cpp`, `usb_cx2.cpp` and `usblink_cx2.cpp`.
- **To research (for Emscripten 7.0.0):**
  - [x] Flags for wasm exceptions and setjmp/longjmp, and which browsers support them. Answer: `-fwasm-exceptions -sSUPPORT_LONGJMP=wasm` (works in Chromium; other browsers still to check).
  - [x] `-O3` with link-time optimisation; the zlib port; memory size (fixed or growing; the old port used 512 MB); worker-only output; which runtime helpers to export (file system, calling C). Answer: `-O3`, zlib port, 256 MB growing to 1 GB, `ENVIRONMENT=worker`, exports `FS`, `ccall`, `HEAPU8`. Link-time optimisation still to try.
  - [ ] A debug build (no optimisation, assertions, memory checks) and stepping through the C++ in Chrome DevTools.
  - [x] Build time and the size of the `.wasm`. Answer: 0.22 MB wasm and 75 KB JS; the first build also compiles Emscripten's system libraries (a few minutes), later links take seconds.

### 8. Speed and smoothness (shared)
- **Targets:** real speed by default, so the cursor blink, key repeat and clock match; turbo on request; the page stays smooth during heavy work; a quick start.
- **Measures:** speed % (`gui_show_speed`), boot time (cold and from a snapshot), heavy calculations timed next to the real calculator, frame timing, delay from key press to screen change, download and compile time.
- **To research:**
  - [ ] The clock speed of the judge's model (the CX II is much faster than the CX) against how fast the wasm interpreter runs: can the demo laptop reach 100%?
  - [ ] Baseline: the desktop Firebird's speed % on the same laptop.
  - [ ] If it is too slow: interpreter hot spots, starting from a snapshot, and, as a last and large option, a JIT that writes wasm.
  - [ ] Keeping the page smooth: draw off the main thread, send no frame without a change.

### 9. Fidelity tests (team; Claude fixes)
- **Checklist:** every app on the judge's model (Calculator, Graphs, Geometry, Lists & Spreadsheet, Data & Statistics, Notes, programs, and others such as Vernier DataQuest or Python on the CX II), plus the system: boot, every key and shortcut, touchpad, sleep and wake, date and time, saving and opening documents (also after a reload), file transfer both ways, installing an OS, resets, Press-to-Test.
- **To research:**
  - [ ] The judge's test list or criteria (ask the teacher).
  - [ ] How to compare side by side: same steps on both, screenshots or video, timings.

### 10. Hand-in and license (team and Claude)
- README: run it locally with one command (`python -m http.server`), credits, which parts the team wrote.
- GPLv3: the source goes with any build given to others. Key images are GPLv3, icons LGPLv3.
- TI files stay out of git unless TI allows otherwise in writing.
- Rehearse on the demo laptop, offline, in the browser the judge will use.

## Contracts

| | Between | Fixes | When |
|---|---|---|---|
| A | page ↔ [1] | attributes, methods, events | start of Phase 3 |
| B | [1] ↔ [2] | message names and contents, frame format | early (Pipeline, lane A step 5), so the team can build [1] against a fake worker while [2]–[4] get built |
| C | [2] ↔ [3] | exported C functions, virtual file names (`os-emscripten.c` expects `flash.img`) | Phase 1 |
| D | [3] ↔ [4] | core API and the `gui_*` / `throttle_*` callbacks | given by Firebird |

## Research order

The order, merged with the build steps into three lanes, is the Pipeline in `PLAN.md`. Findings go in `research/<n>-<name>.md`; tick the questions above as they get answered.
