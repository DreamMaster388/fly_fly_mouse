'use strict';

/**
 * Acceptance suite for the Plants vs Zombies ash death on explosion kills.
 *
 * E1 the normal zombie declares a special explosion death and every charred
 *    texture is loaded; the reanim data is a 43-frame, 15 fps crumble.
 * E2 a lethal explosion hit replaces the walking art with the charred crumble
 *    (no flying head), advances it, then fades and removes the zombie.
 * E3 a normal-damage kill still uses the regular death animation and head.
 * E4 a non-lethal explosion hit leaves the zombie walking normally.
 * E5 a real bomb landing on a zombie chains into the charred explosion death.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness.js');

const PORT = Number(process.env.ACCEPTANCE_EXPLOSION_PORT || 5206);
const URL = `http://127.0.0.1:${PORT}/`;

async function openWorld(browser) {
  const { page } = await H.openGameWithStart(browser, URL);
  await H.clearZombies(page, { pause: false });
  return page;
}

async function spawnZombie(page, x, y, maxHp) {
  return H.spawnTestZombie(page, x, y, { maxHp });
}

function readZombie(page, index) {
  return page.evaluate((i) => {
    const zombie = (window.__testZombies || [])[i];
    if (!zombie) return null;
    const charred = zombie.charredArt;
    return {
      exists: true,
      dead: zombie.dead,
      destroyed: zombie.destroyed,
      hp: zombie.hp,
      lastDamageType: zombie.lastDamageType,
      hasArt: !!zombie.art,
      artAnimation: zombie.art ? zombie.art.animationName : null,
      hasHead: !!zombie.headSprite,
      charred: charred
        ? {
            active: charred.container.active,
            frame: charred.frame,
            alpha: charred.container.alpha,
            scaleX: charred.container.scaleX,
            scaleY: charred.container.scaleY,
            textures: [...new Set(charred.sprites.filter((s) => s.visible).map((s) => s.texture.key))],
          }
        : null,
    };
  }, index);
}

describe('explosion death acceptance', () => {
  let server = null;
  let browser = null;

  before(async () => {
    server = await H.startDevServer(PORT);
    browser = await H.launchBrowser();
  });

  after(async () => {
    if (browser) await browser.close().catch(() => {});
    if (server) await server.close().catch(() => {});
  });

  test('E1 the normal zombie declares the charred death and all parts load', async () => {
    const page = await openWorld(browser);
    try {
      const data = await page.evaluate(async () => {
        const config = await import('/src/config.js');
        const reanim = await import('/src/zombieCharredData.js');
        const assets = await import('/src/zombieCharredAssets.js');
        const scene = window.game.scene.getScene('world');
        return {
          specialDeaths: { ...config.ZOMBIES.normal.specialDeaths },
          data: {
            sourceFrames: reanim.CHARRED_ZOMBIE_REANIM.sourceFrames,
            fps: reanim.CHARRED_ZOMBIE_REANIM.fps,
            frames: reanim.CHARRED_ZOMBIE_REANIM.frames.length,
            anchor: [...reanim.CHARRED_ZOMBIE_REANIM.anchor],
            firstFrame: reanim.CHARRED_ZOMBIE_REANIM.frames[0].map((entry) => entry[0]),
            lastFrame: reanim.CHARRED_ZOMBIE_REANIM.frames[
              reanim.CHARRED_ZOMBIE_REANIM.frames.length - 1
            ].map((entry) => entry[0]),
          },
          assets: assets.ZOMBIE_CHARRED_ASSETS.map((asset) => asset.key),
          loaded: assets.ZOMBIE_CHARRED_ASSETS.every((asset) =>
            scene.textures.exists(asset.key),
          ),
        };
      });

      assert.deepEqual(data.specialDeaths, { explosion: 'charred' });
      assert.deepEqual(data.data, {
        sourceFrames: 43,
        fps: 15,
        frames: 43,
        anchor: [50, 73],
        firstFrame: ['zombie-charred-1', 'zombie-charred-head', 'zombie-part-hair'],
        lastFrame: [
          'zombie-charred-pile2',
          'zombie-charred-pile2',
          'zombie-charred-pile2',
          'zombie-charred-pile1',
          'zombie-charred-pile1',
          'zombie-charred-head',
          'zombie-part-hair',
        ],
      });
      assert.equal(data.assets.length, 16);
      assert.equal(data.loaded, true, 'every charred texture must be preloaded');
    } finally {
      await H.disposePage(page);
    }
  });

  test('E2 an explosion kill plays the charred crumble instead of the normal death', async () => {
    const page = await openWorld(browser);
    try {
      const index = await spawnZombie(page, 400, 400, 10);
      await page.evaluate((i) => {
        const zombie = window.__testZombies[i];
        zombie.takeDamage(zombie.maxHp, 'explosion');
      }, index);

      const start = await readZombie(page, index);
      assert.equal(start.dead, true);
      assert.equal(start.hasArt, false, 'the walking art must be replaced immediately');
      assert.equal(start.hasHead, false, 'an explosion kill must not spawn the flying head');
      assert.ok(start.charred, 'the charred art must exist');
      assert.equal(start.charred.active, true);
      assert.ok(
        start.charred.textures.some((key) => key.startsWith('zombie-charred-')),
        `the charred art must use charred textures, got ${start.charred.textures.join(',')}`,
      );
      assert.equal(start.charred.scaleY, 110 / 128);
      assert.ok(start.charred.frame <= 2, `the crumble starts at frame 0, got ${start.charred.frame}`);

      await page.waitForTimeout(900);
      const mid = await readZombie(page, index);
      assert.ok(mid.charred, 'the charred art must still be playing');
      assert.ok(
        mid.charred.frame > start.charred.frame + 5,
        `the crumble must advance at 15 fps, frame ${start.charred.frame} -> ${mid.charred.frame}`,
      );

      await page.waitForFunction(
        (i) => {
          const zombie = (window.__testZombies || [])[i];
          return !!zombie && zombie.destroyed && !zombie.charredArt;
        },
        index,
        { timeout: 6000, polling: 50 },
      );
      const end = await readZombie(page, index);
      assert.equal(end.destroyed, true);
      assert.equal(end.charred, null);
    } finally {
      await H.disposePage(page);
    }
  });

  test('E3 a normal kill still uses the regular death animation and head', async () => {
    const page = await openWorld(browser);
    try {
      const index = await spawnZombie(page, 400, 400, 10);
      await page.evaluate((i) => {
        const zombie = window.__testZombies[i];
        zombie.takeDamage(zombie.maxHp, 'normal');
      }, index);
      await H.frames(page, 2);

      const state = await readZombie(page, index);
      assert.equal(state.dead, true);
      assert.equal(state.lastDamageType, 'normal');
      assert.equal(state.charred, null, 'normal damage must not use the charred death');
      assert.equal(state.hasArt, true);
      assert.ok(['death', 'death2'].includes(state.artAnimation));
      assert.equal(state.hasHead, true, 'normal deaths still launch the flying head');
    } finally {
      await H.disposePage(page);
    }
  });

  test('E4 a non-lethal explosion hit leaves the zombie alive and walking', async () => {
    const page = await openWorld(browser);
    try {
      const index = await spawnZombie(page, 400, 400, 30);
      await page.evaluate((i) => {
        window.__testZombies[i].takeDamage(10, 'explosion');
      }, index);
      await H.frames(page, 2);

      const state = await readZombie(page, index);
      assert.equal(state.dead, false);
      assert.equal(state.hp, 20);
      assert.equal(state.lastDamageType, 'explosion');
      assert.equal(state.charred, null);
      assert.equal(state.hasArt, true);
      assert.ok(['walk', 'walk2'].includes(state.artAnimation));
    } finally {
      await H.disposePage(page);
    }
  });

  test('E5 a real bomb landing on a zombie chains into the charred death', async () => {
    const page = await openWorld(browser);
    try {
      await H.removeAllDarts(page);
      await spawnZombie(page, 400, 400, 10);
      await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        scene.addGold(1000);
        const result = scene.purchaseItem('bomb');
        if (!result.ok) throw new Error(`bomb purchase failed: ${result.reason}`);
        const zombie = window.__testZombies[0];
        const dx = zombie.body.center.x - zombie.gameObject.x;
        const dy = zombie.body.center.y - zombie.gameObject.y;
        zombie.body.reset(scene.player.body.center.x + 180 - dx, scene.player.body.center.y - dy);
        scene.weaponInstances.get('bomb').nextThrowAt = scene.time.now;
      });

      await page.waitForFunction(
        () => {
          const zombie = (window.__testZombies || [])[0];
          return !!zombie && zombie.dead && !!zombie.charredArt;
        },
        null,
        { timeout: 5000, polling: 20 },
      );

      const state = await readZombie(page, 0);
      assert.equal(state.dead, true);
      assert.equal(state.lastDamageType, 'explosion');
      assert.equal(state.hasHead, false);
      assert.equal(state.hasArt, false);
      assert.ok(state.charred, 'the bomb kill must spawn the charred art');
      assert.ok(
        state.charred.textures.includes('zombie-charred-1') ||
          state.charred.textures.some((key) => key.startsWith('zombie-charred-')),
      );
    } finally {
      await H.disposePage(page);
    }
  });
});
