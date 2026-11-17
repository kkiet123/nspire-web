// nspire-web bridge: connects Firebird's core to the worker's JavaScript.
//
// Contract D (the callbacks the core expects from its host) and contract C
// (the functions the worker calls) are described in research/3-4-core-loop.md.
// The core runs with turbo_mode on and never waits; the worker paces it in
// 10 ms steps of emulated time and calls nw_run() for each slice.

#include <cerrno>
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <unistd.h>

#include <emscripten.h>

#include "core/emu.h"
#include "core/flash.h"
#include "core/gif.h"
#include "core/keypad.h"
#include "core/lcd.h"
#include "core/usblink.h"
#include "core/usblink_queue.h"

// ---- Calls into the worker (properties of the Emscripten Module) -----------

EM_JS(void, js_log, (const char *text), {
    if (Module.onLog) Module.onLog(UTF8ToString(text));
});
EM_JS(void, js_status, (const char *text), {
    if (Module.onStatus) Module.onStatus(UTF8ToString(text));
});
EM_JS(void, js_speed, (double ratio), {
    if (Module.onSpeed) Module.onSpeed(ratio);
});
EM_JS(void, js_usblink, (int connected), {
    if (Module.onUsblink) Module.onUsblink(connected != 0);
});
EM_JS(void, js_progress, (int what, int percent), {
    if (Module.onProgress) Module.onProgress(what, percent);
});

// ---- Contract D: callbacks the core expects ------------------------------

// Debug output arrives in pieces ("Error (...): " + message + "\n"), so
// collect whole lines before passing them on.
static std::string log_line, serial_line;

static void log_text(const char *s)
{
    for (; *s; ++s) {
        if (*s == '\n') {
            js_log(log_line.c_str());
            log_line.clear();
        } else {
            log_line += *s;
        }
    }
}

void gui_debug_vprintf(const char *fmt, va_list ap)
{
    char buf[2048];
    vsnprintf(buf, sizeof(buf), fmt, ap);
    log_text(buf);
}

void gui_debug_printf(const char *fmt, ...)
{
    va_list ap;
    va_start(ap, fmt);
    gui_debug_vprintf(fmt, ap);
    va_end(ap);
}

void gui_perror(const char *msg)
{
    gui_debug_printf("%s: %s\n", msg, strerror(errno));
}

void gui_status_printf(const char *fmt, ...)
{
    char buf[512];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(buf, sizeof(buf), fmt, ap);
    va_end(ap);
    js_status(buf);
}

// The calculator's serial port (UART): show it in the log, line by line.
void gui_putchar(char c)
{
    if (c == '\n') {
        std::string line = "[serial] " + serial_line;
        js_log(line.c_str());
        serial_line.clear();
    } else if (c != '\r') {
        serial_line += c;
    }
}

int gui_getchar() { return -1; }
void gui_set_busy(bool) {}
void gui_show_speed(double ratio) { js_speed(ratio); }
void gui_usblink_changed(bool state) { js_usblink(state); }
void gui_debugger_entered_or_left(bool) {}
void gui_debugger_request_input(debug_input_cb) {}

// The core asks for full speed while it sends a file over USB
// (throttle_timer_off) and for normal pacing afterwards (throttle_timer_on).
// turbo_mode itself stays on: the worker does the pacing.
static bool core_wants_fast = false;
void throttle_timer_on() { core_wants_fast = false; }
void throttle_timer_off() { core_wants_fast = true; }
void throttle_timer_wait(unsigned int) {}

// One call per throttle event, that is per 10 ms of emulated time.
static int slice_ticks_left = 0;
static int slice_ticks_done = 0;
static double slice_deadline = 0;

void gui_do_stuff(bool)
{
    ++slice_ticks_done;
    if (--slice_ticks_left <= 0 || emscripten_get_now() >= slice_deadline)
        emu_yield_requested = true;
}

// lcd_event() calls this on every LCD refresh. gif.cpp is not built.
static uint32_t lcd_refreshes = 0;
void gif_new_frame() { ++lcd_refreshes; }
bool gif_start_recording(const char *, unsigned int) { return false; }
bool gif_stop_recording() { return false; }

// ---- Contract C: functions for the worker --------------------------------

