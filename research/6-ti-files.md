# Research 6: TI files and model

2026-11-15. Component [6] in `COMPONENTS.md`.

## Summary
- Nobody will give us TI files, neither TI nor the teacher. Getting them is part of the challenge.
- TI's real OS needs TI's code; there is no way around that. A look-alike app is a different program and would fail a test of every function.
- The legitimate route, and the one Firebird documents: dump boot1 and boot2 from a calculator we own, and download the OS from education.ti.com. Nothing needs opening: it all runs as software on the calculator.
- Boot1 may not be shared; each owner dumps their own. So TI files stay out of git, out of the hand-in and off any public page, and we don't use dumps other people posted online.
- The model and the OS version on our calculator decide which route works. Find them first, and do not update the OS.

## What Firebird needs (from the source)
- **boot1, always.** `emu_start()` loads it into the 512 KiB ROM area and gives up if the file can't be opened (`core/emu.cpp:284-290`).
- **A flash image.** Firebird's flash creator builds it (`flash_create_new()` in `core/flash.cpp:687`, dialog `qml/FlashDialog.qml`):

| Input | CX / CX CAS | CX II / II-T / II CAS |
|---|---|---|
| Model choice | CX or CX CAS, plus subtype HW-A, HW-J (CXCR) or HW-W (CXCR4) | one entry for all CX II |
| Manuf | optional: Firebird writes one (320×240 LCD, 132 MHz, touchpad) | **required** |
| Boot2 | needed | not used |
| Bootloader, Installer | not used | needed |
| OS | the TI download, preloaded into the file system | no field; presumably sent after the first boot (to check) |
| Diags | optional | optional |

- **CX II boot ROM keys.** If bytes 0x27800–0x28000 of boot1 are all zero, Firebird prints "Incomplete bootrom dump detected: Booting will fail." (`core/emu.cpp:294-296`). PolyDumper's CX II dump lacks those keys; eMMUlate supplies them.

## Routes

### CX / CX CAS (our calculator; Firebird's wiki walks through it)
1. Read whether it is a CAS (printed on the front) and the OS and boot1 versions: Home → 5 Settings → 4 Status → About. Do not update.
2. Install TI-Nspire Computer Link 3.9.0.455 on the PC (free from TI; works with the CX, not the CX II). Back up every document on the calculator to the PC. Never let it update the OS on its own; the one exception is just below.
   - Windows 11: if Computer Link says "Cannot find a handheld" and Windows lists "TI-Nspire(tm) Handheld" (`USB\VID_0451&PID_E012`) with error code 28, the calculator was plugged in before TI's driver was installed. Unplug and replug it: Windows then binds TI's `tinspusb` driver, which loads even with Memory integrity on (seen 2026-11-16).
   - Only if the OS is older than every build on Ndless's list (ours was 3.2.3.1233): install TI's current CX OS once, 4.5.5.79, which is on the list. Download it yourself from education.ti.com (`TI-NspireCXCAS-4.5.5.79.tcc` for the CAS, 13,461 KB; the handheld needs 15 MB free) and check the version before sending it. TI's OS page names its Teacher or Student Software (paid) for installing; its knowledge base also describes Computer Link for the CX, so try that first. Then read the OS and boot1 versions again, and never update after that.
3. Install Ndless r2023 (released 2026-10-25; `Ndless-r2023.zip`, 2.31 MB, from the official github.com/ndless-nspire/Ndless releases; check its SHA-256 against the page). CX builds it supports: 4.0.3.93, 4.2.0.532, 4.4.0.532, 4.5.0.1180, 4.5.3.14, 4.5.4.48, 4.5.5.79, plus 3.1.0.392, 3.6.0.546, 3.9.0.463 and 3.9.1.38. On the calculator, make a top-level folder `ndless`, copy in `ndless_resources.tns` and the installer for our OS, and open the installer:
   - 4.5.5.79: `ndless_installer_4.5.5-6.2.0-6.4.0.tns`; it asks for the boot1 version from step 1.
   - 4.5.3.14 or 4.5.4.48: `ndless_installer_4.5.3-4.5.4.tns`.
   - 4.5.0: `ndless_installer_4.5.0.tns`.
   - 4.4.0: `ndless_installer_4.4.0.tns`, then close it with Ctrl+W.
   - 4.2.0 or 4.0.3: `ndless_installer_4.2.0_cx.tns` or `…_cascx.tns` (4.0.3 likewise), then close it with Ctrl+W.
   If it fails or the calculator reboots, run it again. The README offers a persistent install only on 6.2 and 6.4, so on 4.x expect to rerun it after a reboot. To remove Ndless, open `ndless_resources.tns` and choose Yes.
