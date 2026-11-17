#!/usr/bin/env python3
"""Build Firebird's core and the bridge into web/dist/ with Emscripten.

    python web/build.py            build (only what changed)
    python web/build.py --clean    rebuild everything
    python web/build.py --debug    -O1, debug info and runtime checks

Replaces the old emscripten/Makefile (there is no make on this PC).
Emscripten comes from emsdk in E:\\emsdk (or the EMSDK environment variable).
"""

import argparse
import concurrent.futures
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CORE = ROOT / 'firebird' / 'core'
WEB = ROOT / 'web'
BUILD = WEB / 'build'
DIST = WEB / 'dist'
EMSDK = Path(os.environ.get('EMSDK', r'E:\emsdk'))
EMSCRIPTEN = EMSDK / 'upstream' / 'emscripten'

# Every core file except the JIT (translate_*, asmcode_*.S), the other OS
# layers and gif.cpp (the bridge provides gif_new_frame). Same list as
# headless/Makefile otherwise.
C_SOURCES = [CORE / f for f in (
    'armsnippets_loader.c', 'asmcode.c', 'casplus.c', 'des.c', 'disasm.c',
    'gdbstub.c', 'interrupt.c', 'lcd.c', 'link.c', 'mem.c', 'misc.c', 'mmu.c',
    'schedule.c', 'serial.c', 'sha256.c', 'usb.c', 'usblink.c',
    'os/os-emscripten.c',
)]
CXX_SOURCES = [CORE / f for f in (
    'arm_interpreter.cpp', 'coproc.cpp', 'cpu.cpp', 'cx2.cpp', 'debug.cpp',
    'emu.cpp', 'fieldparser.cpp', 'flash.cpp', 'keypad.cpp',
    'thumb_interpreter.cpp', 'usb_cx2.cpp', 'usblink_cx2.cpp',
    'usblink_queue.cpp',
)] + [WEB / 'bridge.cpp']

# Copied next to firebird.js so web/dist/ is a complete page.
PAGE_FILES = ['index.html', 'main.js', 'worker.js']

EXPORTS = [
    '_nw_create_flash', '_nw_start', '_nw_run', '_nw_core_wants_fast',
    '_nw_key', '_nw_key_seen', '_nw_touch', '_nw_arrow', '_nw_frame_rgba', '_nw_frame_update',
    '_nw_send_os', '_nw_send_file', '_nw_save_flash', '_nw_reset',
    '_nw_flash_block_size', '_nw_flash_dirty_blocks', '_nw_suspend',
    '_nw_debug_info', '_malloc', '_free',
]
RUNTIME_EXPORTS = ['FS', 'ccall', 'HEAPU8']


def flags(debug):
    opt = ['-O1', '-g'] if debug else ['-O3']
    # Real setjmp/longjmp through WebAssembly exceptions, so error() can jump
    # back into emu_loop_run(); zlib for snapshots.
    common = opt + ['-fwasm-exceptions', '-sSUPPORT_LONGJMP=wasm', '-sUSE_ZLIB=1']
    include = ['-I', str(ROOT / 'firebird')]
    cflags = common + include + ['-std=gnu11']
    cxxflags = common + include + ['-std=gnu++17']
    link = common + [
        '-sMODULARIZE=1', '-sEXPORT_NAME=createFirebird',
        '-sENVIRONMENT=worker',
        '-sINITIAL_MEMORY=256MB', '-sALLOW_MEMORY_GROWTH=1', '-sMAXIMUM_MEMORY=1GB',
        '-sSTACK_SIZE=1MB',
        '-sFORCE_FILESYSTEM=1',
        '-sEXPORTED_FUNCTIONS=' + ','.join(EXPORTS),
        '-sEXPORTED_RUNTIME_METHODS=' + ','.join(RUNTIME_EXPORTS),
    ]
    if debug:
        link += ['-sASSERTIONS=2']
    return cflags, cxxflags, link


def tool_env():
    env = dict(os.environ)
    env['EMSDK'] = str(EMSDK)
    config = EMSDK / '.emscripten'
    if config.exists():
        env['EM_CONFIG'] = str(config)
    return env


def emsdk_python():
    """emsdk's own Python, which Emscripten is tested with; else this one."""
    found = sorted((EMSDK / 'python').glob('*/python.exe'))
    return str(found[-1]) if found else sys.executable