extern "C" {

// Files are written into Emscripten's in-memory file system by the worker:
// /boot1.img, /flash.img, and for nw_create_flash /boot2.img, /manuf.img,
// /diags.img, /os.tcc. os-emscripten.c maps exactly "flash.img" (cwd /).

EMSCRIPTEN_KEEPALIVE int nw_create_flash(int product, int features, int with_manuf, int with_diags, int with_os)
{
    const char *preload[4] = {
        with_manuf ? "/manuf.img" : nullptr,
        "/boot2.img",
        with_diags ? "/diags.img" : nullptr,
        with_os ? "/os.tcc" : nullptr,
    };
    bool is_cx = product >= 0x0F0;

    uint8_t *data = nullptr;
    size_t size = 0;
    if (!flash_create_new(is_cx, preload, product, features, is_cx, &data, &size)) {
        free(data);
        return 0;
    }

    FILE *f = fopen("/flash.img", "wb");
    bool ok = f && fwrite(data, size, 1, f) == 1;
    if (f)
        fclose(f);
    free(data);
    return ok ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE int nw_start(int from_snapshot)
{
    if (chdir("/") != 0)
        return 0;
    path_boot1 = "boot1.img";
    path_flash = "flash.img";
    turbo_mode = true; // never wait inside the core; the worker paces it

    if (!emu_start(0, 0, from_snapshot ? "snapshot.gz" : nullptr))
        return 0;

    emu_loop_begin(!from_snapshot);
    return 1;
}

// Runs the emulator until max_virtual_ms of emulated time or max_real_ms of
// real time is used, whichever comes first. Returns the emulated ms done
// (a multiple of 10).
EMSCRIPTEN_KEEPALIVE int nw_run(int max_virtual_ms, double max_real_ms)
{
    if (exiting)
        return 0;

    slice_ticks_left = max_virtual_ms / 10;
    if (slice_ticks_left < 1)
        slice_ticks_left = 1;
    slice_ticks_done = 0;
    slice_deadline = emscripten_get_now() + max_real_ms;

    emu_loop_run();
    return slice_ticks_done * 10;
}

EMSCRIPTEN_KEEPALIVE int nw_core_wants_fast() { return core_wants_fast ? 1 : 0; }

EMSCRIPTEN_KEEPALIVE void nw_key(int row, int col, int down)
{
    if (row < 0 || row >= KEYPAD_ROWS || col < 0 || col >= KEYPAD_COLS)
        return;
    keypad_set_key(row, col, down != 0);
}

// Has a keypad scan seen this key down yet? The scan copies key_map into
// kpc.data (bit set = pressed on the CX, cleared on older models). The worker
// holds a quick tap until this is true, so the OS can't miss it. The ON key is
// handled by the power unit, not the scan, and never shows up here.
EMSCRIPTEN_KEEPALIVE int nw_key_seen(int row, int col)
{
    if (row < 0 || row >= 16 || col < 0 || col >= 16)
        return 1;
    bool bit = keypad.kpc.data[row] & (1 << col);
    return (emulate_cx ? bit : !bit) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE void nw_touch(float x, float y, int contact, int down)
{
    touchpad_set_state(x, y, contact != 0, down != 0);
}

// Arrow keys press the edge of the touchpad, as Firebird's desktop app does
// (qtkeypadbridge.cpp). dir: 0 up, 1 down, 2 left, 3 right.
EMSCRIPTEN_KEEPALIVE void nw_arrow(int dir, int down)
{
    uint16_t x = TOUCHPAD_X_MAX / 2, y = TOUCHPAD_Y_MAX / 2;
    switch (dir) {
    case 0: y = TOUCHPAD_Y_MAX; break;
    case 1: y = 0; break;
    case 2: x = 0; break;
    case 3: x = TOUCHPAD_X_MAX; break;
    default: return;
    }

    if (down) {
        keypad.touchpad_x = x;
        keypad.touchpad_y = y;
        keypad.touchpad_contact = keypad.touchpad_down = true;
    } else if (keypad.touchpad_x == x && keypad.touchpad_y == y) {
        keypad.touchpad_contact = keypad.touchpad_down = false;
    }

    keypad.kpc.gpio_int_active |= 0x800;
    keypad_int_check();
}

// The screen: lcd_cx_draw_frame() gives 320x240 RGB565; we turn it into RGBA
// only when the LCD refreshed and the picture changed.
static uint16_t frame565[320 * 240];
static uint16_t shown565[320 * 240];
static uint8_t frame_rgba[320 * 240 * 4];
static bool have_shown = false;
static uint32_t refreshes_seen = 0;

EMSCRIPTEN_KEEPALIVE uint8_t *nw_frame_rgba() { return frame_rgba; }

// Returns 1 when frame_rgba holds a new picture, 0 otherwise.
EMSCRIPTEN_KEEPALIVE int nw_frame_update()
{
    if (have_shown && lcd_refreshes == refreshes_seen)
        return 0;
    refreshes_seen = lcd_refreshes;

    lcd_cx_draw_frame(frame565);
    if (have_shown && memcmp(frame565, shown565, sizeof(frame565)) == 0)
        return 0;
    memcpy(shown565, frame565, sizeof(frame565));
    have_shown = true;

    for (int i = 0; i < 320 * 240; i++) {
        uint16_t p = frame565[i];
        uint8_t r = p >> 11, g = (p >> 5) & 0x3F, b = p & 0x1F;
        frame_rgba[i * 4 + 0] = (r << 3) | (r >> 2);
        frame_rgba[i * 4 + 1] = (g << 2) | (g >> 4);
        frame_rgba[i * 4 + 2] = (b << 3) | (b >> 2);
        frame_rgba[i * 4 + 3] = 255;
    }
    return 1;
}

// USB link: what = 1 for an OS, 2 for a file; percent 0-100, negative on error.
static void progress_cb(int percent, void *user)
{
    js_progress(static_cast<int>(reinterpret_cast<intptr_t>(user)), percent);
}

EMSCRIPTEN_KEEPALIVE void nw_send_os(const char *path)
{
    usblink_queue_send_os(path, progress_cb, reinterpret_cast<void *>(1));
}

EMSCRIPTEN_KEEPALIVE void nw_send_file(const char *local, const char *remote)
{
    usblink_queue_put_file(local, remote, progress_cb, reinterpret_cast<void *>(2));
}

EMSCRIPTEN_KEEPALIVE int nw_save_flash() { return flash_save_changes() ? 1 : 0; }

// Storage (component 5). The worker keeps the flash image in IndexedDB as a
// base image plus the blocks saved since; these tell it which blocks to copy
// out of /flash.img after nw_save_flash() has written them there.
EMSCRIPTEN_KEEPALIVE int nw_flash_block_size()
{
    return static_cast<int>(nand.metrics.page_size << nand.metrics.log2_pages_per_block);
}

// Indices of the NAND blocks changed since the last save. Call before
// nw_save_flash(), which clears the marks.
EMSCRIPTEN_KEEPALIVE int nw_flash_dirty_blocks(uint16_t *out, int max)
{
    int num_blocks = static_cast<int>(nand.metrics.num_pages >> nand.metrics.log2_pages_per_block);
    int n = 0;
    for (int i = 0; i < num_blocks && i < 2048 && n < max; i++)
        if (nand.nand_block_modified[i])
            out[n++] = static_cast<uint16_t>(i);
    return n;
}

// Writes the whole machine state to /snapshot.gz. It holds only the flash
// blocks changed since the last nw_save_flash(), so it fits that flash image.
EMSCRIPTEN_KEEPALIVE int nw_suspend() { return emu_suspend("snapshot.gz") ? 1 : 0; }

EMSCRIPTEN_KEEPALIVE void nw_reset()
{
    usblink_queue_reset();
    cpu_events |= EVENT_RESET;
}

// Development aid: a snapshot of counters and keypad registers.
static int32_t debug_info[32];
EMSCRIPTEN_KEEPALIVE int32_t *nw_debug_info()
{
    int n = 0;
    debug_info[n++] = static_cast<int32_t>(lcd_refreshes);
    debug_info[n++] = static_cast<int32_t>(keypad.kpc.control);
    debug_info[n++] = static_cast<int32_t>(keypad.kpc.size);
    debug_info[n++] = keypad.kpc.int_enable;
    debug_info[n++] = keypad.kpc.int_active;
    debug_info[n++] = static_cast<int32_t>(keypad.kpc.gpio_int_enable);
    debug_info[n++] = static_cast<int32_t>(keypad.kpc.gpio_int_active);
    for (int i = 0; i < 8; i++)
        debug_info[n++] = keypad.key_map[i];
    for (int i = 0; i < 8; i++)
        debug_info[n++] = keypad.kpc.data[i];
    debug_info[n++] = static_cast<int32_t>(cpu_events);
    return debug_info;
}

} // extern "C"
