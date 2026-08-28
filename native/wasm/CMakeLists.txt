# animated-image WebP wasm backend
#
# Builds libwebp's decoder + demuxer and native/webp-core/webp_anim.c into
# animated-webp.wasm — the non-native half of the plugin's WebP support (web,
# mini-games, editor, preview). Native platforms use the JSB plugin instead and
# never load this file.
#
# Usage — go through the wrapper, which finds a usable emsdk, regenerates the
# glue, and stages the artifacts in one step:
#
#   pwsh native/wasm/scripts/build-wasm.ps1
#   node native/wasm/scripts/verify-wasm.js
#
# The equivalent by hand is `emcmake cmake -S native/wasm -B native/wasm/build`
# then `cmake --build native/wasm/build` then
# `node native/wasm/scripts/gen-glue-file.js`, but the wrapper also handles the
# Device Guard / WDAC workarounds documented in its header and wipes a build tree
# configured against a different SDK (CMakeCache.txt pins the old emcc and
# reconfiguring does not repoint it).
#
# The build writes animated-webp.{js,wasm} into native/wasm/prebuilt/ and the
# glue script converts the ESM glue to the CJS copy under runtime/webp/. Ship
# the .js and the .wasm from the SAME build — the glue embeds the exported
# function table's expectations and a mismatched pair fails at instantiate time.
cmake_minimum_required(VERSION 3.16)
project(animated_webp_wasm C)

set(CMAKE_C_STANDARD 99)
set(CMAKE_C_STANDARD_REQUIRED ON)

