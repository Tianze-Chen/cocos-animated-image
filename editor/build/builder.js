'use strict';

/**
 * Build contribution for the animated-image extension.
 *
 * Registers the build hooks in ./hooks.js for every platform. Their one job is
 * placing the prebuilt animated-webp.wasm into the build output's cocos-js/,
 * which is where the engine's pal/wasm looks for it: the web build fetches it
 * relative to import.meta.url, and mini-games resolve `cocos-js/<name>` and hand
 * the path to CCWebAssembly.instantiate.
 */

exports.configs = {
    '*': {
        hooks: './hooks',
    },
};
