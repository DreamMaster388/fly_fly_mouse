'use strict';

/**
 * Entry point for `node --test tests` (the `npm test` script).
 *
 * Node 24 treats positional arguments of `--test` as file/glob patterns and no longer
 * expands a directory by itself: `node --test tests` would try to load the directory as
 * a module. Requiring the suite from this file keeps the prepared script working without
 * touching package.json. Plain auto-discovery (`node --test`) still finds
 * acceptance.test.js directly.
 */

// Legacy suites (game-engine / weapon-orbit / zombie) are retired by
// feature/add-weapon-damage; the independent suite is added by /sdlc-test.
