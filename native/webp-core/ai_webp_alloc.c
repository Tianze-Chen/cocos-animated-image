// Native-target-only replacements for the three src/utils/utils.c allocation
// entry points that libwebp's demuxer needs. The wasm build compiles the real
// utils.c and must NOT compile this file.
//
// Vendoring all of utils.c for the native target would drag in WebPCopyPixels /
// WebPGetColorPalette and therefore palette.h + encode.h, none of which the
// demuxer touches. Depending on the engine's prebuilt libwebp to supply them
// instead is worse: they are libwebp-internal symbols, not public API, so
// nothing guarantees they stay exported.
//
// Semantics match utils.c: reject nmemb * size when it overflows size_t or
// exceeds libwebp's own allocation ceiling, and treat nmemb == 0 as valid (the
// multiply is then zero and malloc/calloc decides). The names are rewritten to
// ai_* by the forced-include ai_webp_prefix.h, same as the demuxer's callers.

#include <stdlib.h>

#include "src/utils/utils.h"

static int checkSizeArgumentsOverflow(uint64_t nmemb, size_t size) {
  const uint64_t totalSize = nmemb * size;
  if (nmemb == 0) return 1;
  if ((uint64_t)size > WEBP_MAX_ALLOCABLE_MEMORY / nmemb) return 0;
  if (totalSize != (uint64_t)(size_t)totalSize) return 0;
  return 1;
}

void* WebPSafeMalloc(uint64_t nmemb, size_t size) {
  if (!checkSizeArgumentsOverflow(nmemb, size)) return NULL;
  return malloc((size_t)(nmemb * size));
}

void* WebPSafeCalloc(uint64_t nmemb, size_t size) {
  if (!checkSizeArgumentsOverflow(nmemb, size)) return NULL;
  return calloc((size_t)nmemb, size);
}

void WebPSafeFree(void* const ptr) { free(ptr); }
