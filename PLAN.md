# Plan: TI-Nspire emulator as a web component

**Goal:** `<nspire-emu>`, a web component that runs TI's real TI-Nspire OS through Firebird's emulator compiled to WebAssembly. It runs locally, feels as fast and smooth as the real calculator, and behaves the same.

## How it fits together

```
Your page ─> <nspire-emu>   calculator body, screen (canvas), keypad
                 │ key presses, files            ▲ screen frames, speed %
                 ▼                               │
             Web Worker ─ firebird.wasm  (CPU, memory, screen, keypad, USB)
```

The emulator runs in a Web Worker, a background thread, so it never freezes the page and the keys and animations stay smooth.

## Project layout (`E:\nspire-web`)

```
firebird\     Firebird source, unchanged except a few small, marked fixes
web\          our code: bridge.cpp (C++ <-> JS), build.py, component, worker, keypad
web\dist\     build output: the page, firebird.js, firebird.wasm
roms\         TI files, kept out of git
research\     findings for each component (see COMPONENTS.md)
tests\        side-by-side checklist and speed log
PLAN.md, COMPONENTS.md, CLAUDE.md, README.md (credits, GPLv3, which parts are ours)
```

Emscripten lives outside the project, in `E:\emsdk`, pinned to version 7.0.0.

## Pipeline

How the work flows: big picture first; then, for each component, research it (findings in `research/`) and build it. Three lanes run side by side and meet at the first boot. Component numbers are those in `COMPONENTS.md`.

**Lane A: engine (Claude)**
1. Done: research [6], TI files (`research/6-ti-files.md`).
2. Done: Phase 0, step 1: source unzipped into `firebird/`, git started (2026-11-16).
3. Done: research [3] + [4], the core loop and its callbacks (`research/3-4-core-loop.md`). Contracts C and D are drafted there.
4. **Next:** research [2]: the worker host (slices, pacing, frames). Gives the draft of contract B.
5. Agree contract B with the team. This unblocks lane B's build.
6. Research [7]: Emscripten 7.0.0 flags.
7. Phase 0, step 2: install emsdk. **Gate:** the user's OK for the 714 MB download.
8. Phase 1: `web/build.py`, core patches, `web/bridge.cpp`.
9. Build the worker host.

**Lane B: web component (team; Claude guides)**
1. Research [1]: keypad, touchpad and PC keys from Firebird's QML. Can start now.
2. Agree contract B (lane A, step 5).
3. Phase 3: build `<nspire-emu>` against a fake worker that sends a test pattern.
4. Research [9]: the test checklist for each app (`tests/checklist.md`). Any time.

**Lane C: TI files (team)**
1. Done: a TI-Nspire CX CAS on OS 3.2.3.1233, older than anything Ndless supports.
2. Done (2026-11-16): Computer Link installed, documents backed up, OS updated once to 4.5.5.79. No updates after this.
3. Done (2026-11-16): Ndless, then PolyDumper; boot1, boot2, diags and manuf are in `roms/` with the 4.5.5.79 OS file (`research/6-ti-files.md`).
4. Optional: boot the set in the desktop Firebird first, to catch a bad dump before Phase 2.

**Together, once the lanes meet**
1. Phase 2: first boot in the browser. Needs lane A, step 9 and lane C, step 3.
2. Research [5] storage and [8] speed, then build and tune (Phase 4).
3. Phase 5: side-by-side tests and fixes.
4. Phase 6: hand-in ([10]).

**Gates:** the 714 MB download (lane A, step 7); our calculators' model and OS version (lane C); the judge's model (ask the teacher; it decides CX or CX II).

## Phases

