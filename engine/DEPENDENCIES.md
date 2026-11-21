# DEPENDENCIES: every outside piece in the engine, and its licence

The rule (SPEC-screens.md): permissive licences only (MIT, Apache-2.0, BSD, ISC, zlib, MPL-2.0 as an unmodified
library). No GPL, AGPL or LGPL. No code from Sunshine, Moonlight, moonlight-web-stream, Apollo or RustDesk.

Regenerate the list with, from this folder:
`cargo tree --prefix none --format "{p} | {l}" --target x86_64-pc-windows-msvc -e normal,build`

## Not crates
| Piece | What it is | Licence |
| --- | --- | --- |
| `vendor/nvEncodeAPI.h` | NVIDIA's encoder interface, as it came (see `vendor/README.txt`) | MIT-style notice in the file |
| NVIDIA's encoder, Windows' Desktop Duplication, Windows' encryption (CNG) | parts of the driver and of Windows, called at run time | nothing of theirs is shipped |

## Asked for by name (Cargo.toml)
| Crate | Why | Licence |
| --- | --- | --- |
| `str0m` 0.25.0 (features: `wincrypto` only) | WebRTC that takes ready-encoded video; does no networking or timing itself | MIT OR Apache-2.0 |
| `cc` 1.11.2 (build only, here before) | compiles `native/core.cpp` | MIT OR Apache-2.0 |

`str0m`'s default encryption (`aws-lc-rs`, a large C library) and its example web server are switched off. The
`wincrypto` feature uses the encryption built into Windows instead, so nothing in C is built for it.

The engine's own web server (the viewer page, the "hello" and the settings) is written by hand on Rust's standard
library: no crate. Stopping on Ctrl+C is one Windows call declared in `src/serve.rs`: no crate.

The stream settings (2026-11-20) added no crate either. The small JSON a viewer sends is read by a few lines in
`src/settings.rs`. Shrinking the picture is Windows' own video processor (Direct3D 11), and looking for a running
League match is Windows' own list of programs (Toolhelp): both are called from `native/core.cpp`, like the rest.
The viewer page's sharpening shader is written for this page (`web/viewer.html`); nothing is copied in.

