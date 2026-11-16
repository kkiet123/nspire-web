# nspire-web: project context

School team homework: turn the Firebird TI-Nspire emulator (`nspire-emus/firebird`, GPLv3) into `<nspire-emu>`, a web component that runs TI's real TI-Nspire OS in the browser, locally. The judge tests every function as on a real TI-Nspire, and speed and smoothness are graded. Nobody supplies TI files or support (the user, 2026-11-15): getting them is part of the challenge (see TI files). The homework trains problem decoding and web skills.

The pipeline (what comes next, in three lanes) and the phases are in `PLAN.md`. The component breakdown, the contracts between components and the open research questions are in `COMPONENTS.md`. Keep the Status section at the bottom of this file up to date.

## Working with the user
- The user writes in English or Vietnamese. Reply in the language of their latest message.
- Split of work: Claude does the toolchain and C++ side (Phases 0–2). The team writes the web component (Phase 3) and runs the side-by-side tests (Phase 5), so guide and review there instead of writing it all. Speed (Phase 4) is shared.
- Ask before any large download, stating the file, source and size.
- Work order the user chose: big picture first, then research one component at a time and write the findings in `research/`, then build it.

## Decisions
- Project folder: `E:\nspire-web`. C: is short on space (about 16 GB free), E: has about 239 GB free. Keep large files off C:.
- Emscripten through emsdk in `E:\emsdk`, pinned to **7.0.0** (Windows package `wasm-binaries.zip`, 714 MB, from storage.googleapis.com).
- Plain JavaScript, no framework or bundler. No SharedArrayBuffer, so `python -m http.server` can serve it. WebAssembly does not load from `file://`.
- The emulator runs in a Web Worker. The page only draws frames and sends input.
- `web/build.py` replaces the old `emscripten/Makefile` (no `make` on this PC).
- Layout: `firebird/` (upstream source, small marked patches only), `web/` (our code), `web/dist/` (build output), `roms/` (TI files, git-ignored), `tests/`.

## Source
- `E:\user\Desktop\firebird-master.zip`: GitHub master snapshot, newest file dated 2026-11-01, SHA-256 `3408EDC13A20619F2766F3F390AA2E387632612E93D871DBB4A110F9E1EF1307`.
- Checked safe: 269 files under one `firebird-master/` folder, no executables, no `../` paths, image files match their types.
- Includes the January 2026 CX II touchpad fix: `core/flash.cpp` reads the manuf features big-endian.
- `core/` is about 21,800 lines in 77 files.

## Problems in the old web port (`emscripten/`)
- `Makefile` lists `core/keypad.c` (now `keypad.cpp`) and lacks `cx2.cpp`, `usb_cx2.cpp`, `usblink_cx2.cpp`. It uses removed options (`--llvm-lto`, `EXTRA_EXPORTED_RUNTIME_METHODS`) and old `.bc` outputs.
- `emscripten/main.cpp` runs a fixed 1,000-iteration `step()` per frame through `emscripten_set_main_loop_arg`. It replaces the throttle event with a no-op, so there is no pacing and no speed %. `paintLCD` only calls `lcd_cx_draw_frame`. There is no key or touchpad input, and it relies on globals (`Module`, `initLCD`, `fileLoad`).
- `core/emu.cpp`: under `__EMSCRIPTEN__`, `emu_longjmp` is `assert(false)`, so `error()` → `return_to_loop()` crashes instead of resetting. Use real setjmp/longjmp (WebAssembly exception handling).
- `core/emu.h` defines `NO_TRANSLATION` on anything that isn't x86 or ARM, so WebAssembly gets the interpreter only (no JIT).
- Calling `emu_loop()` once per slice is wrong: its preamble's `sched_update_next_event(0)` resets the scheduler's position in the second, and `addr_cache_flush()` costs speed. Plan: split it into `emu_loop_begin()` + `emu_loop_run()`, pace in the worker, and patch `debugger()` so `error()` can't hang the worker (`research/3-4-core-loop.md`).

