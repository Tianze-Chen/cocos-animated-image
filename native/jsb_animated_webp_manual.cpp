/****************************************************************************
 animated-image WebP JSB manual binding (native -> JS).

 Installs globalThis.__animatedImageWebP with the same five calls the wasm
 backend exports, in the same shapes, so runtime/webp/index.ts can hand either
 one to the decoder unchanged:

   open(Uint8Array)                  -> BigInt handle (0n on failure)
   getInfo(handle, Uint32Array(4))   -> boolean          [w, h, frameCount, loopCount]
   nextFrame(handle, Int32Array(1)?) -> Uint8Array | undefined  (durationMs written out)
   reset(handle)                     -> boolean
   close(handle)                     -> void

 Two shape decisions worth explaining:

 - Results come back through caller-allocated typed arrays rather than as plain
   objects, because that is what the C ABI does and the wasm side has no cheap
   way to build objects. Mirroring the awkward side keeps one call shape.

 - Handles cross as BigInt (se::Value::setUint64), not Number, so a 64-bit
   pointer is not truncated. That makes the TS-side handle type `number | bigint`
   — wasm pointers arrive as Numbers. Both 0 and 0n are falsy, so the failure
   test stays the same on both sides.

 Binary in-params go through se::Object::getTypedArrayData. Never std::string:
 it stops at embedded NULs and mangles non-UTF-8 bytes, which every WebP file
 contains.

 The binding is stateless — no handle registry. webpAnimGetInfo is a struct read,
 so nextFrame re-reads the canvas size instead of caching it, which also means
 there is nothing to leak or invalidate when a handle is closed and its address
 reused.
****************************************************************************/
#include "jsb_animated_webp_manual.h"

#include "cocos/bindings/jswrapper/SeApi.h"

#include "webp_anim.h"

#include <cstdint>

namespace {

// Accepts the BigInt this binding hands out, and a Number for good measure, but
// never asserts on undefined/null the way se::Value::toUint64 would — a stale
// handle from JS must fail gracefully, and webpAnim* all tolerate 0.
WebpAnimHandle argHandle(const se::Value& v) {
    if (v.isBigInt() || v.isNumber()) {
        return static_cast<WebpAnimHandle>(v.toUint64());
    }
    return 0;
}

// Returns the typed array's bytes, or null unless it is at least minBytes long.
uint8_t* argBytes(const se::Value& v, size_t minBytes, size_t* sizeOut) {
    if (!v.isObject()) return nullptr;
    uint8_t* ptr = nullptr;
    size_t len = 0;
    if (!v.toObject()->getTypedArrayData(&ptr, &len)) return nullptr;
    if (ptr == nullptr || len < minBytes) return nullptr;
    if (sizeOut != nullptr) *sizeOut = len;
    return ptr;
}

bool js_animated_webp_open(se::State& s) {
    const auto& args = s.args();
    size_t size = 0;
    uint8_t* bytes = args.empty() ? nullptr : argBytes(args[0], 1, &size);
    if (bytes == nullptr) {
        s.rval().setUint64(0);
        return true;
    }
    // webpAnimOpen copies the bytes, so the JS array is free to go away right
    // after this returns.
    s.rval().setUint64(static_cast<uint64_t>(webpAnimOpen(bytes, size)));
    return true;
}
SE_BIND_FUNC(js_animated_webp_open)

bool js_animated_webp_getInfo(se::State& s) {
    const auto& args = s.args();
    if (args.size() < 2) {
        s.rval().setBoolean(false);
        return true;
    }
    uint8_t* out = argBytes(args[1], WEBP_ANIM_INFO_CELLS * sizeof(uint32_t), nullptr);
    if (out == nullptr) {
        s.rval().setBoolean(false);
        return true;
    }
    s.rval().setBoolean(webpAnimGetInfo(argHandle(args[0]),
                                        reinterpret_cast<uint32_t*>(out)) != 0);
    return true;
}
SE_BIND_FUNC(js_animated_webp_getInfo)

bool js_animated_webp_nextFrame(se::State& s) {
    const auto& args = s.args();
    if (args.empty()) {
        s.rval().setUndefined();
        return true;
    }
    const WebpAnimHandle handle = argHandle(args[0]);

    // The frame buffer's length is the canvas size, which the C ABI does not
    // report alongside the pointer. Read it back per call; webpAnimOpen already
    // proved width * height * 4 cannot overflow.
    uint32_t info[WEBP_ANIM_INFO_CELLS] = {0};
    if (!webpAnimGetInfo(handle, info)) {
        s.rval().setUndefined();
        return true;
    }
    const size_t byteLength = static_cast<size_t>(info[0]) * info[1] * 4;

    // The duration out-param is optional, matching the C signature. A too-short
    // array is treated as absent rather than as an error, so a caller that does
    // not want the duration can pass anything falsy.
    int32_t duration = 0;
    uint8_t* durationOut = args.size() > 1 ? argBytes(args[1], sizeof(int32_t), nullptr) : nullptr;

    const uint8_t* rgba = webpAnimNextFrame(handle, &duration);
    if (rgba == nullptr) {
        // Exhausted or failed: leave the out-param alone so a stale duration is
        // not mistaken for a real frame.
        s.rval().setUndefined();
        return true;
    }
    if (durationOut != nullptr) {
        *reinterpret_cast<int32_t*>(durationOut) = duration;
    }

    // createTypedArray copies, which is what the caller needs: the decoder
    // overwrites this canvas on the next pull, and the player keeps frames in a
    // long-lived cache.
    se::HandleObject frame(se::Object::createTypedArray(
        se::Object::TypedArrayType::UINT8, rgba, byteLength));
    s.rval().setObject(frame);
    return true;
}
SE_BIND_FUNC(js_animated_webp_nextFrame)

bool js_animated_webp_reset(se::State& s) {
    const auto& args = s.args();
    s.rval().setBoolean(!args.empty() && webpAnimReset(argHandle(args[0])) != 0);
    return true;
}
SE_BIND_FUNC(js_animated_webp_reset)

bool js_animated_webp_close(se::State& s) {
    const auto& args = s.args();
    if (!args.empty()) webpAnimClose(argHandle(args[0]));
    return true;
}
SE_BIND_FUNC(js_animated_webp_close)

}  // namespace

bool register_all_animated_webp_manual(se::Object* obj) {
    se::Value nsVal;
    if (!obj->getProperty("__animatedImageWebP", &nsVal)) {
        se::HandleObject jsobj(se::Object::createPlainObject());
        nsVal.setObject(jsobj);
        obj->setProperty("__animatedImageWebP", nsVal);
    }
    se::Object* ns = nsVal.toObject();

    ns->defineFunction("open", _SE(js_animated_webp_open));
    ns->defineFunction("getInfo", _SE(js_animated_webp_getInfo));
    ns->defineFunction("nextFrame", _SE(js_animated_webp_nextFrame));
    ns->defineFunction("reset", _SE(js_animated_webp_reset));
    ns->defineFunction("close", _SE(js_animated_webp_close));

    se::ScriptEngine::getInstance()->clearException();
    return true;
}