CONTROL (2026-11-20) added no crate and no driver. A viewer's mouse and keys are put into Windows with Windows'
own `SendInput`; the cut-off key is Windows' own `RegisterHotKey`; the strip across the PC's screen is one ordinary
window (`native/control.cpp`, which links Windows' `gdi32` for its one line of text). The messages travel on WebRTC
data channels, which `str0m` already had (`sctp-proto`, listed below, is now used). The table of keys in
`src/control.rs` was typed out from the published UI Events `code` names and PS/2 set 1 scan codes.

The efficiency round (2026-11-20) added no crate either. `--lan` lists this PC's own addresses with Windows' own
`GetAdaptersAddresses` (`native/lan.cpp`, which links Windows' `iphlpapi`); drawing FAST in the viewer page uses
the browser's own `MediaStreamTrackProcessor` and WebGL2, with shaders written for this page.

## Brought in by str0m (and by cc), built on this PC
All of these came with `str0m` on 2026-11-20 except `find-msvc-tools` and `shlex`, which `cc` already brought.

| Crate | Licence |
| --- | --- |
| arrayvec 0.7.8 | MIT OR Apache-2.0 |
| base64ct 1.8.3 | Apache-2.0 OR MIT |
| bytes 1.12.2 | MIT |
| cfg-if 1.0.5 | MIT OR Apache-2.0 |
| chacha20 0.10.2 | MIT OR Apache-2.0 |
| combine 4.6.9 | MIT |
| cpufeatures 0.3.1 | MIT OR Apache-2.0 |
| crc 3.4.0 | MIT OR Apache-2.0 |
| crc-catalog 2.5.0 | MIT OR Apache-2.0 |
| deranged 0.5.9 | MIT OR Apache-2.0 |
| dimpl 0.9.0 (the DTLS handshake) | MIT OR Apache-2.0 |
| fastrand 2.5.0 | Apache-2.0 OR MIT |
| find-msvc-tools 0.1.15 (build only) | MIT OR Apache-2.0 |
| getrandom 0.3.4 and 0.4.3 | MIT OR Apache-2.0 |
| is 0.12.0 (ICE: how the two ends find each other) | MIT OR Apache-2.0 |
| log 0.4.35 | MIT OR Apache-2.0 |
| memchr 2.8.3 | Unlicense OR MIT |
| nom 8.0.0 | MIT |
| num-conv 0.2.2 | MIT OR Apache-2.0 |
| once_cell 1.21.4 | MIT OR Apache-2.0 |
| pin-project-lite 0.2.18 | Apache-2.0 OR MIT |
| powerfmt 0.2.1 | MIT OR Apache-2.0 |
| ppv-lite86 0.2.21 | MIT OR Apache-2.0 |
| proc-macro2 1.0.107 (build only) | MIT OR Apache-2.0 |
| quote 1.0.47 (build only) | MIT OR Apache-2.0 |
| rand 0.9.5 and 0.10.4 | MIT OR Apache-2.0 |
| rand_chacha 0.9.0 | MIT OR Apache-2.0 |
| rand_core 0.9.5 and 0.10.1 | MIT OR Apache-2.0 |
| rustc-hash 2.1.3 | Apache-2.0 OR MIT |
| sctp-proto 0.10.8 (data channels: CONTROL travels on them) | MIT OR Apache-2.0 |
| serde 1.0.229, serde_core 1.0.229 | MIT OR Apache-2.0 |
| serde_derive 1.0.229 (build only) | MIT OR Apache-2.0 |
| shlex 2.0.1 (build only) | MIT OR Apache-2.0 |
| slab 0.4.12 | MIT |
| str0m-proto 0.8.0 | MIT OR Apache-2.0 |
| str0m-wincrypto 0.9.0 (encryption through Windows) | MIT OR Apache-2.0 |
| subtle 2.6.1 | BSD-3-Clause |
| syn 2.0.119 and 3.0.10 (build only) | MIT OR Apache-2.0 |
| thiserror 2.0.21 | MIT OR Apache-2.0 |
| thiserror-impl 2.0.21 (build only) | MIT OR Apache-2.0 |
| time 0.3.55, time-core 0.1.9 | MIT OR Apache-2.0 |
| tracing 0.1.44, tracing-core 0.1.36 | MIT |
| tracing-attributes 0.1.31 (build only) | MIT |
| unicode-ident 1.0.27 (build only) | (MIT OR Apache-2.0) AND Unicode-3.0 |
| windows 0.62.2, windows-collections 0.3.2, windows-core 0.62.2, windows-future 0.3.2, windows-link 0.2.1, windows-numerics 0.3.1, windows-result 0.4.1, windows-strings 0.5.1, windows-threading 0.2.1 (Microsoft's own bindings to Windows) | MIT OR Apache-2.0 |
| windows-implement 0.60.2, windows-interface 0.59.3 (build only) | MIT OR Apache-2.0 |
| zerocopy 0.8.63 | BSD-2-Clause OR Apache-2.0 OR MIT |

`Unicode-3.0` (on `unicode-ident`, a table of which characters may appear in names, used only while building) is
the Unicode Consortium's permissive licence: free use with the notice kept.

## Named in Cargo.lock but never built on Windows
Cargo writes down what other systems would need. None of this is compiled into the engine here.

| Crate | For | Licence |
| --- | --- | --- |
| libc 0.2.191 | Unix systems | MIT OR Apache-2.0 |
| r-efi 5.3.0 and 6.0.0 | UEFI firmware targets | MIT OR Apache-2.0 OR LGPL-2.1-or-later (a choice of three; MIT would be the one taken) |
| wasip2 1.0.4, wit-bindgen 0.57.1 | WebAssembly targets | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| time-macros 0.2.32 | an optional part of `time` that is off | MIT OR Apache-2.0 |
| zerocopy-derive 0.8.63 | an optional part of `zerocopy` that is off | BSD-2-Clause OR Apache-2.0 OR MIT |

## The check scripts
`bench/webrtc-check.cjs`, `bench/settings-check.cjs`, `bench/control-check.cjs` and `bench/still-check.cjs` use `playwright-core` (Apache-2.0) from the repository's
own `node_modules`: already there for the site's tools, nothing added, and not part of the engine.
