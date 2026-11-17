# Research 2 + 7: the first web build and the first boot

2026-11-17. Components [2] Worker host and [7] Toolchain in `COMPONENTS.md`, researched by building them. Code: `web/bridge.cpp`, `web/build.py`, `web/worker.js`, `web/main.js`, `web/index.html`; core patches marked `nspire-web` in `firebird/core/`.

## Result
- The team's own files boot TI's real OS in the browser: boot1, Boot1.5 and boot2 4.5.0.14, then TI-Nspire CX CAS OS 4.5.5.79 through first-time setup to the home screen. Calculate works (`2+3` → 5, `12·34` → 408); keys, arrows and the touchpad click all reach the OS.
- Speed: about 100 % of a real CX at the home screen and during boot (the worker paces it); about 55–65 % at most while the OS installs (CPU-bound) in the test browser, but see "Headless checks": the same build is faster than a real CX in Node 24.
- `firebird.wasm` is 0.22 MB at `-O3`, `firebird.js` 75 KB.

## [7] Toolchain
- emsdk in `E:\emsdk`, Emscripten 7.0.0 (the newest release, `latest`), with its own Node 24.19.0 and Python 3.13.3. `build.py` runs `emcc.py` with that Python, which avoids `.bat` quoting trouble on Windows.
- Flags that work (`web/build.py`):
  - compile and link: `-O3 -fwasm-exceptions -sSUPPORT_LONGJMP=wasm -sUSE_ZLIB=1` (the zlib port downloads itself on first use);
  - link: `-sMODULARIZE=1 -sEXPORT_NAME=createFirebird -sENVIRONMENT=worker -sINITIAL_MEMORY=256MB -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=1GB -sSTACK_SIZE=1MB -sFORCE_FILESYSTEM=1`, the `nw_*` exports, and runtime exports `FS`, `ccall`, `HEAPU8`.
- Sources: `headless/Makefile`'s list without the JIT, `os-linux.c` and `gif.cpp`, plus `os/os-emscripten.c` and `web/bridge.cpp`. Only one source fix was needed: `os-emscripten.c` lacked `<unistd.h>`/`<string.h>`, which current clang rejects.
- `build.py` compiles in parallel, tracks headers through `-MMD` files, and rebuilds everything when flags change (a change to the export list therefore recompiles all 32 files; splitting compile and link stamps would avoid that).
- Caching: `python -m http.server` sends no cache headers, so browsers kept an old `worker.js`. `build.py` now writes a build id (hash of everything the page loads) into the copied page files as `?v=<id>` on every URL.
- Not done yet: the debug build (`--debug`) is untested; link-time optimisation is not on.

## [2] Worker host (as built)
- Pacing: the core runs with `turbo_mode` on and never waits. The worker owes the emulator the wall-clock time since start minus the emulated time already run, runs it in 10 ms steps through `nw_run(maxVirtualMs, 8 ms real)`, and forgets debt beyond 200 ms (when the emulator is slower than real time). A `MessageChannel` gives zero-delay turns; `setTimeout` covers the waits.
- Frames: the bridge counts LCD refreshes through `gif_new_frame()`, renders only after a refresh, compares with the last picture, and converts RGB565 to RGBA in C. The worker posts at most about 60 frames per second as a transferred buffer.
- Keys: a tap's press and release can arrive between two slices, and the boot loader scans the keypad only now and then (its "Press 'I' to install" prompt missed 50–120 ms taps). The worker holds each release until the key has been down 80 ms of emulated time and a keypad scan has seen it (`nw_key_seen`, reading `kpc.data`), or 1 s has passed (calculator off, or the ON key, which the power unit handles). Changes wait in a queue per key, and a second press waits until the release has lasted 80 ms: the first version cancelled the waiting release instead, so a quick double tap ("00") reached the OS as one press (`tests/worker-keys.js` covers both).
- Arrows press the touchpad's edges, as the desktop app does; `touch` messages pass `touchpad_set_state` through.
- Contract B: version 1 agreed 2026-11-17 in `web/contract-b.md`. From the first draft, `files` + `createFlash` became `load`, `saveFlash` became `save { snapshot: false }`, and storage added `start { saved }`, `queryStorage`, `forget` and the `loaded`, `lcd` and `storage` replies. `web/fake-worker.js` speaks it without the emulator.

