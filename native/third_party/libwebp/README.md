# libwebp (vendored)

Upstream: https://chromium.googlesource.com/webm/libwebp
Version: **1.6.0**
License: BSD 3-Clause — see `COPYING` / `PATENTS` / `AUTHORS`.

This is a **decoder-only subset**, trimmed to exactly what the two
`animated-image` WebP backends compile:

| Directory | Contents | Used by |
|---|---|---|
| `src/webp/` | public headers (`decode.h`, `demux.h`, `mux*.h`, `types.h`, `format_constants.h`, `encode.h`) | both |
| `src/dec/` | VP8 / VP8L / alpha decoders (complete) | wasm only |
| `src/dsp/` | `COMMON_SOURCES` from `src/dsp/Makefile.am` — scalar only, **no SIMD variants, no `ENC_SOURCES`** | wasm only |
| `src/utils/` | `COMMON_SOURCES` from `src/utils/Makefile.am` (the `libwebputilsdecode` set) | wasm: all; native: `utils.c` only |
| `src/demux/` | `demux.c`, `anim_decode.c` | both |

Deliberately **absent**: `src/enc/`, `src/mux/`, `sharpyuv/`, every SIMD
translation unit, and every `*_enc*` file. Nothing here references them
(`src/utils/palette.c` includes `src/webp/encode.h` for a struct, which is why
that one header is kept).

`HAVE_CONFIG_H` is never defined, so no `src/webp/config.h` is needed — every
`#include "src/webp/config.h"` in the tree sits behind `#ifdef HAVE_CONFIG_H`.

## Why the native backend only compiles three of these files

The engine already links a platform libwebp (`native/external/<platform>/libwebp.a`,
CMake target `webp`, gated by `USE_WEBP` which defaults to `ON`) and
`native/cocos/platform/Image.cpp` already calls `WebPGetFeatures` / `WebPDecode`
through it. But that prebuilt library is **decode-only on Android and OHOS** —
`include/webp/` there has just `decode.h` / `encode.h` / `types.h`, no `demux.h`.
Only win64 and openharmony ship the demux headers. So animated WebP needs the
demuxer supplied by the plugin, while still-frame decoding rides the engine's
library: the native target compiles `demux/demux.c`, `demux/anim_decode.c` and
`utils/utils.c` only.

Those three translation units are compiled with `-include ai_webp_prefix.h`
(see `native/webp-core/`), which renames every symbol they define to an `ai_*`
name. Without it, win64 and openharmony — whose libwebp *does* contain demux —
would end up with two definitions of `WebPAnimDecoderGetNext` and the linker
would silently pick one; a static-library symbol clash does not error out, it
just picks a winner.

## ABI compatibility with the engine's prebuilt library

The native backend compiles against the headers **in this directory** (1.6.0,
`WEBP_DECODER_ABI_VERSION 0x0210`) but links against the engine's older library
(`0x0208` on Android, `0x0209` on win64/openharmony). That is safe and checked:

* `WEBP_ABI_IS_INCOMPATIBLE` compares the **major** byte only
  (`src/webp/types.h`: `((a) >> 8) != ((b) >> 8)`) — major is 2 on both sides,
  so libwebp's own runtime version guard passes.
* `WebPBitstreamFeatures`, `WebPDecoderConfig`, `WebPDecBuffer` are
  byte-identical between 1.6.0 and the engine's headers (diffed field by field;
  only comments and `WEBP_NODISCARD` / `WEBP_COUNTED_BY` annotations changed,
  and the trailing `pad[4]` / `pad[5]` are unchanged).

Using these headers rather than the engine's per-platform ones also means the
native build does not depend on `include/webp/` existing for a given platform,
and both backends see the exact same declarations.

## Updating

Re-copy the same file list from a clean upstream checkout, then re-run the
frame-hash parity check (native backend vs wasm backend must stay byte-identical)
and re-check the struct diff above before bumping the version recorded here.
