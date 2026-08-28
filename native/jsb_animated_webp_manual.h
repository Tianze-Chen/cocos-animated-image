#pragma once

namespace se {
class Object;
}

// Installs globalThis.__animatedImageWebP. Called from the register callback
// queued by animated_webp_plugin.cpp.
bool register_all_animated_webp_manual(se::Object* obj);
