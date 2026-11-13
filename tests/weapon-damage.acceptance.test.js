'use strict';

/**
 * Independent acceptance suite for feature/add-weapon-damage.
 * Requirements are taken from docs/sdlc/feature/add-weapon-damage/spec.md (R1-R14),
 * with loadout values pinned by the fixed-loadout change: 旋转飞镖 deals 2 damage,
 * starts empty, refills once per second and 普通僵尸 has a fixed 10 HP.
 * Enemy art is rebuilt from the 20 Plants-vs-Zombies reanim part images: walk,
 * eat, half-HP arm loss and a body-plus-flying-head death.
 *
 * Combat scenarios fill the orbit directly instead of waiting for refills.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers/harness.js');

const PORT = Number(process.env.ACCEPTANCE_WEAPON_PORT || 5191);
const URL = `http://127.0.0.1:${PORT}/`;

const packageJson = JSON.parse(
  fs.readFileSync(path.join(H.PROJECT_ROOT, 'package.json'), 'utf8'),
);

async function openWorld(browser, { collectNetwork = false, pause = true, darts = true } = {}) {
  const { page, errors } = await H.openGameWithStart(browser, URL, { collectNetwork });
  await H.clearZombies(page, { pause });
  if (darts) await H.fillDarts(page);
  return { page, errors };
}

const damageAll = (page, indices, amount) =>
  page.evaluate(
    ([list, dmg]) => {
      const results = [];
      for (const i of list) {
        const zombie = (window.__testZombies || [])[i];
        zombie.takeDamage(dmg);
        results.push({ hp: zombie.hp, dead: zombie.dead });
      }
      return results;
    },
    [indices, amount],
  );

describe('add-weapon-damage acceptance', () => {
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

  test('R1/R10 config drives weapons, zombies, animations and assets without new dependencies', async () => {
    const { page, errors } = await openWorld(browser, { collectNetwork: true, pause: true });
    try {
      const config = await page.evaluate(async () => {
        const mod = await import('/src/config.js');
        const { ZOMBIE_REANIM } = await import('/src/zombieReanimData.js');
        const { ZOMBIE_PART_ASSETS } = await import('/src/zombieArtAssets.js');
        const scene = window.game.scene.getScene('world');
        const textureSize = (key) => {
          const texture = scene.textures.get(key);
          const source = texture.getSourceImage();
          return {
            width: source.width,
            height: source.height,
            frames: texture.frameTotal - 1,
          };
        };
        return {
          weapons: mod.WEAPONS,
          zombies: mod.ZOMBIES,
          gameplay: mod.GAMEPLAY,
          textures: [
            'dart',
            'zombie-walk-1',
            'zombie-walk-2',
            'zombie-walk-3',
            'zombie-attack',
            'zombie-die',
            'zombie-head',
          ].map((key) => scene.textures.exists(key)),
          partCount: ZOMBIE_PART_ASSETS.length,
          partTextures: ZOMBIE_PART_ASSETS.map((asset) => scene.textures.exists(asset.key)),
          animations: ZOMBIE_REANIM.animations,
          sounds: ['zombie-hit', 'zombie-die', 'chomp'].map((key) =>
            scene.cache.audio.exists(key),
          ),
          dieSheet: textureSize('zombie-die'),
          headSheet: textureSize('zombie-head'),
        };
      });

      const dart = config.weapons.dart;
      assert.equal(dart.name, '旋转飞镖');
      assert.equal(dart.textureKey, 'dart');
      assert.equal(dart.damage, 2);
      assert.equal(dart.slotCount, 8);
      assert.equal(dart.initialCount, 0);
      assert.equal(dart.refillIntervalMs, 1000);
      assert.equal(dart.displayHeight, 27);
      assert.equal(dart.orbitRadius, 90);
      assert.equal(dart.orbitDegreesPerSecond, 90);
      assert.equal(dart.spinDegreesPerSecond, 360);
      assert.equal(dart.bodyRadiusRatio, 0.35);

      assert.equal(config.gameplay.initialHp, 648);
      assert.equal(config.gameplay.maxPopulation, 25);
      assert.equal(config.gameplay.initialLevel, 1);
      assert.equal(config.gameplay.maxLevel, 18);
      assert.deepEqual(config.gameplay.levelXp, [
        280, 340, 460, 640, 860, 1140, 1480, 1880, 2360,
        2920, 3560, 4280, 5080, 5960, 6920, 7960, 9080,
      ]);

      const zombie = config.zombies.normal;
      assert.equal(zombie.name, '普通僵尸');
      assert.equal(zombie.populationCost, 1);
      assert.equal(zombie.speed, 30);
      assert.equal(zombie.maxHp, 10);
      assert.deepEqual(zombie.reward, { gold: 21, xp: 60 }, 'normal zombie drops are fixed');
      assert.equal(zombie.spawnIntervalMs, 2000);
      assert.equal(zombie.spawnAttempts, 20);
      assert.equal(zombie.worldInset, 64);
      assert.equal(zombie.cameraMargin, 80);
      assert.equal(zombie.despawnDistance, 1600);
      assert.equal(zombie.displayHeight, 110);
      assert.equal(zombie.flashDurationMs, 120);
      assert.equal(zombie.flashTint, 0xff0000);
      assert.deepEqual(zombie.body, { radius: 33, offsetX: 72, offsetY: 78 });
      assert.deepEqual(zombie.contact, { damage: 10, intervalMs: 500, rangePadding: 8 });

      assert.equal(zombie.walk.repeat, -1);
      assert.equal(zombie.walk.variants.length, 3);
      assert.deepEqual(
        zombie.walk.variants.map((variant) => variant.textureKey),
        ['zombie-walk-1', 'zombie-walk-2', 'zombie-walk-3'],
      );
      assert.deepEqual(
        zombie.walk.variants.map((variant) => variant.frameCount),
        [22, 31, 18],
      );
      assert.deepEqual(zombie.walk.variants[0].frameDurations, [90, 180]);
      assert.ok(zombie.walk.variants[1].frameDurations.every((ms) => ms === 100));
      assert.equal(zombie.walk.variants[2].frameDurations[17], 100);
      assert.deepEqual(
        zombie.walk.variants.map((variant) => variant.animationKey),
        ['normal-walk-1', 'normal-walk-2', 'normal-walk-3'],
      );

      assert.equal(zombie.attack.frameWidth, 166);
      assert.equal(zombie.attack.frameHeight, 144);
      assert.equal(zombie.attack.frameCount, 21);
      assert.deepEqual(zombie.attack.frameDurations, [
        150, 100, 100, 100, 100, 100, 100, 100, 100, 100,
        100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100,
      ]);
      assert.equal(zombie.attack.animationKey, 'normal-attack');
      assert.equal(zombie.attack.repeat, -1);

      assert.equal(zombie.die.frameCount, 10);
      assert.deepEqual(zombie.die.frameDurations, [100, 100, 200, 100, 100, 100, 100, 100, 100, 1000]);
      assert.equal(zombie.die.repeat, 0);

      assert.equal(zombie.head.textureKey, 'zombie-head');
      assert.equal(zombie.head.frameWidth, 150);
      assert.equal(zombie.head.frameHeight, 186);
      assert.equal(zombie.head.frameCount, 12);
      assert.deepEqual(zombie.head.frameDurations, [40, 40, 40, 40, 40, 40, 40, 40, 40, 80, 80, 40]);
      assert.equal(zombie.head.animationKey, 'zombie-head-die');
      assert.equal(zombie.head.repeat, 0);
      assert.deepEqual(zombie.head.neckOffset, { x: 64, y: 39 });

      assert.deepEqual(zombie.sounds, {
        hitKey: 'zombie-hit',
        hitUrl: zombie.sounds.hitUrl,
        dieKey: 'zombie-die',
        dieUrl: zombie.sounds.dieUrl,
      });

      assert.ok(config.textures.every(Boolean), 'all enemy and weapon textures must load');
      assert.equal(config.partCount, 20, 'the zombie is assembled from 20 reanim parts');
      assert.ok(config.partTextures.every(Boolean), 'every reanim part texture must load');
      assert.deepEqual(config.animations, {
        idle: { start: 0, end: 28, fps: 12, loop: true },
        idle2: { start: 29, end: 43, fps: 12, loop: true },
        walk: { start: 44, end: 90, fps: 24, loop: true },
        walk2: { start: 91, end: 137, fps: 24, loop: true },
        eat: { start: 138, end: 177, fps: 20, loop: true },
        death: { start: 178, end: 216, fps: 26, loop: false },
        death2: { start: 217, end: 249, fps: 26, loop: false },
      });
      assert.deepEqual(config.sounds, [true, true, true]);

      assert.deepEqual(Object.keys(packageJson.dependencies).sort(), ['phaser', 'sharp']);
      assert.deepEqual(Object.keys(packageJson.devDependencies).sort(), [
        'playwright-core',
        'vite',
      ]);

      const png = errors.responses.filter((res) => /spritesheet.*\.png/i.test(res.url));
      assert.ok(png.length >= 6, 'all six enemy spritesheets must be requested');
      assert.ok(png.every((res) => res.status === 200));
      assert.equal(
        errors.responses.filter((res) => /\.gif(\?|$)/i.test(res.url)).length,
        0,
        'GIFs must not be decoded at runtime',
      );

      assert.deepEqual(config.dieSheet, { width: 1660, height: 144, frames: 10 });
      assert.deepEqual(config.headSheet, { width: 1800, height: 186, frames: 12 });
    } finally {
      await H.disposePage(page);
    }
  });

  test('R2/R3 one dart damages every overlapping zombie once, then is consumed', async () => {
    const { page } = await openWorld(browser);
    try {
      await H.stopRefill(page);
      await H.spyOnSounds(page);
      const indices = [];
      for (const x of [400, 420, 440]) {
        indices.push(await H.spawnTestZombie(page, x, 400, { maxHp: 10 }));
      }
      const point = await H.placeTestZombiesAtDart(page, indices, 0);
      assert.ok(point, 'dart slot 0 must be occupied');
      await H.frames(page, 2);

      const after = await Promise.all(indices.map((index) => H.readTestZombie(page, index)));
      for (const zombie of after) assert.equal(zombie.hp, 8, 'each overlapping zombie takes 2');

      const orbit = await H.readWeaponOrbit(page);
      assert.equal(orbit.active, 7, 'exactly one dart is consumed');
      assert.equal(orbit.slots[0], null);

      const sounds = await H.readSoundLog(page);
      assert.equal(
        sounds.filter((entry) => entry.key === 'zombie-hit').length,
        3,
        'each damaged zombie emits one hit sound',
      );

      await page.waitForTimeout(150);
      const later = await Promise.all(indices.map((index) => H.readTestZombie(page, index)));
      for (const zombie of later) assert.equal(zombie.hp, 8, 'the consumed dart must not hit twice');
      assert.equal((await H.readWeaponOrbit(page)).active, 7);
    } finally {
      await H.disposePage(page);
    }
  });

  test('R2/R3 two darts can hit the same zombie in one frame and stack damage', async () => {
    const { page } = await openWorld(browser);
    try {
      await H.stopRefill(page);
      await H.spyOnSounds(page);
      const index = await H.spawnTestZombie(page, 400, 400, { maxHp: 20 });

      const staged = await page.evaluate((i) => {
        const scene = window.game.scene.getScene('world');
        const orbit = scene.weaponOrbit;
        const zombie = window.__testZombies[i];
        window.__orbitUpdate = orbit.update;
        orbit.update = () => {};
        const x = zombie.body.center.x;
        const y = zombie.body.center.y;
        for (const slot of [0, 1]) {
          const dart = orbit.slots[slot];
          const dx = dart.body.center.x - dart.x;
          const dy = dart.body.center.y - dart.y;
          dart.body.reset(x - dx, y - dy);
        }
        return { x, y };
      }, index);
      assert.ok(staged);
      await H.frames(page, 2);

      const zombie = await H.readTestZombie(page, index);
      assert.equal(zombie.hp, 16, 'stacked darts apply 2 damage each');
      const orbit = await H.readWeaponOrbit(page);
      assert.equal(orbit.active, 6);
      assert.equal(orbit.slots[0], null);
      assert.equal(orbit.slots[1], null);
      const sounds = await H.readSoundLog(page);
      assert.equal(
        sounds.filter((entry) => entry.key === 'zombie-hit').length,
        2,
        'both darts resolve their own hit',
      );
      await page.evaluate(() => {
        window.game.scene.getScene('world').weaponOrbit.update = window.__orbitUpdate;
      });
    } finally {
      await H.disposePage(page);
    }
  });

  test('R4/R5 starts empty, refills one dart per second into the next empty slot and never overfills', async () => {
    const { page } = await openWorld(browser, { darts: false });
    try {
      const initial = await H.readWeaponOrbit(page);
      assert.equal(initial.slotCount, 8);
      assert.equal(initial.active, 0);
      assert.equal(initial.refillIntervalMs, 1000);
      assert.equal(initial.timerDelay, 1000);
      assert.equal(initial.damage, 2);

      await page.waitForFunction(
        () => window.game.scene.getScene('world').weaponOrbit.getActiveDarts().length === 1,
        null,
        { timeout: 3000, polling: 30 },
      );
      const firstRefill = await H.readWeaponOrbit(page);
      assert.notEqual(firstRefill.slots[0], null, 'the first refill fills slot 0');
      assert.equal(firstRefill.refillCursor, 1);

      await H.fillDarts(page);
      assert.equal((await H.readWeaponOrbit(page)).active, 8);

      await page.evaluate(() => {
        const orbit = window.game.scene.getScene('world').weaponOrbit;
        orbit.consume(orbit.slots[4]);
        orbit.consume(orbit.slots[6]);
      });
      const consumed = await H.readWeaponOrbit(page);
      assert.equal(consumed.active, 6);
      assert.equal(consumed.slots[4], null);
      assert.equal(consumed.slots[6], null);

      await page.waitForFunction(
        () => window.game.scene.getScene('world').weaponOrbit.getActiveDarts().length === 7,
        null,
        { timeout: 3000, polling: 30 },
      );
      const refillAfterConsume = await H.readWeaponOrbit(page);
      assert.notEqual(refillAfterConsume.slots[4], null, 'refill starts after the cursor at slot 4');
      assert.equal(refillAfterConsume.slots[6], null);

      await page.waitForFunction(
        () => window.game.scene.getScene('world').weaponOrbit.getActiveDarts().length === 8,
        null,
        { timeout: 3000, polling: 30 },
      );
      const secondRefill = await H.readWeaponOrbit(page);
      assert.notEqual(secondRefill.slots[6], null);
      assert.equal(secondRefill.active, 8);
      assert.equal(secondRefill.slots.length, 8);

      await page.waitForTimeout(1500);
      assert.equal((await H.readWeaponOrbit(page)).active, 8, 'full slots must not accumulate');
    } finally {
      await H.disposePage(page);
    }
  });

  test('R6 a zombie dies exactly when its fixed 10 HP reaches zero', async () => {
    const { page } = await openWorld(browser);
    try {
      await H.stopRefill(page);
      const index = await H.spawnTestZombie(page, 400, 400, { maxHp: 10 });
      const initial = await H.readTestZombie(page, index);
      assert.equal(initial.hp, 10);

      const afterOne = await page.evaluate((i) => {
        const zombie = window.__testZombies[i];
        zombie.takeDamage(5);
        return { hp: zombie.hp, dead: zombie.dead };
      }, index);
      assert.equal(afterOne.hp, 5);
      assert.equal(afterOne.dead, false);
      assert.equal((await H.readTestZombie(page, index)).bodyEnabled, true);

      await H.callTestZombie(page, index, 'takeDamage', 5);
      const dead = await H.readTestZombie(page, index);
      assert.equal(dead.hp, 0);
      assert.equal(dead.dead, true);
    } finally {
      await H.disposePage(page);
    }
  });

  test('R7 damage tints for ~120ms, does not restart, and lethal hits skip the flash', async () => {
    const { page } = await openWorld(browser);
    try {
      const index = await H.spawnTestZombie(page, 400, 400, { maxHp: 20 });
      const flash = await page.evaluate((i) => {
        const zombie = window.__testZombies[i];
        zombie.takeDamage(5);
        const firstTimer = zombie.flashTimer;
        const firstTint = zombie.gameObject.tintTopLeft;
        zombie.takeDamage(5);
        return {
          hp: zombie.hp,
          tint: firstTint,
          timerKept: firstTimer !== null && zombie.flashTimer === firstTimer,
        };
      }, index);
      assert.equal(flash.hp, 10);
      assert.equal(flash.tint, 0xff0000, 'damage must tint the whole sprite red');
      assert.equal(flash.timerKept, true, 'a second hit must not restart the flash timer');

      await page.waitForTimeout(220);
      const after = await H.readTestZombie(page, index);
      assert.equal(after.hp, 10);
      assert.equal(after.tintTopLeft, 0xffffff, 'the tint is cleared after the 120ms window');

      const lethalIndex = await H.spawnTestZombie(page, 500, 400, { maxHp: 1 });
      const lethal = await page.evaluate((i) => {
        const zombie = window.__testZombies[i];
        zombie.takeDamage(1);
        return {
          dead: zombie.dead,
          tint: zombie.gameObject.tintTopLeft,
          artTint: zombie.art.sprites.head.tintTopLeft,
          anim: zombie.art.animationName,
          frame: zombie.art.frame,
        };
      }, lethalIndex);
      assert.equal(lethal.dead, true);
      assert.equal(lethal.tint, 0xffffff, 'lethal hits must not flash');
      assert.equal(lethal.artTint, 0xffffff, 'the art parts must not flash either');
      assert.match(lethal.anim, /^death2?$/, 'death picks one of the two death clips');
      assert.ok([178, 217].includes(lethal.frame), 'the death clip starts on its first frame');
    } finally {
      await H.disposePage(page);
    }
  });

  test('R8/R9/R11 death splits the head, hides it in the body and collapses both once', async () => {
    const { page } = await openWorld(browser);
    try {
      const animations = await page.evaluate(async () => {
        const { ZOMBIE_REANIM } = await import('/src/zombieReanimData.js');
        const pick = (name) => {
          const anim = ZOMBIE_REANIM.animations[name];
          return {
            frames: anim.end - anim.start + 1,
            fps: anim.fps,
            loop: anim.loop,
            start: anim.start,
          };
        };
        return {
          walk: pick('walk'),
          walk2: pick('walk2'),
          eat: pick('eat'),
          death: pick('death'),
          death2: pick('death2'),
        };
      });
      assert.deepEqual(animations.walk, { frames: 47, fps: 24, loop: true, start: 44 });
      assert.deepEqual(animations.walk2, { frames: 47, fps: 24, loop: true, start: 91 });
      assert.deepEqual(animations.eat, { frames: 40, fps: 20, loop: true, start: 138 });
      assert.deepEqual(animations.death, { frames: 39, fps: 26, loop: false, start: 178 });
      assert.deepEqual(animations.death2, { frames: 33, fps: 26, loop: false, start: 217 });

      const index = await H.spawnTestZombie(page, 400, 400, {
        maxHp: 1,
        speed: 100,
        mustache: true,
        tongue: false,
      });
      const killedAt = Date.now();
      const death = await page.evaluate(async (i) => {
        const { ZOMBIE_REANIM } = await import('/src/zombieReanimData.js');
        const zombie = window.__testZombies[i];
        const art = zombie.art;
        zombie.setFacing(true);

        // The death clip omits the head, so capture the pre-death pose first.
        const [anchorX, anchorY] = ZOMBIE_REANIM.anchor;
        const headPose = art.getPose('head');
        const headMeta = ZOMBIE_REANIM.parts.head;
        const headCenterX = headPose[0] + (headMeta.width * headPose[3]) / 2;
        const headCenterY = headPose[1] + (headMeta.height * headPose[4]) / 2;

        zombie.takeDamage(zombie.hp);

        const head = zombie.headSprite;
        window.__deathHead = head;
        const hiddenInBody = ['hair', 'head', 'jaw', 'mustache', 'tongue'];

        return {
          dead: zombie.dead,
          bodyEnabled: !!zombie.body.enable,
          velX: zombie.body.velocity.x,
          velY: zombie.body.velocity.y,
          anim: art.animationName,
          startFrame: ZOMBIE_REANIM.animations[art.animationName].start,
          frame: art.frame,
          facingRight: art.facingRight,
          artScaleX: art.container.scaleX,
          artScaleY: art.container.scaleY,
          flipX: !!zombie.gameObject.flipX,
          hiddenInBody: hiddenInBody.map((partKey) => art.sprites[partKey].visible),
          outerArmVisible: art.sprites.outerarm_upper.visible,
          headChildren: head.list.length,
          headScaleX: head.scaleX,
          headScaleY: head.scaleY,
          headAlpha: head.alpha,
          headActive: !!head.active,
          headX: head.x,
          headY: head.y,
          expectedX: art.container.x + (headCenterX - anchorX) * art.container.scaleX,
          expectedY: art.container.y + (headCenterY - anchorY) * art.container.scaleY,
        };
      }, index);

      assert.equal(death.dead, true);
      assert.equal(death.bodyEnabled, false, 'death must disable the body immediately');
      assert.equal(death.velX, 0);
      assert.equal(death.velY, 0);
      assert.equal(death.facingRight, true);
      assert.equal(death.artScaleX < 0, true, 'facing right mirrors the whole art container');
      assert.equal(death.artScaleY > 0, true);
      assert.equal(death.flipX, true, 'the physics proxy keeps the last facing');
      assert.match(death.anim, /^death2?$/, 'death picks one of the two death clips');
      assert.equal(death.frame, death.startFrame, 'the death clip starts on its first frame');
      assert.deepEqual(
        death.hiddenInBody,
        [false, false, false, false, false],
        'the body hides every head part once the head pops off',
      );
      assert.equal(death.outerArmVisible, true, 'a one-hit death keeps both arms');
      assert.equal(death.headChildren, 4, 'hair, head, jaw and mustache fly together');
      assert.equal(death.headScaleX, death.artScaleX, 'the flying head reuses the body mirror');
      assert.equal(death.headScaleY, death.artScaleY);
      assert.equal(death.headAlpha, 1);
      assert.equal(death.headActive, true);
      assert.ok(
        Math.abs(death.headX - death.expectedX) < 0.01,
        `the head pops from the neck (${death.headX} vs ${death.expectedX})`,
      );
      assert.ok(
        Math.abs(death.headY - death.expectedY) < 0.01,
        `the head pops at the neck height (${death.headY} vs ${death.expectedY})`,
      );
      assert.equal((await H.readGameState(page)).aliveZombies, 0, 'death releases the alive slot');

      await page.waitForTimeout(600);
      const midway = await H.readTestZombie(page, index);
      assert.equal(midway.active, true, 'the body must stay while the death clip plays');
      assert.ok(midway.sceneObjects >= 0, 'the art container is still in the display list');
      assert.equal(midway.head.active, true, 'the head is still on screen during the collapse');
      assert.match(midway.anim, /^death2?$/);
      assert.ok(
        midway.head.y >= death.expectedY - 18,
        `the head must not fly high above the neck (${midway.head.y} vs ${death.expectedY})`,
      );

      await page.waitForFunction(
        (i) => {
          const zombie = (window.__testZombies || [])[i];
          return !zombie || zombie.gameObject.active === false;
        },
        index,
        { timeout: 5000, polling: 50 },
      );
      const elapsed = Date.now() - killedAt;
      assert.ok(elapsed >= 1100, `the death clips last at least 1.2s (${elapsed}ms)`);
      const cleaned = await page.evaluate(() => window.__deathHead.active === false);
      assert.equal(cleaned, true, 'the head is removed together with the body');
    } finally {
      await H.disposePage(page);
    }
  });

  test('R12 contact starts the attack loop: continuous damage, no rewards, no death clip', async () => {
    const { page } = await H.openGameWithStart(browser, URL);
    try {
      await H.clearZombies(page, { pause: false });
      await H.removeAllDarts(page);
      await H.spyOnSounds(page);
      const before = await H.readGameState(page);
      assert.equal(before.hp, 648);
      assert.equal(before.maxHp, 648);

      const index = await H.spawnTestZombie(page, 400, 400, { maxHp: 10 });
      await page.evaluate((i) => {
        const scene = window.game.scene.getScene('world');
        const zombie = window.__testZombies[i];
        const target = scene.player.body.center;
        const dx = zombie.body.center.x - zombie.gameObject.x;
        const dy = zombie.body.center.y - zombie.gameObject.y;
        zombie.body.reset(target.x - dx, target.y - dy);
      }, index);

      await page.waitForFunction(
        () => window.game.scene.getScene('world').hp <= 638,
        null,
        { timeout: 5000, polling: 30 },
      );
      await page.waitForTimeout(200);
      const after = await H.readGameState(page);
      const zombie = await H.readTestZombie(page, index);
      const sounds = await H.readSoundLog(page);

      assert.equal(after.hp, 638, 'the attack tick deals the configured 10 damage');
      assert.equal(after.gold, before.gold, 'contact damage must not award gold');
      assert.equal(after.xp, before.xp, 'contact damage must not award XP');
      assert.equal(zombie.active, true, 'contact no longer destroys the zombie');
      assert.equal(zombie.dead, false, 'contact must not run the death flow');
      assert.equal(zombie.attacking, true, 'the zombie enters the attack state');
      assert.equal(zombie.anim, 'eat');
      assert.ok(after.aliveZombies >= 1);
      assert.ok(after.population.used >= 1, 'the attacker occupies population');
      assert.ok(sounds.some((entry) => entry.key === 'chomp'));
      assert.equal(
        sounds.filter((entry) => entry.key === 'zombie-hit' || entry.key === 'zombie-die').length,
        0,
        'attacking the player must not damage the zombie',
      );
      const deathSprites = await page.evaluate(
        () =>
          (window.__testZombies || []).filter(
            (zombie) => zombie.art && /^death/.test(zombie.art.animationName || ''),
          ).length,
      );
      assert.equal(deathSprites, 0, 'contact must not play the death animation');

      await page.evaluate((i) => {
        const scene = window.game.scene.getScene('world');
        const zombie = window.__testZombies[i];
        zombie.body.reset(scene.player.body.center.x + 500, scene.player.body.center.y);
      }, index);
      await H.frames(page, 3);
      const away = await H.readTestZombie(page, index);
      assert.equal(away.attacking, false, 'leaving the contact range stops the attack');
      assert.ok(
        ['walk', 'walk2'].includes(away.anim),
        `the zombie returns to a walk clip (${away.anim})`,
      );
    } finally {
      await H.disposePage(page);
    }
  });

  test('R14 hit and death sounds are independent instances; lethal hits only play the death sound', async () => {
    const { page } = await openWorld(browser);
    try {
      await H.stopRefill(page);
      await H.spyOnSounds(page);
      const a = await H.spawnTestZombie(page, 400, 400, { maxHp: 10 });
      const b = await H.spawnTestZombie(page, 450, 400, { maxHp: 10 });

      await damageAll(page, [a, b], 1);
      const hit = await H.countSoundInstances(page, 'zombie-hit');
      assert.deepEqual(hit, { calls: 2, distinct: 2 }, 'two hits must create two instances');

      await H.clearSoundLog(page);
      const lethal = await H.spawnTestZombie(page, 500, 400, { maxHp: 1 });
      await H.callTestZombie(page, lethal, 'takeDamage', 1);
      const sounds = await H.readSoundLog(page);
      assert.deepEqual(
        sounds.map((entry) => entry.key),
        ['zombie-die'],
        'a lethal hit must skip zombie-hit',
      );
      const die = await H.countSoundInstances(page, 'zombie-die');
      assert.deepEqual(die, { calls: 1, distinct: 1 });
    } finally {
      await H.disposePage(page);
    }
  });

  test('R13 movement, spawn cadence, camera follow and tracking stay unchanged', async () => {
    const { page } = await H.openGameWithStart(browser, URL);
    try {
      const base = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        return {
          spawnDelay: scene.zombieManager.spawnTimer.delay,
          cameraFollow: !!scene.cameras.main._follow,
          playerSpeed: 300,
        };
      });
      assert.equal(base.spawnDelay, 2000);
      assert.equal(base.cameraFollow, true);

      await page.keyboard.down('ArrowRight');
      await page.waitForTimeout(200);
      const velocity = await page.evaluate(() => {
        const body = window.game.scene.getScene('world').player.body;
        return { x: body.velocity.x, y: body.velocity.y };
      });
      await page.keyboard.up('ArrowRight');
      assert.ok(Math.abs(velocity.x - 300) < 1, 'player horizontal speed stays 300');
      assert.equal(velocity.y, 0);

      await H.clearZombies(page, { pause: false });
      const index = await H.spawnTestZombie(page, 1300, 1000, { maxHp: 10, speed: 100 });
      await page.waitForTimeout(250);
      const zombie = await H.readTestZombie(page, index);
      assert.ok(Math.abs(Math.hypot(zombie.velX, zombie.velY) - 100) < 2, 'tracking speed is the snapshot');
      assert.ok(zombie.velX < 0, 'the zombie moves toward the player');
    } finally {
      await H.disposePage(page);
    }
  });
});
