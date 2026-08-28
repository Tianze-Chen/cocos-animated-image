// Streaming animated-WebP decode core shared by both animated-image backends:
// the Emscripten build (native/wasm/) and the native JSB plugin (native/).
//
// The shape here is dictated by AnimatedImagePlayer, which decodes lazily —
// `decodeFrame(index)` on demand, caching frames as it goes. A one-shot
// "decode every frame into one buffer" entry point would allocate the whole
// animation up front (a 500x500 30-frame image is ~30MB), so the ABI is a
// handle plus a cursor instead.
//
// WebP frames carry blend/dispose dependencies on their predecessor, so frames
// must be pulled in order; `webpAnimReset` rewinds for a backwards seek.

#ifndef ANIMATED_IMAGE_WEBP_ANIM_H_
#define ANIMATED_IMAGE_WEBP_ANIM_H_

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Opaque decoder handle. 0 means "invalid" and is what every failing open
// returns; every other entry point tolerates it.
typedef uintptr_t WebpAnimHandle;

// Number of uint32_t cells webpAnimGetInfo writes.
#define WEBP_ANIM_INFO_CELLS 4

// Opens `data[0..size)` as an animated (or single-frame) WebP.
//
// The bytes are copied internally: libwebp's demuxer keeps a pointer into the
// buffer it was handed and requires it to outlive the decoder, which a JS-owned
// typed array or a scratch wasm allocation does not. Callers may release their
// buffer as soon as this returns.
//
// Returns 0 on any failure (bad input, not a WebP, zero-sized canvas, OOM).
WebpAnimHandle webpAnimOpen(const uint8_t* data, size_t size);

// Writes { width, height, frameCount, loopCount } into `out`, which must have
// room for WEBP_ANIM_INFO_CELLS cells. Returns 1 on success, 0 on failure.
//
// loopCount follows the WebP container: 0 means "loop forever".
int webpAnimGetInfo(WebpAnimHandle handle, uint32_t* out);

// Decodes the next frame and returns a pointer to the decoder's full-canvas
// RGBA8888 buffer (width * height * 4 bytes), already composited against the
// previous frame. NULL once the animation is exhausted or on error.
//
// The returned buffer belongs to the decoder and is overwritten by the next
// webpAnimNextFrame / webpAnimReset and freed by webpAnimClose, so callers copy
// out of it immediately.
//
// `durationMs`, if non-NULL, receives this frame's display duration in
// milliseconds (the container stores absolute timestamps; this is the delta).
const uint8_t* webpAnimNextFrame(WebpAnimHandle handle, int32_t* durationMs);

// Rewinds to the first frame. Returns 1 on success, 0 on failure.
int webpAnimReset(WebpAnimHandle handle);

// Releases the decoder and the copied input bytes. Safe on 0.
void webpAnimClose(WebpAnimHandle handle);

#ifdef __cplusplus
}  // extern "C"
#endif

#endif  // ANIMATED_IMAGE_WEBP_ANIM_H_
