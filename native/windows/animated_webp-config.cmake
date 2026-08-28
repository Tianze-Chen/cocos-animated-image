# Windows — animated-webp native plugin (find_package entry).
# The search path tries windows/x86_64 first and falls back to this directory,
# which is what we want: one source build for every architecture.
include("${CMAKE_CURRENT_LIST_DIR}/../animated_webp.cmake")
