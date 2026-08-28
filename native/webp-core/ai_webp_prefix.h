// Forced-include prefix header for the NATIVE plugin target only
// (`-include ai_webp_prefix.h`; the wasm build must NOT use it).
//
// The native target compiles libwebp's demuxer from vendored source while
// linking still-frame decoding against the engine's prebuilt libwebp. On
// Android and OHOS that prebuilt library is decode-only, which is why the
// demuxer has to be vendored at all — but on win64 and openharmony it already
// contains the demuxer. Two definitions of `WebPAnimDecoderGetNext` in a static
// link is not a link error: the linker just picks one, silently, and which one
// it picks depends on link order. The symptom would be a WebP that decodes
// correctly on one platform and composites wrongly on another.
//
// So every symbol the vendored translation units define gets an `ai_` prefix
// here, before any libwebp header is parsed, so declarations and definitions
// are renamed together. Renaming the whole family also means no per-platform
// CMake branch is needed: the same source set builds everywhere.
//
// Deliberately NOT renamed — these resolve to the engine's libwebp:
//   WebPGetFeaturesInternal, WebPInitDecoderConfigInternal, WebPDecode
// (verified with `llvm-nm --undefined-only` on the two demux objects; that is
// the complete list of what they need from outside.)
//
// If you add a vendored .c to the native target, re-run
// `llvm-nm --defined-only` on its object and add every `T` symbol below.

#ifndef ANIMATED_IMAGE_AI_WEBP_PREFIX_H_
#define ANIMATED_IMAGE_AI_WEBP_PREFIX_H_

// src/demux/demux.c
#define WebPGetDemuxVersion ai_WebPGetDemuxVersion
#define WebPDemuxInternal ai_WebPDemuxInternal
#define WebPDemuxDelete ai_WebPDemuxDelete
#define WebPDemuxGetI ai_WebPDemuxGetI
#define WebPDemuxGetFrame ai_WebPDemuxGetFrame
#define WebPDemuxNextFrame ai_WebPDemuxNextFrame
#define WebPDemuxPrevFrame ai_WebPDemuxPrevFrame
#define WebPDemuxReleaseIterator ai_WebPDemuxReleaseIterator
#define WebPDemuxGetChunk ai_WebPDemuxGetChunk
#define WebPDemuxNextChunk ai_WebPDemuxNextChunk
#define WebPDemuxPrevChunk ai_WebPDemuxPrevChunk
#define WebPDemuxReleaseChunkIterator ai_WebPDemuxReleaseChunkIterator

// src/demux/anim_decode.c
#define WebPAnimDecoderOptionsInitInternal ai_WebPAnimDecoderOptionsInitInternal
#define WebPAnimDecoderNewInternal ai_WebPAnimDecoderNewInternal
#define WebPAnimDecoderGetInfo ai_WebPAnimDecoderGetInfo
#define WebPAnimDecoderGetNext ai_WebPAnimDecoderGetNext
#define WebPAnimDecoderHasMoreFrames ai_WebPAnimDecoderHasMoreFrames
#define WebPAnimDecoderReset ai_WebPAnimDecoderReset
#define WebPAnimDecoderGetDemuxer ai_WebPAnimDecoderGetDemuxer
#define WebPAnimDecoderDelete ai_WebPAnimDecoderDelete

// ai_webp_alloc.c — stand-ins for the three src/utils/utils.c entry points the
// demuxer needs, so the native target does not depend on libwebp's *internal*
// symbols happening to be exported from the engine's static library.
#define WebPSafeMalloc ai_WebPSafeMalloc
#define WebPSafeCalloc ai_WebPSafeCalloc
#define WebPSafeFree ai_WebPSafeFree

#endif  // ANIMATED_IMAGE_AI_WEBP_PREFIX_H_
