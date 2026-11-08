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

require('./acceptance.test.js');
require('./weapon-orbit.acceptance.test.js');
require('./zombie.acceptance.test.js');
