# Research 5: storage

2026-11-17. Component [5] in `COMPONENTS.md`. Code: `web/worker.js` (storage section), `nw_flash_dirty_blocks`, `nw_flash_block_size` and `nw_suspend` in `web/bridge.cpp`, the storage buttons in `web/main.js`.

## Result
- A reload no longer reinstalls the OS. With a snapshot, "Resume saved" brings the calculator back in about 1.3 s exactly where it was (an open Scratchpad with `11+3 = 14`). Without one, it boots the installed OS from the saved flash in about 45 s, with the language and font settings kept.
- Storage after install and setup: 1011 flash blocks (about 137 MB) and a 10 MB snapshot, in the browser's IndexedDB on this computer.

## How the core saves (from the source)
- `flash_save_changes()` (`flash.cpp:442`) writes only the NAND blocks marked in `nand.nand_block_modified[]` into the open flash file, then clears the marks. `nand` is a global (`flash.h:104`), so the bridge reads the marks without a core patch; `nand_data` itself is static.
- `emu_suspend()` writes a gzip snapshot: a header with the boot1 and flash paths, then flash (the `nand` struct plus the blocks still marked modified), CPU, memory and scheduler state. `flash_resume()` reopens the flash file and lays those blocks over it (`flash.cpp:1057-1100`).
- So a snapshot fits exactly the flash file as saved just before it. If more blocks are saved later, an older snapshot would put stale blocks and stale RAM over newer flash.
- A CX flash image is 138,412,032 bytes: 2048 blocks of 64 pages × 2112 bytes = 135,168 bytes.

## Design (as built)
- IndexedDB database `nspire-web`, used from the worker:
  - `files`: `boot1`, and `meta` { setId, savedAt, flashSize, blockSize }.
  - `blocks`: byte offset → one NAND block, always the current content. Blocks never written (all `0xFF`) are left out and refilled on restore. A fresh setup with the OS preloaded stores 125 blocks in 1.3 s.
  - `snapshots`: `latest` → { core, setId, data, savedAt }.
- **Chrome refuses single values over about 127 MiB** (it reported a 133,169,152-byte limit), so the 132 MiB image can't be stored in one piece. Block by block avoids that, and saving changes is just overwriting blocks.
- When it saves:
  - every 10 s of real time while running, the changed blocks (`nw_flash_dirty_blocks`, then `nw_save_flash`, then a copy out of `/flash.img`), and the old snapshot is deleted;
  - when the page is hidden (another tab, minimised window) and on "Save state now": the changed blocks and a new snapshot in one transaction. This takes about 3.5 s, during which the emulator pauses. No snapshot is taken while a USB transfer runs.
  - On close or navigation the page asks for the same save, but the worker is stopped long before 3.5 s, so in practice only the 10 s flash autosave counts there (seen in the test: after navigating away, the stored state was "flash only").
- Restore: refill the image from the blocks, write `/boot1.img` and `/flash.img`, then resume the snapshot if its `core` id (the hash of `firebird.wasm`, filled in by `build.py`) and its setup id match; otherwise boot from the flash.
- The setup id is a hash of boot1 and the flash image. Storing a new setup clears the old blocks and snapshot.

## Answers to the component questions
- [x] What `flash_save_changes()` writes: only the modified blocks; we store the same blocks in IndexedDB.
- [x] When to save: every 10 s (flash), and on hide, close or request (flash + snapshot).
- [x] Sizes: flash 132 MiB (stored as blocks, about 137 MB once the OS formatted its file system), snapshot about 10 MB gzip. Chrome's per-value limit is about 127 MiB.
- [x] When to throw a snapshot away: after any later flash save, when the core build changes, or when the setup changes.

## Still open
- [ ] Persistent storage: `navigator.storage.persist()` was not granted in the test browser, so the browser may evict the data when the disk is full. Worth showing in the UI.
- [ ] The save pauses the emulator for about 3.5 s. Fine on hide; for an autosave while visible, compress less or snapshot less often.
- [ ] Closing the tab gives no time for a snapshot, and may lose up to 10 s of flash changes; the next visit then boots the saved OS (about 45 s) instead of resuming. Options: a lighter snapshot (store RAM uncompressed, or only changed pages), or a "Save and close" button in the component.
- [ ] Memory on restore: the image exists as the assembled array, in Emscripten's file system and in the core's copy (`os_map_cow`). About 400 MB at peak; worth trimming.
- [ ] Export and import of the saved setup (for moving it to the demo laptop), and a download of `.tns` documents.