## Core functions the bridge will expose
- `emu_start()` with `path_boot1` / `path_flash`.
- Input: `keypad_set_key(row, col, state)` and `touchpad_set_state(x, y, contact, down)` in `core/keypad.cpp`.
- Screen: `lcd_cx_draw_frame`, `lcd_cx_w_draw_frame`, `lcd_draw_frame` in `core/lcd.c`. Pick per model.
- Files: `usblink_put_file`, `usblink_send_os` in `core/usblink.c`.
- Speed: `gui_show_speed()`, called from the throttle code in `core/emu.cpp`.
- Snapshots: `emu_snapshot` plus the per-module `*_suspend` / `*_resume` functions.
- Host callbacks: the core calls `gui_*` and `throttle_timer_*` (declared in `core/emu.h`). `headless/main.cpp` implements them without Qt; `emuthread.cpp` is the Qt version.
- `core/os/os-emscripten.c` already exists. It maps `flash.img` copy-on-write, so flash changes stay in memory until `flash_save_changes()` or `flash_save_as()` in `core/flash.cpp` writes them. The model (`product`, `features`) comes from the flash image's manufacturing data, not from a setting.
- Keypad references: `qml/Keypad.qml`, `keymap.h`, `qtkeypadbridge.cpp`. Key images are GPLv3; icons are LGPLv3 (KDE Oxygen).

## TI files
- Nobody supplies them. Route: dump boot1 and boot2 from a calculator the team owns with Ndless + PolyDumper (software only, nothing to open), and download the OS from education.ti.com. Details and sources: `research/6-ti-files.md`.
- Firebird always needs boot1. CX flash image: boot2 + OS (+ optional manuf, diags). CX II flash image: manuf (required) + bootloader + installer (+ diags), and its boot ROM dump needs the keys put in with eMMUlate or Firebird won't boot.
- Ndless r2023 (2026-10-25, official: github.com/ndless-nspire/Ndless/releases) installs only on listed OS builds: CX up to 4.5.5.79, CX II 5.2.0.771, 5.3.0.564, 6.2.0.333, 6.4.0.74. TI blocks downgrades, so never update the calculator's OS before dumping, except to reach a listed build: a CX II on 6.3 goes to exactly 6.4.0.74, and a CX older than every listed build (ours) goes to TI's current 4.5.5.79.
- CX II emulation is still experimental (black-screen freezes, later touchpad and file-transfer reports). Prefer a CX unless the judge uses a CX II.
- No licence to buy: TI sells none for emulators, and the tools are free. TI's OS licence grants use on TI hardware only, so emulating it is a grey area: our own files, kept private, with the teacher's OK for the demo.
- Bring your own files: boot1 may not be shared, so TI files stay in `roms/`, out of git, out of the hand-in and off any public page. The product loads the user's own files; the demo laptop has ours.
- Firebird is GPLv3: any build given to others must come with its source under GPLv3.

## Environment (Windows 11)
- Shells: PowerShell 5.1 and Git Bash.
- Installed: Python 3.14, Git 2.53, MinGW `mingw32-make`. Not installed: Node.js, CMake, Ninja, `make`.
- PowerShell aliases win over functions (`rd` is Remove-Item), so give helper functions Verb-Noun names.

## Status (2026-11-16)
- Plan agreed and moved to E:. Big picture done: `COMPONENTS.md` splits the work into 10 components and 4 contracts, with research questions and a research order.
- Component 6 researched (`research/6-ti-files.md`): no TI files from anyone, so the team dumps its own calculator. The team has a TI-Nspire CX CAS on OS 3.2.3.1233 (2026-11-16), older than anything Ndless supports. Done 2026-11-16: Computer Link works, documents backed up, OS updated to 4.5.5.79 (the battery is worn but held enough charge after a long charge). Ndless r2023 and PolyDumper 5.0 ran; the dumps are in `roms/` (CX CAS, HW A; boot2 partition holds Boot1.5 4.5.0.14; diags 3.2.0.7; hashes in `research/6-ti-files.md`). Open: check that Firebird boots this set (desktop Firebird v1.6, 34 MB download, ask first; or at Phase 2).
- Lane A (2026-11-16): source unzipped into `firebird/` and git started (`a2c69d0` import, `8b213fc` docs). Research [3] + [4] done (`research/3-4-core-loop.md`). Next: research [2], the worker host. Lane C (the OS update, then the dump) waits on the calculator's battery; nothing else needs it before the first boot.
- **Phase 0 has not started.** It needs the user's go-ahead for the 714 MB Emscripten download.
- Still to ask the teacher: which model and OS version the judge uses (part of the spec).