set(WEBP_CORE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../webp-core")
set(LIBWEBP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../third_party/libwebp")

if(NOT EXISTS "${LIBWEBP_DIR}/src/demux/anim_decode.c")
    message(FATAL_ERROR
        "vendored libwebp source is missing at ${LIBWEBP_DIR} (should be in the repository)")
endif()

# Production default is web only; add node for the parity harness with
# -DEMSCRIPTEN_ENVIRONMENT=web,node.
set(EMSCRIPTEN_ENVIRONMENT "web" CACHE STRING "emscripten ENVIRONMENT setting")

# The decoder-only source set, mirroring libwebp's own libwebpdecoder target:
# dec/* plus the COMMON_SOURCES of dsp/ and utils/. No encoder, and no SIMD
# translation units — see the -mno-simd128 note below.
set(LIBWEBP_DEC_SRC
    "${LIBWEBP_DIR}/src/dec/alpha_dec.c"
    "${LIBWEBP_DIR}/src/dec/buffer_dec.c"
    "${LIBWEBP_DIR}/src/dec/frame_dec.c"
    "${LIBWEBP_DIR}/src/dec/idec_dec.c"
    "${LIBWEBP_DIR}/src/dec/io_dec.c"
    "${LIBWEBP_DIR}/src/dec/quant_dec.c"
    "${LIBWEBP_DIR}/src/dec/tree_dec.c"
    "${LIBWEBP_DIR}/src/dec/vp8_dec.c"
    "${LIBWEBP_DIR}/src/dec/vp8l_dec.c"
    "${LIBWEBP_DIR}/src/dec/webp_dec.c"
)
set(LIBWEBP_DSP_SRC
    "${LIBWEBP_DIR}/src/dsp/alpha_processing.c"
    "${LIBWEBP_DIR}/src/dsp/cpu.c"
    "${LIBWEBP_DIR}/src/dsp/dec.c"
    "${LIBWEBP_DIR}/src/dsp/dec_clip_tables.c"
    "${LIBWEBP_DIR}/src/dsp/filters.c"
    "${LIBWEBP_DIR}/src/dsp/lossless.c"
    "${LIBWEBP_DIR}/src/dsp/rescaler.c"
    "${LIBWEBP_DIR}/src/dsp/upsampling.c"
    "${LIBWEBP_DIR}/src/dsp/yuv.c"
)
set(LIBWEBP_UTILS_SRC
    "${LIBWEBP_DIR}/src/utils/bit_reader_utils.c"
    "${LIBWEBP_DIR}/src/utils/color_cache_utils.c"
    "${LIBWEBP_DIR}/src/utils/filters_utils.c"
    "${LIBWEBP_DIR}/src/utils/huffman_utils.c"
    "${LIBWEBP_DIR}/src/utils/palette.c"
    "${LIBWEBP_DIR}/src/utils/quant_levels_dec_utils.c"
    "${LIBWEBP_DIR}/src/utils/random_utils.c"
    "${LIBWEBP_DIR}/src/utils/rescaler_utils.c"
    "${LIBWEBP_DIR}/src/utils/thread_utils.c"
    "${LIBWEBP_DIR}/src/utils/utils.c"
)
set(LIBWEBP_DEMUX_SRC
    "${LIBWEBP_DIR}/src/demux/anim_decode.c"
    "${LIBWEBP_DIR}/src/demux/demux.c"
)

# NOTE: ai_webp_prefix.h / ai_webp_alloc.c are for the native target only. Here
# the whole decoder comes from the vendored source, so there is nothing to
# collide with and nothing to rename.
add_executable(animated-webp
    ${LIBWEBP_DEC_SRC}
    ${LIBWEBP_DSP_SRC}
    ${LIBWEBP_UTILS_SRC}
    ${LIBWEBP_DEMUX_SRC}
    "${WEBP_CORE_DIR}/webp_anim.c"
)

# libwebp's internal includes are all written "src/...", so the include root is
# the libwebp directory itself, not src/.
target_include_directories(animated-webp PRIVATE
    "${LIBWEBP_DIR}"
    "${WEBP_CORE_DIR}"
)

# WEBP_USE_THREAD is off: webpAnimOpen sets use_threads = 0 and pthreads in wasm
# would require a worker + SHARED_MEMORY, which mini-games do not offer.
#
# WEBP_REDUCE_CSP drops every output colorspace except RGBA/BGRA — the two
# anim_decode.c uses. WEBP_REDUCE_SIZE drops the decoder's scaling paths, whose
# only effect is that a config with use_scaling now returns
# VP8_STATUS_INVALID_PARAM; webp_anim.c never sets it.
target_compile_definitions(animated-webp PRIVATE
    WEBP_DISABLE_STATS
    WEBP_REDUCE_CSP
    WEBP_REDUCE_SIZE
)

# -Oz on both sides, independent of CMAKE_BUILD_TYPE: at link time it is what
# drives wasm-opt, and an unoptimized emcmake default build is several times
# larger.
target_compile_options(animated-webp PRIVATE "-Oz")

# WeChat's WXWebAssembly validator still expects the MVP call_indirect encoding.
# Recent Emscripten/LLVM versions enable reference types by default and can emit
# an overlong table index (0 encoded as 80 80 80 80 00), which WeChat rejects
# with "expected table index 0, found 0". Keep the binary on the
# legacy-compatible path and lower bulk-memory operations at link time. The same
# reasoning rules out -msimd128, which is why no SIMD source is compiled.
target_compile_options(animated-webp PRIVATE
    "-mno-reference-types"
    "-mno-bulk-memory"
)
target_link_options(animated-webp PRIVATE
    "-Oz"
    "SHELL:-mno-reference-types"
    "SHELL:-mno-bulk-memory"
    # Mini-game sandboxes disallow eval / new Function.
    "SHELL:-s DYNAMIC_EXECUTION=0"
    "SHELL:-s WASM=1"
    "SHELL:-s ALLOW_MEMORY_GROWTH=1"
    "SHELL:-s EXPORT_ES6=1"
    "SHELL:-s MODULARIZE=1"
    "SHELL:-s EXPORT_NAME=AnimatedWebP"
    "SHELL:-s FILESYSTEM=0"
    "SHELL:-s NO_EXIT_RUNTIME=1"
    "SHELL:-s ENVIRONMENT=${EMSCRIPTEN_ENVIRONMENT}"
    # The five-function C ABI is reached through cwrap, so no embind and no
    # EMBIND_AOT: nothing here needs a generated invoker.
    "SHELL:-s EXPORTED_RUNTIME_METHODS=['HEAPU8','HEAPU32','cwrap']"
    "SHELL:-s EXPORTED_FUNCTIONS=['_webpAnimOpen','_webpAnimGetInfo','_webpAnimNextFrame','_webpAnimReset','_webpAnimClose','_malloc','_free']"
)

set_target_properties(animated-webp PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}"
    OUTPUT_NAME "animated-webp"
    SUFFIX ".js"
)