## What the first boot taught
- **The desktop "stall" was a prompt.** With the OS preloaded into the flash image, Boot1.5 shows "Factory image found. Press 'I' to install." and waits. After `I`: copy into RAM, reset, install, OS start (about 80–90 s here), then the setup screens.
- **Turbo races idle time.** When the OS is idle, turbo runs emulated time hundreds of times faster than real time, so the calculator's auto power-off fires within seconds. Turbo should probably speed up only busy periods, and must not be left on while waiting for input.
- **The screen can go stale.** When the LCD stops refreshing (calculator off), the page keeps the last picture. The bridge should report "LCD off" after a few hundred ms without a refresh.
- **Nothing persists yet.** The installed OS lives in the worker's memory, so every reload reinstalls (about 90 s). Saving the flash image (and a snapshot) is component [5]'s first job.
- **CPU-bound speed: measure again before tuning.** The test browser showed about 55–65 % of a real CX during the install, but the same build reaches 128–216 % in Node 24 (see below). An attached debugger or automation tool can slow WebAssembly, so measure in a plain Chrome window with DevTools closed. If that also shows less than 100 %, Phase 4 has to close it (link-time optimisation, interpreter hot spots, maybe a JIT).
- **PC keys:** symbol keys (`*`, `+`, `(`, `^`) sit in different places on different layouts, so lane B should map them by `KeyboardEvent.key` and keep `code` for letters, digits and navigation.
- The serial port (UART) shows the boot loader's and OS's messages; the test page prints them, which made this debugging possible.

## Headless checks (2026-11-17, review)
The objects `build.py` compiles were linked a second time with `-sENVIRONMENT=node` (same flags otherwise, output in `web/build/nodetest/`) and run in Node 24 (V8, the engine in Chrome) on the files in `roms/`, with no browser:
- Both flash paths boot to a working calculator: `cxcas-4.5.5.img`, and an image built in the worker from boot2 + manuf + diags + OS (`nw_create_flash` with `readManuf`'s product 0x0F0 and features 0x05). Each went Factory image → `I` → install → setup → home screen → Calculate, where `2+3` gave 5.
- Speed during the install, per 2 s of emulated time: 128–216 %, median 149 % of a real CX. Idle time costs almost nothing (WFI skips to the next event).
- The real `worker.js` (in a `vm` context) paced the core at 97–103 % through the install, and a 60 ms tap of `I` reached boot2 ("Copying pre-installed image into RAM").
- A throw from inside `nw_run` now stops the loop and posts an `error`; before, the loop ended silently and left a frozen screen.

## Follow-ups (2026-11-17)
- **LCD off:** the bridge now does what Firebird's desktop app does (`qtframebuffer.cpp`): the HDQ1W contrast value (`hdq1w.lcd_contrast`, a global in `misc.c`) at 0 means the screen is off. `nw_frame_update()` returns 2 once, the worker posts `{ type: 'lcd', on: false }`, and the next picture after power-on is drawn again. Tested: `ctrl` + `on` turns the screen black with "LCD off", `on` brings the home screen back.
- **Turbo no longer races idle time.** At each 10 ms step the bridge notes whether the CPU sat in "wait for interrupt" (`cpu_events & EVENT_WAITING`). In turbo, `nw_run(…, stop_when_idle)` ends the slice at the first idle step and the worker paces at real speed until a step is busy again; USB transfers still run flat out. Tested: turbo at the idle home screen stays at 100–104 % with no auto power-off; during `factor(2^128+1)` it runs at the emulator's maximum (about 95–128 % in the test browser); holding `on` breaks the calculation ("Error: Break"), as on the real calculator.

## Still open
- [x] "LCD off" detection in the bridge.
- [x] Save and reload the flash image and snapshots ([5], `research/5-storage.md`).
- [x] Turbo that doesn't race idle time.
- [ ] Behaviour in a hidden tab: the worker keeps running, so the calculator stays on and auto power-off happens as on a real one. Pausing while hidden would save battery.
- [ ] Speed: measure the interpreter's hot spots; try link-time optimisation.
- [ ] Debug build; separate compile and link stamps in `build.py`.
