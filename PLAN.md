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
4. Done (2026-11-17, by building, at the user's request): research [2] and [7], emsdk 7.0.0, Phase 1 (`web/build.py`, core patches, `web/bridge.cpp`) and the worker host. Findings: `research/2-7-first-web-build.md`.
5. Done (2026-11-17): contract B, version 1 (`web/contract-b.md`), and `web/fake-worker.js`, which speaks it with a test pattern. This unblocks lane B's build.
6. Done (2026-11-17): research and build [5] storage: the flash image and snapshots in IndexedDB; a reload resumes in about 1.3 s (`research/5-storage.md`).
7. Done (2026-11-17): LCD off and idle-aware turbo (`research/2-7-first-web-build.md`, "Follow-ups").
8. **Next:** speed (measure in a plain Chrome window first), then the open items in `research/5-storage.md`.

**Lane B: web component (team; Claude guides)**
1. Done (2026-11-17, Claude for the team): research [1], the guide for Phase 3 (`research/1-nspire-emu.md`): key data, input rules, a draft of contract A and a starter tested against the fake worker.
2. Done (2026-11-17): contract B, version 1 (`web/contract-b.md`).
3. Done (2026-11-17, built by Claude at the user's request): Phase 3, `web/nspire-emu.js` and `web/demo.html`. The team tests it.
4. Research [9]: the test checklist for each app (`tests/checklist.md`). Any time.

**Lane C: TI files (team)**
1. Done: a TI-Nspire CX CAS on OS 3.2.3.1233, older than anything Ndless supports.
2. Done (2026-11-16): Computer Link installed, documents backed up, OS updated once to 4.5.5.79. No updates after this.
3. Done (2026-11-16): Ndless, then PolyDumper; boot1, boot2, diags and manuf are in `roms/` with the 4.5.5.79 OS file (`research/6-ti-files.md`).
4. Skipped at the user's request: the desktop check. The set boots in our web build instead.

**Together, once the lanes meet**
1. Done (2026-11-17): Phase 2, first boot in the browser.
2. Research [5] storage and [8] speed, then build and tune (Phase 4).
3. Phase 5: side-by-side tests and fixes.
4. Phase 6: hand-in ([10]).

**Gates:** the judge's model (ask the teacher; it decides CX or CX II). The download and the calculator gates are passed.

## Phases

### Phase 0: Setup (Claude)
- [x] Unzip `E:\user\Desktop\firebird-master.zip` into `firebird\` and start a git repository, with `roms/` ignored.
- [x] Install emsdk in `E:\emsdk`, pinned to Emscripten 7.0.0 (714 MB download, needs the user's OK first).
- **Done when:** a test program compiles to WebAssembly.

### Phase 1: Compile the emulator to WebAssembly (Claude, team reviews)
- [x] `web/build.py` covering all current core files (including `keypad.cpp`, `cx2.cpp`, `usb_cx2.cpp`, `usblink_cx2.cpp`), current Emscripten options and `-O3`. Link-time optimisation: still to try.
- [x] Fix the old port: real setjmp/longjmp so errors reset instead of crashing, no fixed 1,000-loop main loop. Screen output: CX models only so far.
- [x] `web/bridge.cpp` with the functions JavaScript calls: start, run for N milliseconds, key, touchpad, screen, send file or OS, speed, and (with storage, 2026-11-17) save and restore a snapshot.
- **Done when:** the build has no errors and a bare test page loads it and shows "waiting for boot1/flash".

### Phase 2: First boot in the browser (Claude, needs the TI files)
- [x] Team: dump boot1 and boot2 from our own calculator and download the OS from TI's site (`research/6-ti-files.md`).
- [x] Check the files (in our build).
- [x] Load them in the browser and draw the screen (2026-11-17: home screen, setup and Calculate work; `research/2-7-first-web-build.md`).
- **Done when:** TI's home screen appears and you can move around with the keyboard.

### Phase 3: The web component (built by Claude at the user's request, 2026-11-17; guide: `research/1-nspire-emu.md`)
- [x] Custom element with Shadow DOM.
- [x] Calculator body and keypad: on-screen keys that react on `pointerdown`, PC keyboard mapping (ported from Firebird's `keymap.h` and `qml/Keypad.qml`), touchpad.
- [x] The 320×240 screen, scaled up sharply (`image-rendering: pixelated`).
- [x] API: attributes `boot1` and `flash`; methods `start()`, `reset()`, `sendFile()`; events `ready`, `error`, `speed` (and more: `research/1-nspire-emu.md`).
- **Done when:** putting `<nspire-emu>` into a blank HTML page gives a working calculator. Done: `web/demo.html` (2026-11-17); the team's own tests are next.

### Phase 4: Speed and smoothness (together)
- [ ] Run at the real calculator's speed by default, so the cursor blink, key repeat and clock match. Add a turbo switch for heavy work.
- [x] Run the emulator in short timed slices, and send a frame only when the screen changes.
- [x] Save a snapshot in IndexedDB so it starts instantly instead of booting every time.
- [x] Keep the calculator's flash changes (saved documents) in IndexedDB, so they survive a page reload as they survive switching off the real calculator.
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