### Phase 0: Setup (Claude)
- [x] Unzip `E:\user\Desktop\firebird-master.zip` into `firebird\` and start a git repository, with `roms/` ignored.
- [ ] Install emsdk in `E:\emsdk`, pinned to Emscripten 7.0.0 (714 MB download, needs the user's OK first).
- **Done when:** a test program compiles to WebAssembly.

### Phase 1: Compile the emulator to WebAssembly (Claude, team reviews)
- [ ] `web/build.py` covering all current core files (including `keypad.cpp`, `cx2.cpp`, `usb_cx2.cpp`, `usblink_cx2.cpp`), current Emscripten options, `-O3` and link-time optimisation.
- [ ] Fix the old port: real setjmp/longjmp so errors reset instead of crashing, no fixed 1,000-loop main loop, screen output for every model.
- [ ] `web/bridge.cpp` with the functions JavaScript calls: start, run for N milliseconds, key, touchpad, screen, send file or OS, save and restore a snapshot, speed.
- **Done when:** the build has no errors and a bare test page loads it and shows "waiting for boot1/flash".

### Phase 2: First boot in the browser (Claude, needs the TI files)
- [ ] Team: dump boot1 and boot2 from our own calculator and download the OS from TI's site (`research/6-ti-files.md`).
- [ ] Check the files (in our build, or first in the desktop Firebird).
- [ ] Load them in the browser and draw the screen.
- **Done when:** TI's home screen appears and you can move around with the keyboard.

### Phase 3: The web component (team, Claude guides; can start now with a fake test-pattern screen)
- [ ] Custom element with Shadow DOM.
- [ ] Calculator body and keypad: on-screen keys that react on `pointerdown`, PC keyboard mapping (ported from Firebird's `keymap.h` and `qml/Keypad.qml`), touchpad.
- [ ] The 320×240 screen, scaled up sharply (`image-rendering: pixelated`).
- [ ] API: attributes `boot1` and `flash`; methods `start()`, `reset()`, `sendFile()`; events `ready`, `error`, `speed`.
- **Done when:** putting `<nspire-emu>` into a blank HTML page gives a working calculator.

### Phase 4: Speed and smoothness (together)
- [ ] Run at the real calculator's speed by default, so the cursor blink, key repeat and clock match. Add a turbo switch for heavy work.
- [ ] Run the emulator in short timed slices, and send a frame only when the screen changes.
- [ ] Save a snapshot in IndexedDB so it starts instantly instead of booting every time.
- [ ] Keep the calculator's flash changes (saved documents) in IndexedDB, so they survive a page reload as they survive switching off the real calculator.
- [ ] Measure boot time and heavy calculations against the real calculator, plus frame timing (Chrome's Performance panel) and Lighthouse.
- **Done when:** the numbers are recorded next to the real calculator's and the page stays smooth during heavy calculations.

### Phase 5: Match the real calculator (team tests, Claude helps fix)
- [ ] Side-by-side checklist for each app: Calculator, Graphs, Geometry, Lists & Spreadsheet, Data & Statistics, Notes, programs, saving and opening documents, file transfer.
- [ ] Fix mismatches. Gaps inside the emulator itself (likely on the CX II) get fixed or documented.
- **Done when:** every item passes or has a written reason.

### Phase 6: Hand-in
- [ ] README: how to run it locally in one command, credits and the GPLv3 license, which parts the team wrote.
- [ ] TI files stay out of the repository unless TI allows otherwise in writing.
- [ ] Rehearse on the laptop used for the demo.

## Risks
- **No TI files from anyone:** we dump our own calculator. If its OS is not one Ndless supports, use another team member's or the school's calculator. Phases 0, 1 and 3 don't need the files; only Phase 2 waits.
- **Too slow in the browser:** Phase 2 shows it early. Fixes: snapshot start, turbo, speeding up the slowest parts.
- **The judge uses a CX II:** plan extra time for emulator fixes.

## Open questions for the teacher
1. Which model and OS version will the judge compare against?
2. ~~Can TI provide the boot1, boot2 and OS files?~~ No (2026-11-15): we dump our own calculator.
3. May we demo with files dumped from our own calculator? We will not share them.
