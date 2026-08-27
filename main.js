'use strict';

// This extension is mount-only: the whole feature set lives in ./runtime and is
// delivered to the game through contributions.asset-db.mount. The main process
// entry exists so that load/unload shows up in <project>/temp/logs/project.log.

exports.load = function () {
    console.log('[animated-image] extension loaded');
};

exports.unload = function () {
    console.log('[animated-image] extension unloaded');
};
