// See webp_anim.h for the contract. Both backends compile this file verbatim;
// the only difference is that the native build also forces
// `-include ai_webp_prefix.h`, which redirects the libwebp demux symbols this
// file calls to the plugin's own `ai_*` copies.

#include "webp_anim.h"

#include <stdlib.h>
#include <string.h>

#include "src/webp/decode.h"
#include "src/webp/demux.h"

#define WEBP_ANIM_MAGIC 0x57414E49u  // 'WANI'

typedef struct WebpAnim {
  uint32_t magic;
  uint8_t* bytes;  // owned copy of the input; the demuxer points into it
  WebPAnimDecoder* decoder;
  uint32_t width;
  uint32_t height;
  uint32_t frameCount;
  uint32_t loopCount;
  int prevTimestamp;
} WebpAnim;

static WebpAnim* fromHandle(WebpAnimHandle handle) {
  WebpAnim* const anim = (WebpAnim*)handle;
  if (anim == NULL || anim->magic != WEBP_ANIM_MAGIC) return NULL;
  return anim;
}

WebpAnimHandle webpAnimOpen(const uint8_t* data, size_t size) {
  WebpAnim* anim;
  WebPData webpData;
  WebPAnimDecoderOptions options;
  WebPAnimInfo info;
  size_t pixelCount;

  if (data == NULL || size == 0) return 0;

  anim = (WebpAnim*)calloc(1, sizeof(*anim));
  if (anim == NULL) return 0;

  anim->bytes = (uint8_t*)malloc(size);
  if (anim->bytes == NULL) {
    free(anim);
    return 0;
  }
  memcpy(anim->bytes, data, size);

  webpData.bytes = anim->bytes;
  webpData.size = size;

  if (!WebPAnimDecoderOptionsInit(&options)) {
    free(anim->bytes);
    free(anim);
    return 0;
  }
  // MODE_RGBA matches Texture2D.PixelFormat.RGBA8888, so the bytes reach
  // uploadData() untouched. Threads are off: the wasm build is single-threaded
  // and the native decode happens on whichever thread the JS call came in on.
  options.color_mode = MODE_RGBA;
  options.use_threads = 0;

  anim->decoder = WebPAnimDecoderNew(&webpData, &options);
  if (anim->decoder == NULL) {
    free(anim->bytes);
    free(anim);
    return 0;
  }

  if (!WebPAnimDecoderGetInfo(anim->decoder, &info) || info.canvas_width == 0 ||
      info.canvas_height == 0 || info.frame_count == 0) {
    WebPAnimDecoderDelete(anim->decoder);
    free(anim->bytes);
    free(anim);
    return 0;
  }

  // Guard the canvas byte count against overflow before anyone allocates from
  // it. size_t is 32-bit under wasm, and 16383 * 16383 * 4 is already 1.07e9.
  pixelCount = (size_t)info.canvas_width * info.canvas_height;
  if (pixelCount / info.canvas_width != info.canvas_height ||
      pixelCount > SIZE_MAX / 4) {
    WebPAnimDecoderDelete(anim->decoder);
    free(anim->bytes);
    free(anim);
    return 0;
  }

  anim->magic = WEBP_ANIM_MAGIC;
  anim->width = info.canvas_width;
  anim->height = info.canvas_height;
  anim->frameCount = info.frame_count;
  anim->loopCount = info.loop_count;
  anim->prevTimestamp = 0;
  return (WebpAnimHandle)anim;
}

int webpAnimGetInfo(WebpAnimHandle handle, uint32_t* out) {
  const WebpAnim* const anim = fromHandle(handle);
  if (anim == NULL || out == NULL) return 0;
  out[0] = anim->width;
  out[1] = anim->height;
  out[2] = anim->frameCount;
  out[3] = anim->loopCount;
  return 1;
}

const uint8_t* webpAnimNextFrame(WebpAnimHandle handle, int32_t* durationMs) {
  WebpAnim* const anim = fromHandle(handle);
  uint8_t* rgba = NULL;
  int timestamp = 0;

  if (anim == NULL) return NULL;
  if (!WebPAnimDecoderHasMoreFrames(anim->decoder)) return NULL;
  if (!WebPAnimDecoderGetNext(anim->decoder, &rgba, &timestamp)) return NULL;
  if (rgba == NULL) return NULL;

  if (durationMs != NULL) *durationMs = (int32_t)(timestamp - anim->prevTimestamp);
  anim->prevTimestamp = timestamp;
  return rgba;
}

int webpAnimReset(WebpAnimHandle handle) {
  WebpAnim* const anim = fromHandle(handle);
  if (anim == NULL) return 0;
  WebPAnimDecoderReset(anim->decoder);
  anim->prevTimestamp = 0;
  return 1;
}

void webpAnimClose(WebpAnimHandle handle) {
  WebpAnim* const anim = fromHandle(handle);
  if (anim == NULL) return;
  anim->magic = 0;
  if (anim->decoder != NULL) WebPAnimDecoderDelete(anim->decoder);
  free(anim->bytes);
  free(anim);
}
