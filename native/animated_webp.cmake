# animated-webp native plugin — shared source build logic.
#
# Each platform's animated_webp-config.cmake (android/ ios/ windows/ mac/)
# includes this file. The engine's plugin scan reads ../cc_plugin.json, writes
# find_package(animated_webp REQUIRED NAMES "animated_webp") into the generated
# Pre-AutoLoadPlugins.cmake, and that resolves to the platform config which lands
# here. cc_plugin_entry() then links this static library into plugin_registry so
# cc_load_all_plugins() reaches CC_PLUGIN_ENTRY in animated_webp_plugin.cpp.
#
# Verify the wiring by checking that the built project's
# native/engine/<platform>/Pre-AutoLoadPlugins.cmake mentions animated_webp. It
# is worth checking explicitly, because cc_plugin.json's own field validation
# never fires (plugins_parser.js:141 calls Object.hasOwnProperty with the object
# as the key, so it always returns true) and a malformed manifest is swallowed by
# an outer try/catch — the plugin is skipped while the build still succeeds.
#
# Only android / ios / windows / mac are listed in cc_plugin.json because
# plugins_parser.js:173 maps just those to a search-path suffix; linux and
# ohos/harmonyos fall into an else branch that only warns, leaving the search
# path empty so the REQUIRED find_package would fail.

if(TARGET animated_webp)
    return()
endif()

# COCOS_X_PATH is set by the app template to <engine>/native.
if(NOT COCOS_X_PATH)
    message(FATAL_ERROR "animated_webp plugin: COCOS_X_PATH (path to engine/native) is not set")
endif()

set(ANIMATED_WEBP_ROOT "${CMAKE_CURRENT_LIST_DIR}")
set(WEBP_CORE_DIR "${ANIMATED_WEBP_ROOT}/webp-core")
set(LIBWEBP_DIR "${ANIMATED_WEBP_ROOT}/third_party/libwebp")

if(NOT EXISTS "${LIBWEBP_DIR}/src/demux/anim_decode.c")
    message(FATAL_ERROR
        "vendored libwebp source is missing at ${LIBWEBP_DIR} (should be in the repository)")
endif()

# Only the demuxer is compiled from vendored source. Still-frame decoding
# (WebPDecode / WebPGetFeatures / WebPInitDecoderConfig) resolves to the libwebp
# the engine already links — Image.cpp:946-964 calls exactly those three, so the
# translation unit defining them is always pulled in.
#
# The demuxer has to be vendored because the prebuilt library is decode-only on
# some platforms: native/external/android and ohos ship only decode.h / encode.h
# / types.h, while win64 and openharmony also ship demux.h. Compiling our own
# copy on the platforms that already have one would put two definitions of e.g.
# WebPAnimDecoderGetNext into the link, which is NOT an error — the linker just
# picks one. ai_webp_prefix.h renames the whole vendored family to ai_* so that
# cannot happen, which is also why no per-platform branch is needed here.
set(ANIMATED_WEBP_C_SRC
    "${LIBWEBP_DIR}/src/demux/anim_decode.c"
    "${LIBWEBP_DIR}/src/demux/demux.c"
    "${WEBP_CORE_DIR}/webp_anim.c"
    "${WEBP_CORE_DIR}/ai_webp_alloc.c"
)

add_library(animated_webp STATIC
    "${ANIMATED_WEBP_ROOT}/animated_webp_plugin.cpp"
    "${ANIMATED_WEBP_ROOT}/jsb_animated_webp_manual.cpp"
    ${ANIMATED_WEBP_C_SRC}
)

# The prefix header must be forced onto every vendored C translation unit, ahead
# of any libwebp header, so declarations and definitions are renamed together.
# The C++ sources must NOT get it: they only call the webpAnim* entry points,
# which are deliberately not renamed.
if(MSVC)
    set(ANIMATED_WEBP_FORCE_INCLUDE "/FI\"${WEBP_CORE_DIR}/ai_webp_prefix.h\"")
else()
    set(ANIMATED_WEBP_FORCE_INCLUDE "-include ${WEBP_CORE_DIR}/ai_webp_prefix.h")
endif()
set_source_files_properties(${ANIMATED_WEBP_C_SRC} PROPERTIES
    COMPILE_FLAGS "${ANIMATED_WEBP_FORCE_INCLUDE}"
)

# libwebp's internal includes are written "src/...", so the include root is the
# libwebp directory itself rather than its src/. The vendored src/webp/*.h are
# used in preference to the engine's per-platform include/webp/ — those headers
# are not even present for every platform (this checkout has none for mac/ios),
# and WEBP_ABI_IS_INCOMPATIBLE only compares the major version byte
# (src/webp/types.h), which is 2 for both the prebuilt libraries (0x0208/0x0209)
# and the vendored 1.6.0 source (0x0210). The structs the two sides exchange
# (WebPDecBuffer, WebPBitstreamFeatures, WebPDecoderConfig) were diffed
# field-by-field and are identical.
target_include_directories(animated_webp PRIVATE
    "${LIBWEBP_DIR}"
    "${WEBP_CORE_DIR}"
    ${CC_EXTERNAL_INCLUDES}
    ${CC_EXTERNAL_PRIVATE_INCLUDES}
    "${COCOS_X_PATH}"        # resolves "cocos/bindings/..." and "cocos/plugins/..."
    "${COCOS_X_PATH}/cocos"  # resolves "plugins/bus/..." reached from Plugins.h
)

target_compile_features(animated_webp PUBLIC cxx_std_17)

# webpAnimOpen sets use_threads = 0, so libwebp's worker pool is never entered.
target_compile_definitions(animated_webp PRIVATE
    WEBP_DISABLE_STATS
)

# Pick up the selected script engine's usage requirements — V8 publishes its
# version-specific include directory here rather than via CC_EXTERNAL_INCLUDES.
if(se_libs_name)
    target_link_libraries(animated_webp PRIVATE ${se_libs_name})
endif()

# Belt and braces for the three still-frame symbols. They would also resolve at
# final link through cocos_engine, but naming the dependency keeps it from
# depending on link order. The target is declared IMPORTED GLOBAL in
# native/external/<platform>/CMakeLists.txt, so it is visible from this scope.
if(TARGET webp)
    target_link_libraries(animated_webp PRIVATE webp)
endif()

# CC_PLUGIN_STATIC is never defined by the engine; a static plugin must define it
# itself so CC_PLUGIN_ENTRY emits an undecorated extern "C"
# cc_load_plugin_animated_webp() instead of taking the DLL-export branch in
# cocos/plugins/Plugins.h.
target_compile_definitions(animated_webp PUBLIC
    CC_PLUGIN_STATIC
)