def emcc(args, cxx=False):
    script = EMSCRIPTEN / ('em++.py' if cxx else 'emcc.py')
    return [emsdk_python(), str(script)] + args


def object_path(src):
    rel = src.relative_to(ROOT).as_posix().replace('/', '__')
    return BUILD / 'obj' / (rel + '.o')


def deps_changed(obj, src):
    """True if obj is missing or older than its source or any header it used."""
    if not obj.exists():
        return True
    built = obj.stat().st_mtime
    depfile = obj.with_suffix('.d')
    if not depfile.exists():
        return True
    text = depfile.read_text(encoding='utf-8', errors='replace')
    text = text.replace('\\\n', ' ')
    _, _, deps = text.partition(': ')
    for dep in deps.split():
        p = Path(dep)
        if not p.exists() or p.stat().st_mtime > built:
            return True
    return src.stat().st_mtime > built


def compile_one(src, flagset, cxx, env):
    obj = object_path(src)
    depfile = obj.with_suffix('.d')
    cmd = emcc(flagset + ['-MMD', '-MF', str(depfile), '-c', str(src), '-o', str(obj)], cxx)
    res = subprocess.run(cmd, env=env, capture_output=True, text=True)
    return src, res.returncode, (res.stdout + res.stderr).strip()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--clean', action='store_true', help='rebuild everything')
    ap.add_argument('--debug', action='store_true', help='-O1 with debug info and checks')
    ap.add_argument('-j', type=int, default=os.cpu_count() or 4, help='parallel compile jobs')
    args = ap.parse_args()

    if not (EMSCRIPTEN / 'emcc.py').exists():
        sys.exit(f'Emscripten not found in {EMSCRIPTEN}. Install it with emsdk (see CLAUDE.md).')

    cflags, cxxflags, link = flags(args.debug)
    env = tool_env()

    # A change of flags means a full rebuild.
    stamp = BUILD / 'flags.json'
    current = json.dumps([cflags, cxxflags, link])
    if args.clean or not stamp.exists() or stamp.read_text() != current:
        shutil.rmtree(BUILD / 'obj', ignore_errors=True)
    (BUILD / 'obj').mkdir(parents=True, exist_ok=True)
    DIST.mkdir(parents=True, exist_ok=True)

    jobs = [(s, cflags, False) for s in C_SOURCES] + [(s, cxxflags, True) for s in CXX_SOURCES]
    todo = [j for j in jobs if deps_changed(object_path(j[0]), j[0])]
    print(f'Compiling {len(todo)} of {len(jobs)} files...', flush=True)

    failed = False
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.j) as pool:
        for src, code, out in pool.map(lambda j: compile_one(*j, env), todo):
            name = src.relative_to(ROOT).as_posix()
            if out:
                print(f'--- {name}\n{out}', flush=True)
            if code != 0:
                print(f'FAILED: {name}', flush=True)
                failed = True
    if failed:
        sys.exit(1)
    stamp.write_text(current)

    out_js = DIST / 'firebird.js'
    objs = [str(object_path(s)) for s, _, _ in jobs]
    print('Linking...', flush=True)
    res = subprocess.run(emcc(link + objs + ['-o', str(out_js)], cxx=True), env=env, capture_output=True, text=True)
    output = (res.stdout + res.stderr).strip()
    if output:
        print(output)
    if res.returncode != 0:
        sys.exit('Link failed.')

    # A build id from everything the page loads. Copied page files get it in
    # place of __BUILD__, so file URLs change with every build and browsers
    # can't serve a stale worker or wasm from their cache.
    wasm = DIST / 'firebird.wasm'
    build_id = hashlib.sha256()
    for path in [wasm, out_js] + [WEB / n for n in PAGE_FILES]:
        if path.exists():
            build_id.update(path.read_bytes())
    build_id = build_id.hexdigest()[:12]
    # Snapshots hold raw core state, so they only fit the wasm that wrote them.
    core_id = hashlib.sha256(wasm.read_bytes()).hexdigest()[:12]
    for name in PAGE_FILES:
        src = WEB / name
        if src.exists():
            text = src.read_text(encoding='utf-8')
            text = text.replace('__BUILD__', build_id).replace('__CORE__', core_id)
            (DIST / name).write_text(text, encoding='utf-8', newline='\n')

    print(f'Done: {out_js.relative_to(ROOT)} and firebird.wasm '
          f'({wasm.stat().st_size / 1e6:.2f} MB), build {build_id}')


if __name__ == '__main__':
    main()