4. Run PolyDumper (TI-Planet; pick the build for our OS) to dump boot1 and boot2, plus manuf, so the emulated hardware revision matches ours.
5. Copy the dumps into `roms/` with Computer Link and record their SHA-256.
6. Download the CX OS from education.ti.com. Firebird's wiki recommends 4.5; the same version as our calculator keeps side-by-side tests fair.
7. Build the flash image from boot2 + OS (+ manuf, diags).

### CX II / CX II-T / CX II CAS (more steps; emulation still experimental)
1. Read the OS version. Ndless r2023 runs only on 5.2.0.771, 5.3.0.564, 6.2.0.333 and 6.4.0.74. Per its release notes, a CX II on 6.3 must first update to exactly 6.4.0.74 (never past it).
2. Ndless, then PolyDumper: a boot ROM dump without keys (`btrom.tns`), plus manuf and the other parts (which ones PolyDumper writes on the CX II is still to check).
3. eMMUlate (github.com/satyamedh/eMMUlate, MIT license): a program for the calculator that reads the boot ROM keys through an MMU trick and shows them as a QR code; a phone holding `btrom.tns` scans it and writes the keys in.
4. Build the flash image from manuf + bootloader + installer (+ diags), then send the OS from education.ti.com.

### If our calculator's OS is not on the list
- TI does not let a handheld go back to an older OS, and community downgraders (backSpire) need Ndless to begin with.
- So use another calculator whose OS is on the list: any team member's, or the school's with the teacher's OK.

### Building Ndless ourselves (not worth it)
- Same result: the build makes the same installers for the same OS builds. Supporting another OS build means finding a new exploit in it, which is research-level work.
- Cost: the repository needs `git clone --recursive` for its four submodules (nspire-io, zlib, freetype2, luna); GitHub's "Source code" zip leaves them out, so it doesn't build. The SDK first builds its own `arm-none-eabi` cross-compiler with `ndless-sdk/toolchain/build_toolchain.sh` (binutils 2.44, GCC 14.2.0, newlib 4.5.0.20241231, GDB 16.2, downloaded from GNU mirrors), which needs the GMP, MPFR, MPC, zlib and Python 3 development files. It is a POSIX shell script, so in practice Linux or WSL, neither of which is in our setup; C: is also short on space.
- So: use the official `Ndless-r2023.zip` and check its SHA-256. Building only makes sense if we write our own calculator program, which this project doesn't need (PolyDumper and eMMUlate exist).

## Our dump (2026-11-16)
Dumped with PolyDumper 5.0 under Ndless r2023 after the OS update; files in `roms/` (kept out of git).

| File | Bytes | SHA-256 | What it is |
|---|---|---|---|
| `boot1.img.tns` | 524,288 | `0a911a688af9522b6987aa62cf455f592dc37613c44e98de1507bb80d8b94f80` | boot ROM, full 512 KiB, no blank tail |
| `boot2.img.tns` | 2,752,512 | `848c1f0c1a2e5fda049bb37a18f5ac627c7487e971d18ce8230421e334c35338` | boot2 partition (pages 0x40–0x57F); holds **Boot1.5 4.5.0.14**, which the OS 4.5 update installs there |
| `diags.img.tns` | 917,504 | `23cb93f7203cf306c1c10414a1facdc13f972b20ed0d43f0a1f006670b529203` | Diags 3.2.0.7 |
| `manuf.img.tns` | 131,072 | `9d400d59e72beaafa564acf1efb7c1c9ee51f9661a16e1e493de4ffcbe4729ab` | manufacturing data |
| `TI-NspireCXCAS-4.5.5.79.tcc` | 13,784,836 | `629c7ec8c61fef902cc1fe610bceb49767f13d9d7875a8728490443433cf9232` | OS from education.ti.com |

Decoded the way Firebird does (`flash_read_type`, `flash_component_info`):
- Manuf: product 0x0F = **CX CAS**, features 0x05 = **HW A**, locale `en`, touchpad keypad (76), LCD 320×240 at 16 bpp, clock setting 0x561002 (132 MHz in Firebird's notes), SDRAM setting 0xFC018012 (Firebird's "large SDRAM" value), boot2 at 0x20000, bootdata at 0x2C0000, file system at 0x400000.
- So Firebird's Create Flash dialog takes: model CX CAS, subtype HW-A, Manuf `manuf.img.tns`, Boot2 `boot2.img.tns`, OS the `.tcc`, Diags `diags.img.tns`. The dialog will say it found BOOT1.5 instead of BOOT2; that is expected after OS 4.x, and the first boot will show whether Firebird runs it.

## Risks
- Ndless's persistent install can lose data or reboot-loop the calculator: back up its documents first.
- One OS update from TI's software closes the Ndless route for that calculator.
- CX II: extra dumping steps on top of experimental emulation (black-screen freezes, touchpad and file-transfer reports). Prefer a CX unless the judge is known to use a CX II.

