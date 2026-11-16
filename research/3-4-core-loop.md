# Research 3 + 4: the core loop and its callbacks

2026-11-16. Components [3] Bridge and [4] Emulator core in `COMPONENTS.md`. Read from `firebird/` (upstream snapshot, commit a2c69d0).

## Summary
- The core runs in `emu_loop()`, which never returns on its own. Every 10 ms of emulated time a throttle event runs, and on the desktop it sleeps there to match real time. A browser worker can't sleep, so the web build must stop after a slice, return to JavaScript, and later continue exactly where it stopped.
- Proposed core patch (small, marked): split `emu_loop()` into `emu_loop_begin()` (the one-time preamble) and `emu_loop_run()` (sets the error jump point, then runs until a yield is requested or `exiting`). The desktop's `emu_loop()` becomes begin + run, so its behaviour stays the same.
- Pacing moves to JavaScript: the core runs with `turbo_mode = true` (it never waits), the bridge counts throttle events (10 ms of emulated time each) through `gui_do_stuff`, and the worker decides how many to run per tick from the wall clock. Turbo then just means "no cap".
- Errors: let Emscripten use real `setjmp`/`longjmp` (wasm exceptions), and keep the interactive debugger out of the web build.
- Contracts C and D follow below.

## How the core runs (from the source)

### `emu_start()` (`core/emu.cpp:196`)
- From scratch: `flash_open(path_flash)`, then the model from the flash's manufacturing data (`flash_read_settings`), `memory_initialize(sdram_size)`, boot1 read into the 512 KiB ROM, `addr_cache_init()`, `throttle_timer_on()`, `usblink_queue_reset()`, `emu_reset()`.
- From a snapshot: a gzip stream. The header holds `SNAPSHOT_SIG`, `SNAPSHOT_VER` (3) and the boot1 and flash paths; flash, CPU, memory and scheduler state follow. boot1 is read again from the path in the header, so the virtual file names must stay the same between saving and resuming.

### `emu_loop()` (`core/emu.cpp:324`)
- Preamble: optional `emu_reset()`, `gdbstub_reset()`, `addr_cache_flush()`, `flush_translations()`, `sched_update_next_event(0)`, `exiting = false`, then `emu_setjmp(restart_after_exception)`.
- Loop: `while (!exiting) { sched_process_pending_events(); while (!exiting && cycle_count_delta < 0) { reset? sleep (CX II)? IRQ/FIQ; cpu_arm_loop() or cpu_thumb_loop() } }`.
- Calling `emu_loop()` again for every slice would be wrong: the preamble's `sched_update_next_event(0)` restarts the scheduler's position within the current second (emulated time slips), and `addr_cache_flush()` on every slice costs speed. Hence the split.

### Scheduler (`core/schedule.c`)
- Five events (throttle, keypad, LCD, timers, watchdog) on six clocks (CPU, AHB, APB, 27 MHz, 12 MHz, 32 kHz).
- `cycle_count_delta` counts CPU cycles up to the next event and is negative while running; the interpreters run while it stays below 0 (`cpu.cpp:26`, `thumb_interpreter.cpp:82`).
- Idle: the "wait for interrupt" instruction (`coproc.cpp:107`) sets `cycle_count_delta = 0`, so an idle OS jumps straight to the next event instead of spinning. Idle costs almost no host CPU.

### Throttle event (`core/emu.cpp:116`)
- Every 10 ms of emulated time (27 MHz / 100): the USB link timer and queue, serial input, GDB and remote-debug polling, then pacing: if less than 10 ms of real time has passed and `turbo_mode` is off, it calls `throttle_timer_wait(µs)`. Every 500 ms of real time it reports `gui_show_speed(emulated / real)`. Last comes `gui_do_stuff(true)`.

### LCD (`core/lcd.c:306`)
- `lcd_event` runs at the refresh rate the OS programs into the LCD controller. It latches the frame address (`lcd.framebuffer = lcd.upbase`), raises the LCD interrupt and calls `gif_new_frame()`.
- `lcd_cx_draw_frame(uint16_t *buf)` renders the current frame as 320×240 RGB565 and calls the HW-W variant itself when needed (`lcd.c:201-211`).

## Contract D: what the core expects from the host

| Callback | Called from | Web behaviour |
|---|---|---|
| `gui_do_stuff(wait)` | end of every throttle event; debugger and GDB stub loops | count 10 ms of emulated time; request a yield once the slice's budget is used |
| `throttle_timer_wait(us)` | throttle event, only when `turbo_mode` is off | unused (the core runs with `turbo_mode = true`); no-op |
| `throttle_timer_on()` / `throttle_timer_off()` | `emu_start` (on); USB file transfer (off while sending, on after); debugger (off) | a flag for the worker: run unpaced while the core asks for it, so file transfers go fast |
| `gui_show_speed(ratio)` | throttle event, every 500 ms of real time | post `speed` |
| `gui_status_printf` | reset, flash save, USB transfer progress | post `status` |
| `gui_debug_printf`, `gui_debug_vprintf`, `gui_perror` | warnings, errors, `emuprintf` | post `log` (browser console) |
| `gui_putchar`, `gui_getchar` | serial port (UART) | output buffered to `log`; input returns -1 |
| `gui_usblink_changed(bool)` | USB link connect and reset | post `usblink` |
| `gui_set_busy(bool)` | `emu_start`, `emu_suspend` | ignore, or post `busy` |
| `gui_debugger_entered_or_left`, `gui_debugger_request_input` | debugger | stubs (see the patches) |

