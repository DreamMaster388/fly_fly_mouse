'use strict';

/**
 * Independent acceptance suite for the 普通僵尸 art swap and the enemy/player
 * collision change.
 *
 * E1 the 20 reanim part textures load and the walk variant is picked per spawn
 *    (even variants play walk, odd variants play walk2).
 * E2 death hides the head parts in the body, pops the hair/head/jaw/mustache
 *    container from the neck and mirrors it with the body.
 * E2c the detached head only carries the mustache/tongue its own zombie wears.
 * E3 enemy bodies collide with each other instead of stacking.
 * E4 touching the player plays the attack clip and drains HP at the enemy's own
 *    contact damage rate without destroying the enemy; player max HP is 648.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness.js');

const PORT = Number(process.env.ACCEPTANCE_ENEMY_PORT || 5194);
const URL = `http://127.0.0.1:${PORT}/`;

async function openWorld(browser, { pause = true } = {}) {
  const { page } = await H.openGameWithStart(browser, URL);
  await H.clearZombies(page, { pause });
  return page;
}

describe('enemy art and collision acceptance', () => {
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

  test('E1 the 20 reanim parts load and even/odd walk variants pick walk/walk2', async () => {
    const page = await openWorld(browser);
    try {
      const data = await page.evaluate(async () => {
        const scene = window.game.scene.getScene('world');
        const { ZOMBIES, GAMEPLAY } = await import('/src/config.js');
        const { ZOMBIE_ARM_BONE_ASSET, ZOMBIE_PART_ASSETS } = await import(
          '/src/zombieArtAssets.js'
        );
        const { ZOMBIE_REANIM } = await import('/src/zombieReanimData.js');
        const { default: Zombie } = await import('/src/Zombie.js');
        const keys = [
          'zombie-walk-1',
          'zombie-walk-2',
          'zombie-walk-3',
          'zombie-attack',
          'zombie-die',
          'zombie-head',
        ];

        const selected = [];
        const originalRandom = Math.random;
        try {
          for (const value of [0, 0.34, 0.99]) {
            Math.random = () => value;
            const zombie = new Zombie(scene, 400, 400, 'normal', { walkVariant: undefined }, {});
            selected.push({
              walk: zombie.walkConfig.animationKey,
              anim: zombie.art.animationName,
              frame: zombie.art.frame,
              start: ZOMBIE_REANIM.animations[zombie.art.animationName].start,
              sprites: zombie.art.container.list.length,
              parts: Object.keys(zombie.art.sprites).length,
              mustache: zombie.hasMustache,
              tongue: zombie.hasTongue,
              mustacheVisible: zombie.art.sprites.mustache.visible,
              tongueVisible: zombie.art.sprites.tongue.visible,
            });
            zombie.destroy();
          }
        } finally {
          Math.random = originalRandom;
        }

        return {
          textures: keys.map((key) => scene.textures.exists(key)),
          boneTexture: scene.textures.exists(ZOMBIE_ARM_BONE_ASSET.key),
          partCount: ZOMBIE_PART_ASSETS.length,
          partTextures: ZOMBIE_PART_ASSETS.map((asset) => scene.textures.exists(asset.key)),
          selected,
          variants: ZOMBIES.normal.walk.variants.map((variant) => variant.animationKey),
          initialHp: GAMEPLAY.initialHp,
        };
      });

      assert.deepEqual(data.textures, [true, true, true, true, true, true]);
      assert.equal(data.boneTexture, true, 'the arm bone stump texture must load');
      assert.equal(data.partCount, 20, 'the zombie is assembled from 20 reanim parts');
      assert.ok(data.partTextures.every(Boolean), 'every part texture must load');
      assert.deepEqual(data.variants, ['normal-walk-1', 'normal-walk-2', 'normal-walk-3']);
      assert.deepEqual(data.selected, [
        {
          walk: 'normal-walk-1',
          anim: 'walk',
          frame: 44,
          start: 44,
          sprites: 21,
          parts: 20,
          mustache: true,
          tongue: true,
          mustacheVisible: true,
          tongueVisible: true,
        },
        {
          walk: 'normal-walk-2',
          anim: 'walk2',
          frame: 91,
          start: 91,
          sprites: 21,
          parts: 20,
          mustache: false,
          tongue: false,
          mustacheVisible: false,
          tongueVisible: false,
        },
        {
          walk: 'normal-walk-3',
          anim: 'walk',
          frame: 44,
          start: 44,
          sprites: 21,
          parts: 20,
          mustache: false,
          tongue: false,
          mustacheVisible: false,
          tongueVisible: false,
        },
      ]);
      assert.equal(data.initialHp, 648);
    } finally {
      await H.disposePage(page);
    }
  });

  test('E2 death hides the head parts, pops a four-part head from the neck and mirrors it', async () => {
    const page = await openWorld(browser);
    try {
      const result = await page.evaluate(async () => {
        const scene = window.game.scene.getScene('world');
        const { ZOMBIE_REANIM } = await import('/src/zombieReanimData.js');
        const { default: Zombie } = await import('/src/Zombie.js');
        const hiddenKeys = ['hair', 'head', 'jaw', 'mustache', 'tongue'];
        const make = (x, facingRight) => {
          const zombie = new Zombie(
            scene,
            x,
            1000,
            'normal',
            { walkVariant: 0, speed: 0, mustache: true, tongue: false },
            {},
          );
          zombie.setFacing(facingRight);
          // The death clip omits the head, so capture the pre-death pose first.
          const headPose = [...zombie.art.getPose('head')];
          zombie.takeDamage(zombie.hp);
          return { zombie, headPose };
        };

        const right = make(800, true);
        const left = make(1100, false);
        const read = ({ zombie, headPose }) => {
          const art = zombie.art;
          const head = zombie.headSprite;
          const [anchorX, anchorY] = ZOMBIE_REANIM.anchor;
          const headMeta = ZOMBIE_REANIM.parts.head;
          const headCenterX = headPose[0] + (headMeta.width * headPose[3]) / 2;
          const headCenterY = headPose[1] + (headMeta.height * headPose[4]) / 2;
          return {
            bodyAnim: art.animationName,
            bodyFrame: art.frame,
            bodyScaleX: art.container.scaleX,
            bodyScaleY: art.container.scaleY,
            bodyX: art.container.x,
            bodyY: art.container.y,
            bodyHidden: hiddenKeys.map((partKey) => art.sprites[partKey].visible),
            headParts: head.list.length,
            headScaleX: head.scaleX,
            headScaleY: head.scaleY,
            headAlpha: head.alpha,
            headActive: head.active,
            expectedX:
              art.container.x +
              (headCenterX - anchorX) * art.container.scaleX,
            expectedY:
              art.container.y +
              (headCenterY - anchorY) * art.container.scaleY,
            headX: head.x,
            headY: head.y,
            neck: { ...zombie.config.head.neckOffset },
          };
        };
        return { right: read(right), left: read(left) };
      });

      for (const [side, data] of Object.entries(result)) {
        assert.match(data.bodyAnim, /^death2?$/, `${side}: one of the two death clips`);
        assert.ok(
          [178, 217].includes(data.bodyFrame),
          `${side}: the death clip starts on its first frame (${data.bodyFrame})`,
        );
        assert.deepEqual(
          data.bodyHidden,
          [false, false, false, false, false],
          `${side}: the corpse hides every head part`,
        );
        assert.equal(data.headParts, 4, `${side}: hair, head, jaw and mustache fly together`);
        assert.equal(
          data.headScaleX,
          data.bodyScaleX,
          `${side}: the flying head reuses the body mirror`,
        );
        assert.equal(data.headScaleY, data.bodyScaleY, `${side}: same art scale`);
        assert.equal(data.headAlpha, 1);
        assert.equal(data.headActive, true);
        assert.equal(data.bodyScaleX < 0, side === 'right', `${side}: body mirror direction`);
        assert.ok(
          Math.abs(data.headX - data.expectedX) < 0.01,
          `${side}: head x starts on the neck (${data.headX} vs ${data.expectedX})`,
        );
        assert.ok(
          Math.abs(data.headY - data.expectedY) < 0.01,
          `${side}: head y starts on the neck (${data.headY} vs ${data.expectedY})`,
        );
        assert.deepEqual(data.neck, { x: 64, y: 39 });
      }
    } finally {
      await H.disposePage(page);
    }
  });

  test('E2c the flying head keeps only the decorations its own zombie wears', async () => {
    const page = await openWorld(browser);
    try {
      const data = await page.evaluate(async () => {
        const scene = window.game.scene.getScene('world');
        const { default: Zombie } = await import('/src/Zombie.js');
        const make = (x, stats) => {
          const zombie = new Zombie(
            scene,
            x,
            1000,
            'normal',
            { walkVariant: 0, speed: 0, ...stats },
            {},
          );
          zombie.takeDamage(zombie.hp);
          const keys = zombie.headSprite.list.map((child) => child.texture.key);
          zombie.destroy();
          return { mustache: zombie.hasMustache, tongue: zombie.hasTongue, keys };
        };
        return {
          plain: make(500, { mustache: false, tongue: false }),
          mustached: make(600, { mustache: true, tongue: false }),
          tongued: make(700, { mustache: false, tongue: true }),
          both: make(800, { mustache: true, tongue: true }),
        };
      });

      const HEAD = 'zombie-part-head';
      const JAW = 'zombie-part-jaw';
      const HAIR = 'zombie-part-hair';
      assert.deepEqual(data.plain.keys, [HEAD, JAW, HAIR], 'a plain head carries no facial decoration');
      assert.deepEqual(
        data.mustached.keys,
        [HEAD, JAW, 'zombie-part-mustache', HAIR],
        'a mustached zombie keeps its mustache',
      );
      assert.deepEqual(
        data.tongued.keys,
        [HEAD, JAW, 'zombie-part-tongue', HAIR],
        'a tongued zombie keeps its tongue',
      );
      assert.deepEqual(
        data.both.keys,
        [HEAD, JAW, 'zombie-part-tongue', 'zombie-part-mustache', HAIR],
        'both decorations follow the head',
      );
    } finally {
      await H.disposePage(page);
    }
  });

  test('E2b the torn outer arm leaves a bone stump that follows the animation', async () => {
    const page = await openWorld(browser);
    try {
      const data = await page.evaluate(async () => {
        const scene = window.game.scene.getScene('world');
        const { ZOMBIE_REANIM } = await import('/src/zombieReanimData.js');
        const { default: Zombie } = await import('/src/Zombie.js');
        const [anchorX, anchorY] = ZOMBIE_REANIM.anchor;
        const zombie = new Zombie(
          scene,
          500,
          1000,
          'normal',
          { walkVariant: 0, speed: 0, mustache: false, tongue: false },
          {},
        );

        const before = {
          armLost: zombie.armLost,
          boneVisible: zombie.art.boneSprite.visible,
          mustacheVisible: zombie.art.sprites.mustache.visible,
          tongueVisible: zombie.art.sprites.tongue.visible,
        };

        zombie.takeDamage(zombie.maxHp / 2);

        const readBone = () => {
          const upper = zombie.art.getPose('outerarm_upper');
          return {
            boneVisible: zombie.art.boneSprite.visible,
            boneX: zombie.art.boneSprite.x,
            boneY: zombie.art.boneSprite.y,
            expectedX: upper[0] - anchorX,
            expectedY: upper[1] - anchorY + 12,
            boneScale: zombie.art.boneSprite.scaleX,
            upperScale: upper[3],
          };
        };

        const after = {
          hp: zombie.hp,
          armLost: zombie.armLost,
          arms: ['outerarm_upper', 'outerarm_lower', 'outerarm_hand'].map(
            (partKey) => zombie.art.sprites[partKey].visible,
          ),
          ...readBone(),
        };

        const firstFrame = zombie.art.frame;
        zombie.art.applyFrame(firstFrame + 1);
        const next = readBone();
        zombie.art.applyFrame(firstFrame);
        zombie.destroy();

        return { before, after, next, frameMoved: firstFrame + 1 };
      });

      assert.deepEqual(data.before, {
        armLost: false,
        boneVisible: false,
        mustacheVisible: false,
        tongueVisible: false,
      }, 'an intact zombie has no bone and no facial decoration');
      assert.equal(data.after.hp, 5);
      assert.equal(data.after.armLost, true);
      assert.deepEqual(data.after.arms, [false, false, false], 'the whole outer arm is gone');
      assert.equal(data.after.boneVisible, true, 'the shoulder keeps a bone stump');
      assert.ok(Math.abs(data.after.boneX - data.after.expectedX) < 0.01);
      assert.ok(Math.abs(data.after.boneY - data.after.expectedY) < 0.01);
      assert.ok(
        Math.abs(data.after.boneScale - data.after.upperScale * 1.2) < 0.001,
        'the stump keeps the shoulder rotation and is scaled to stay readable',
      );
      assert.ok(Math.abs(data.next.boneX - data.next.expectedX) < 0.01);
      assert.ok(Math.abs(data.next.boneY - data.next.expectedY) < 0.01);
      assert.notEqual(
        data.next.boneY,
        data.after.boneY,
        'the stump follows the walk animation',
      );
    } finally {
      await H.disposePage(page);
    }
  });

  test('E3 two enemies spawned on the same spot separate instead of stacking', async () => {
    const page = await openWorld(browser, { pause: false });
    try {
      const x = 1400;
      const y = 1400;
      const first = await H.spawnTestZombie(page, x, y, { maxHp: 10 });
      const second = await H.spawnTestZombie(page, x, y, { maxHp: 10 });
      await page.waitForTimeout(700);

      const pair = await page.evaluate(
        ([a, b]) => {
          const za = window.__testZombies[a];
          const zb = window.__testZombies[b];
          return {
            distance: Math.hypot(
              za.body.center.x - zb.body.center.x,
              za.body.center.y - zb.body.center.y,
            ),
            radii: za.body.halfWidth + zb.body.halfWidth,
            alive: za.gameObject.active && zb.gameObject.active,
          };
        },
        [first, second],
      );

      assert.equal(pair.alive, true);
      assert.ok(
        pair.distance >= pair.radii - 0.5,
        `bodies must not overlap (${pair.distance} vs ${pair.radii})`,
      );
    } finally {
      await H.disposePage(page);
    }
  });

  test('E4 touching the player attacks at the enemy rate and never consumes the enemy', async () => {
    const page = await openWorld(browser, { pause: false });
    try {
      await H.removeAllDarts(page);
      const index = await H.spawnTestZombie(page, 400, 400, { maxHp: 10 });
      await page.evaluate((i) => {
        const scene = window.game.scene.getScene('world');
        const zombie = window.__testZombies[i];
        zombie.body.reset(scene.player.body.center.x, scene.player.body.center.y);
      }, index);

      await page.waitForFunction(
        () => window.game.scene.getScene('world').hp <= 638,
        null,
        { timeout: 5000, polling: 30 },
      );
      const state = await H.readGameState(page);
      const zombie = await H.readTestZombie(page, index);
      assert.equal(state.maxHp, 648);
      assert.equal(state.hp, 638);
      assert.equal(state.hud.hp, '638 / 648');
      assert.equal(zombie.attacking, true);
      assert.equal(zombie.anim, 'eat');
      assert.equal(zombie.dead, false);
      assert.equal(zombie.active, true);
      assert.ok(state.population.used >= 1);

      await page.evaluate((i) => {
        const scene = window.game.scene.getScene('world');
        window.__testZombies[i].body.reset(
          scene.player.body.center.x + 500,
          scene.player.body.center.y,
        );
      }, index);
      await H.frames(page, 3);
      const away = await H.readTestZombie(page, index);
      assert.equal(away.attacking, false, 'the attack stops when the player leaves');
    } finally {
      await H.disposePage(page);
    }
  });
});
