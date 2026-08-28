/****************************************************************************
 animated-image WebP native plugin entry point.

 CC_PLUGIN_ENTRY is the engine's official hook (cocos/plugins/Plugins.h): the
 generated plugin_registry_autogen.cpp calls cc_load_plugin_animated_webp(),
 which cc_load_all_plugins() reaches from BaseGame.cpp. Installing the extension
 and making an ordinary native build is enough — nothing in the project's own
 Game.cpp needs touching.

 The entry name must be spelled exactly like modules[].target in cc_plugin.json
 ("animated_webp"), not like the manifest's "name" field, because the autogen
 step builds the symbol from the target list.

 The entry function must NOT touch se::Object: it runs during load, before the
 script engine exists (se::ScriptEngine::getInstance() is still null at static
 init time). All it may do is queue the register callback, which runs later with
 a live engine.
****************************************************************************/
#include "cocos/bindings/jswrapper/SeApi.h"
#include "cocos/plugins/Plugins.h"

#include "jsb_animated_webp_manual.h"

namespace {

bool registerAnimatedWebPBinding(se::Object* globalObj) {
    return register_all_animated_webp_manual(globalObj);
}

void loadAnimatedWebPPlugin() {
    se::ScriptEngine::getInstance()->addRegisterCallback(registerAnimatedWebPBinding);
}

}  // namespace

CC_PLUGIN_ENTRY(animated_webp, loadAnimatedWebPPlugin)