## Contract C: what the bridge exports (first draft)
Names are placeholders; the final list comes with Phase 1.
- `nw_start(from_snapshot)`: `emu_start()` with `/boot1.img` and `/flash.img` (or `/snapshot.gz`), then `emu_loop_begin()`.
- `nw_run(max_virtual_ms, max_real_ms)`: runs until either budget is used; returns the emulated milliseconds done (a multiple of 10).
- `nw_key(row, col, down)` and `nw_touch(x, y, contact, down)`: call `keypad_set_key` and `touchpad_set_state` between slices. Pressing row 0, column 9 also calls `keypad_on_pressed()` (the ON key).
- `nw_frame(out)`: `lcd_cx_draw_frame(out)`; returns how many LCD refreshes happened since the last call (0 means no new frame).
- `nw_send_file(local, remote)` and `nw_send_os(local)`: `usblink_queue_put_file` and `usblink_queue_send_os`, which connect the USB link themselves; progress comes back through a callback.
- `nw_save_flash()`: `flash_save_changes()`. `nw_suspend(path)`: `emu_suspend()`. `nw_reset()`: `usblink_queue_reset()` plus `cpu_events |= EVENT_RESET`, as the desktop's reset does.
- `nw_set_turbo(on)`.
- `nw_create_flash(...)`: `flash_create_new()` (CX: boot2 + OS, optional manuf and diags), saved like `flash_save_as()`.

## Patches the core needs (small, marked `nspire-web`)
1. `core/emu.cpp`: split `emu_loop()` into `emu_loop_begin(bool reset)` and `emu_loop_run()`, with a yield check right after `sched_process_pending_events()`; `emu_loop()` stays as begin + run.
2. `core/emu.cpp`: remove `__EMSCRIPTEN__` from the iOS branch, so Emscripten uses `setjmp`/`longjmp` (built with wasm exceptions; flags in research [7]). The jump point has to be set inside `emu_loop_run()` on every call, because the frame that called `setjmp` must still be live when `error()` jumps.
3. The debugger: `error()` calls `debugger()`, and the native debugger waits in a loop for typed commands (`debug.cpp:587-602`), which would hang the worker. Patch `debugger()` to only log under Emscripten. (A no-patch alternative is setting `in_debugger = true` from the bridge, since `debugger()` returns at once when it is set, `debug.cpp:795`; the patch is clearer.)

No patch needed for frame timing: `gif_new_frame()` is a hook the host can provide. Leave `gif.cpp` out of the build and count frames in the bridge. Input, USB transfers, snapshots and flash saving need no patches either.

## Answers to the component questions
- [3] Run one slice and return: yes, with patch 1; pacing moves to the worker.
- [3] Errors: with patches 2 and 3, `error()` logs, jumps back into the loop, and the loop resets the calculator (`EVENT_RESET`), as on the desktop.
- [3] Which callbacks matter, and where their output goes: the table above.
- [4] Real-time clock: `rtc_read()` returns `time(NULL) - rtc.offset` (`misc.c:391`), and the OS sets the offset. The calculator's clock follows the PC's clock, and the offset is kept in snapshots.
- [4] Battery: the ADC returns a fixed voltage (`misc.c:806-819`), so the emulated battery never runs low.
- [4] Press-to-Test LED: the LED registers are stored (`misc.c:673-695`), but nothing shows them. The page could read them and draw the LED.
- [4] Sleep: `EVENT_SLEEP` is CX II only. On the CX, an idle or "off" OS waits for interrupts, which the scheduler skips through cheaply.
- [4] Where the interpreter spends time: needs a running build (Phase 2).

## Consequences for other components
- [2] Worker host: owns pacing (wall clock against 10 ms emulated steps), yields between slices, applies input between slices, and polls the frame after each slice.
- [5] Storage: `flash_save_changes()` writes only modified NAND blocks (`nand_block_modified`), which suits storing blocks one by one in IndexedDB. Memory: `nand_initialize()` maps the whole image with `os_map_cow()` (132 MiB for a CX), and on Emscripten that copies it into wasm memory on top of the file in the in-memory file system. Avoid the double copy.
- [7] Toolchain: zlib is required (snapshots are gzip); `dup()` and `mmap()` must work on Emscripten's in-memory file system (`emu.cpp`, `os-emscripten.c`); `gif.cpp` can be left out.

## Still open
- [ ] Where the interpreter spends its time (after the first boot).
- [ ] Best slice length (research [2]).
- [ ] Exact flag names in Emscripten 7.0.0 (research [7]).
