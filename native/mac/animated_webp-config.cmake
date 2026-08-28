# macOS — animated-webp native plugin (find_package entry).
# The search path tries mac/${CMAKE_SYSTEM_PROCESSOR} first and falls back to
# this directory, so arm64 and x86_64 share this one source build.
include("${CMAKE_CURRENT_LIST_DIR}/../animated_webp.cmake")
