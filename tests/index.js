'use strict';

/**
 * Entry point for `node --test tests` (the `npm test` script).
 *
 * Node 24 treats positional arguments of `--test` as file/glob patterns and no longer
 * expands a directory by itself: `node --test tests` would try to load the directory as
 * a module. Requiring the suites from this file keeps the prepared script working without
 * touching package.json. Plain auto-discovery (`node --test`) still finds every
 * `*.acceptance.test.js` file directly.
 *
 * Legacy suites (game-engine / weapon-orbit / zombie) are kept on disk for history but
 * retired by feature/add-weapon-damage; their assertions describe superseded specs.
 */

require('./base-flow.acceptance.test.js');
require('./weapon-damage.acceptance.test.js');
require('./difficulty.acceptance.test.js');
require('./loadout-population.acceptance.test.js');
require('./enemy-collision.acceptance.test.js');
require('./hud-rewards.acceptance.test.js');
require('./dev-console.acceptance.test.js');
require('./map.acceptance.test.js');
require('./ui-fade.acceptance.test.js');
require('./items-shop.acceptance.test.js');
require('./shop-catalog.acceptance.test.js');
require('./weapon-upgrade.acceptance.test.js');
require('./bomb-weapon.acceptance.test.js');
require('./explosion-death.acceptance.test.js');
