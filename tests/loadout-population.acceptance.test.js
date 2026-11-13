'use strict';

/**
 * Independent acceptance suite for the fixed-loadout and population change.
 *
 * F1 普通僵尸 keeps fixed stats (30 speed, 10 HP, population cost 1) at every tier.
 * F2 a global population pool of 25 replaces per-enemy alive caps.
 * F3 旋转飞镖 keeps fixed stats (2 damage, 8 slots, 0 at start, +1 per second).
 * F4 darts deal their fixed damage through the normal overlap path.
 * F5 enemies left too far behind are culled without rewards, freeing their slot.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness.js');

const PORT = Number(process.env.ACCEPTANCE_LOADOUT_PORT || 5193);
const URL = `http://127.0.0.1:${PORT}/`;

async function openWorld(browser, { darts = false, pause = true } = {}) {
  const { page } = await H.openGameWithStart(browser, URL);
  await H.clearZombies(page, { pause });
  if (darts) await H.fillDarts(page);
  return page;
}

describe('fixed loadout and population acceptance', () => {
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

  test('F1/F3 普通僵尸 and 旋转飞镖 keep the same fixed stats at 青铜 and 王者', async () => {
    const page = await openWorld(browser);
    try {
      const bronze = await page.evaluate(async () => {
        const { WEAPONS, ZOMBIES, GAMEPLAY } = await import('/src/config.js');
        const scene = window.game.scene.getScene('world');
        scene.zombieManager.spawn();
        const zombie = scene.zombieManager.getLiveZombies().slice(-1)[0];
        return {
          weapon: WEAPONS.dart,
          zombie: ZOMBIES.normal,
          maxPopulation: GAMEPLAY.maxPopulation,
          spawned: zombie ? { speed: zombie.speed, hp: zombie.hp } : null,
          orbit: {
            damage: scene.weaponOrbit.config.damage,
            interval: scene.weaponOrbit.refillIntervalMs,
            timer: scene.weaponOrbit.refillTimer.delay,
            slots: scene.weaponOrbit.slots.length,
            active: scene.weaponOrbit.getActiveDarts().length,
          },
          tier: scene.difficulty.tier.name,
        };
      });

      assert.equal(bronze.tier, '青铜');
      assert.equal(bronze.maxPopulation, 25);
      assert.equal(bronze.weapon.name, '旋转飞镖');
      assert.equal(bronze.weapon.damage, 2);
      assert.equal(bronze.weapon.slotCount, 8);
      assert.equal(bronze.weapon.initialCount, 0);
      assert.equal(bronze.weapon.refillIntervalMs, 1000);
      assert.equal(bronze.zombie.name, '普通僵尸');
      assert.equal(bronze.zombie.speed, 30);
      assert.equal(bronze.zombie.maxHp, 10);
      assert.equal(bronze.zombie.populationCost, 1);
      assert.deepEqual(bronze.spawned, { speed: 30, hp: 10 });
      assert.deepEqual(bronze.orbit, {
        damage: 2,
        interval: 1000,
        timer: 1000,
        slots: 8,
        active: 0,
      });

      await H.setTierByElapsed(page, 360000);
      const king = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        scene.zombieManager.spawn();
        const zombie = scene.zombieManager.getLiveZombies().slice(-1)[0];
        return {
          tier: scene.difficulty.tier.name,
          spawned: zombie ? { speed: zombie.speed, hp: zombie.hp } : null,
          orbit: {
            damage: scene.weaponOrbit.config.damage,
            interval: scene.weaponOrbit.refillIntervalMs,
            timer: scene.weaponOrbit.refillTimer.delay,
          },
        };
      });
      assert.equal(king.tier, '王者');
      assert.deepEqual(king.spawned, { speed: 30, hp: 10 });
      assert.deepEqual(king.orbit, { damage: 2, interval: 1000, timer: 1000 });
    } finally {
      await H.disposePage(page);
    }
  });

  test('F2 the global population pool of 25 blocks over-cap spawns and frees on death', async () => {
    const page = await openWorld(browser);
    try {
      const full = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        for (let i = 0; i < 200 && scene.population.canAdd(1); i += 1) {
          scene.zombieManager.spawn();
        }
        return {
          alive: scene.zombieManager.getLiveZombies().length,
          population: scene.population.used,
          max: scene.population.max,
        };
      });
      assert.deepEqual(full, { alive: 25, population: 25, max: 25 });

      const blocked = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        scene.zombieManager.spawn();
        return {
          alive: scene.zombieManager.getLiveZombies().length,
          population: scene.population.used,
        };
      });
      assert.deepEqual(blocked, { alive: 25, population: 25 });

      const afterDeath = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        const zombie = scene.zombieManager.getLiveZombies()[0];
        zombie.takeDamage(zombie.hp);
        return {
          alive: scene.zombieManager.getLiveZombies().length,
          population: scene.population.used,
        };
      });
      assert.deepEqual(afterDeath, { alive: 24, population: 24 }, 'death frees the population slot at once');

      const respawned = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        scene.zombieManager.spawn();
        return {
          alive: scene.zombieManager.getLiveZombies().length,
          population: scene.population.used,
        };
      });
      assert.deepEqual(respawned, { alive: 25, population: 25 }, 'the freed slot can be reused');

      await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        scene.physics.resume();
        const zombie = scene.zombieManager.getLiveZombies()[0];
        zombie.body.reset(scene.player.body.center.x, scene.player.body.center.y);
      });
      await page.waitForFunction(
        () => window.game.scene.getScene('world').hp < 648,
        null,
        { timeout: 5000, polling: 30 },
      );
      const afterContact = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        return {
          alive: scene.zombieManager.getLiveZombies().length,
          population: scene.population.used,
          hp: scene.hp,
        };
      });
      assert.deepEqual(
        afterContact,
        { alive: 25, population: 25, hp: 638 },
        'contact starts attacks without freeing the enemy population slot',
      );
    } finally {
      await H.disposePage(page);
    }
  });

  test('F2 population cost is validated before adding any occupant', async () => {
    const page = await openWorld(browser);
    try {
      const result = await page.evaluate(async () => {
        const { default: Population } = await import('/src/Population.js');
        const population = new Population(10);
        const a = { name: 'a' };
        const b = { name: 'b' };
        const c = { name: 'c' };
        const added = [
          population.add(a, 6),
          population.add(b, 4),
          population.add(c, 1),
        ];
        const full = { used: population.used, canAdd: population.canAdd(1) };
        population.remove(a);
        const afterRemove = { used: population.used, canAdd: population.canAdd(4) };
        return {
          added,
          full,
          afterRemove,
          addedAfterRemove: population.add(c, 4),
          finalUsed: population.used,
        };
      });
      assert.deepEqual(result, {
        added: [true, true, false],
        full: { used: 10, canAdd: false },
        afterRemove: { used: 4, canAdd: true },
        addedAfterRemove: true,
        finalUsed: 8,
      });
    } finally {
      await H.disposePage(page);
    }
  });

  test('F3 旋转飞镖 starts at 0, refills exactly one per second and caps at 8', async () => {
    const page = await openWorld(browser, { darts: false });
    try {
      const initial = await H.readWeaponOrbit(page);
      assert.equal(initial.active, 0);
      assert.equal(initial.refillIntervalMs, 1000);
      assert.equal(initial.timerDelay, 1000);

      await page.waitForFunction(
        () => window.game.scene.getScene('world').weaponOrbit.getActiveDarts().length === 1,
        null,
        { timeout: 3000, polling: 30 },
      );
      assert.equal((await H.readWeaponOrbit(page)).active, 1, 'one dart after one second');

      await H.fillDarts(page);
      assert.equal((await H.readWeaponOrbit(page)).active, 8, 'eight slots are the maximum');
      await page.waitForTimeout(1200);
      assert.equal((await H.readWeaponOrbit(page)).active, 8, 'a full orbit does not accumulate');
    } finally {
      await H.disposePage(page);
    }
  });

  test('F4 each dart removes 2 HP and five darts kill a 10 HP 普通僵尸', async () => {
    const page = await openWorld(browser, { darts: true });
    try {
      await H.stopRefill(page);
      const index = await H.spawnTestZombie(page, 400, 400, { maxHp: 10 });

      const expectedHp = [8, 6, 4, 2, 0];
      for (const [hit, hp] of expectedHp.entries()) {
        assert.ok(await H.placeTestZombieAtDart(page, index, hit));
        await H.frames(page, 2);
        const zombie = await H.readTestZombie(page, index);
        assert.equal(zombie.hp, hp, `dart ${hit + 1} removes exactly 2 HP`);
        assert.equal((await H.readWeaponOrbit(page)).active, 7 - hit, 'one dart per hit');
        if (hp > 0) {
          assert.equal(zombie.dead, false);
          assert.equal(
            zombie.armLost,
            hp <= 5,
            hp <= 5 ? 'half HP costs the outer arm' : 'above half HP keeps both arms',
          );
        } else {
          assert.equal(zombie.dead, true, 'the fifth dart finishes the 10 HP zombie');
        }
      }

      const state = await H.readGameState(page);
      assert.equal(state.aliveZombies, 0, 'death releases the alive set');
      assert.equal(state.population.used, 0, 'death releases the population slot');
    } finally {
      await H.disposePage(page);
    }
  });

  test('F5 enemies left too far behind are culled without rewards, freeing the slot', async () => {
    const page = await openWorld(browser);
    try {
      const setup = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        const manager = scene.zombieManager;
        const { despawnDistance } = manager.config;
        const player = scene.player.body.center;

        const near = manager.spawn();
        const far = manager.spawn();
        if (!near || !far) return null;

        const placeAt = (zombie, offsetX) => {
          const bodyOffsetX = zombie.body.center.x - zombie.gameObject.x;
          const bodyOffsetY = zombie.body.center.y - zombie.gameObject.y;
          zombie.body.reset(player.x + offsetX - bodyOffsetX, player.y - bodyOffsetY);
        };
        placeAt(near, despawnDistance - 200);
        placeAt(far, despawnDistance + 200);

        window.__despawnProbe = { near, far };
        return {
          despawnDistance,
          gold: scene.gold,
          xp: scene.xp,
          level: scene.level,
          population: scene.population.used,
        };
      });
      assert.ok(setup, 'both probe enemies spawned');
      assert.equal(setup.despawnDistance, 1600);
      assert.equal(setup.population, 2);

      await H.frames(page, 4);

      const afterCull = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        const { near, far } = window.__despawnProbe;
        return {
          nearAlive: scene.zombieManager.zombies.has(near) && !near.destroyed,
          farDestroyed: far.destroyed,
          farDied: far.dead,
          farArtActive: !!(far.art && far.art.container.active),
          alive: scene.zombieManager.getLiveZombies().length,
          population: scene.population.used,
          gold: scene.gold,
          xp: scene.xp,
          level: scene.level,
        };
      });
      assert.equal(afterCull.nearAlive, true, 'enemies inside the cull radius stay');
      assert.equal(afterCull.farDestroyed, true, 'the far enemy is removed outright');
      assert.equal(afterCull.farDied, false, 'the cull is not a death');
      assert.equal(afterCull.farArtActive, false, 'the far art is gone with it');
      assert.equal(afterCull.alive, 1);
      assert.equal(afterCull.population, 1, 'the culled enemy frees its population slot');
      assert.deepEqual(
        { gold: afterCull.gold, xp: afterCull.xp, level: afterCull.level },
        { gold: setup.gold, xp: setup.xp, level: setup.level },
        'the cull awards no gold or XP',
      );

      const respawn = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        scene.zombieManager.spawn();
        return {
          alive: scene.zombieManager.getLiveZombies().length,
          population: scene.population.used,
        };
      });
      assert.deepEqual(respawn, { alive: 2, population: 2 }, 'a fresh chaser uses the freed slot');
    } finally {
      await H.disposePage(page);
    }
  });
});