## Licences and cost
- Nothing to buy. TI sells no licence for running its OS in someone else's emulator, and every tool on the route is free (Ndless, PolyDumper, eMMUlate, Firebird; the OS is a free download).
- TI's OS licence (the CX II version, read 2026-11-16): a personal, non-transferable single-user licence to use the OS on supported TI hardware; one backup copy allowed; no reverse engineering, modifying, publishing or passing it on. It says nothing specific about emulators, but its use right covers TI hardware only, so running the OS in Firebird sits outside what it grants. Buying anything would not change that.
- So: files from our own calculator, for this school project, on our own machines; never published or hosted; the teacher confirms the demo is fine (`PLAN.md`, open question 3). The README says the project is unofficial and not affiliated with TI, and we use no TI logo.
- Transfer tools: CX II → TI-Nspire CX II Connect, TI's web app (Chrome 143+, Windows 11 64-bit; its page lists no price). CX → TI-Nspire Computer Link 3.9.0.455, a free download from TI; TI's knowledge base uses it with the CX for OS installs, and its page says it doesn't work with the CX II.

## What this means for the product
- Bring your own files: `<nspire-emu>` ships no TI code. A user loads boot1 and a flash image (or boot2 + OS) once, from their own calculator, and [5] keeps them in IndexedDB.
- Our demo laptop has our own dump loaded, so the demo runs the real OS.
- The flash creator is part of the core, so the bridge can expose it ([3]) and the page can build the flash image in the browser. Nobody needs the desktop Firebird.

## Still open
- [x] Our calculator: TI-Nspire CX CAS, HW A; updated from OS 3.2.3.1233 to 4.5.5.79 and dumped (see "Our dump").
- [x] PolyDumper's current version and what it writes on each model: 5.0; on the CX it writes `boot1`, `boot1alt` (if present), `boot2`, `diags` and `manuf` as `.img.tns`.
- [ ] Does Firebird boot our set (Boot1.5 in the boot2 partition)? Check in the desktop Firebird (v1.6, `firebird-emu-win64.zip`, 34,143,096 bytes from the GitHub release; a download, ask first) or at Phase 2.
- [ ] CX II: what the "installer" file is, and whether the OS goes in after the first boot.
- [ ] The judge's model (ask the teacher: part of the spec, not support).
- [x] A free tool to copy files between a CX and the PC: TI-Nspire Computer Link 3.9.0.455.
- [ ] Check the files in our own build, or first in the desktop Firebird (a download: ask first)?

## Sources
- Firebird wiki, First-Time Setup: https://github.com/nspire-emus/firebird/wiki/First-Time-Setup
- Ndless README (r2023, supported OS builds, install warnings): https://github.com/ndless-nspire/Ndless
- Ndless r2023 release notes (exact builds, the 6.3 note): https://github.com/ndless-nspire/Ndless/releases/tag/r2023
- Ndless submodules: https://github.com/ndless-nspire/Ndless/blob/master/.gitmodules
- Ndless SDK toolchain script: https://github.com/ndless-nspire/Ndless/blob/master/ndless-sdk/toolchain/build_toolchain.sh
- Hackspire, Emulators (PolyDumper, eMMUlate for the CX II): https://hackspire.org/index.php/Emulators
- eMMUlate: https://github.com/satyamedh/eMMUlate
- PolyDumper on TI-Planet: https://tiplanet.org/forum/archives_voir.php?id=3829
- TI knowledge base, error when loading an older OS: https://education.ti.com/customer-support/Knowledge-base/TI-Nspire-Family/Troubleshooting-messages-unexpected-results/35156
- backSpire downgrader: https://ti-planet.org/forum/archives_voir.php?id=3152639
- TI licence for the TI-Nspire CX II OS and apps: https://education.ti.com/en/product-resources/eula/osapps-nspire
- TI-Nspire CX II Connect: https://education.ti.com/en/products/computer-software/ti-nspire-cx-ii-connect
- TI-Nspire Computer Link: https://education.ti.com/en/software/details/en/82035809F7E6474099944056CCB01C20/ti-nspire_computerlink
- TI-Nspire CX CAS OS download (4.5.5.79): https://education.ti.com/software/details/en/0607F21D07B14ACB9EE85E57A9C30EDA/ti-nspirecxcas_os
- TI knowledge base, updating a CX through Computer Link: https://education.ti.com/en/customer-support/knowledge-base/ti-nspire-family/product-usage/40358
- Omnimaga Firebird thread (boot1 is not to be shared): https://omnimaga.org/ti-nspire-projects/new-ti-nspire-emulator
