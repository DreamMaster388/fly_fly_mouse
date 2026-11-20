'use strict';

/**
 * Acceptance suite for the dog tickets 01/02/03.
 *
 * The dog reuses the existing spawn ring, population and despawn pipeline.
 * These tests drive the real world scene with physics paused unless movement is
 * under test; the scene clock keeps running so phase timers and animations
 * advance deterministically.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness.js');

const PORT = Number(process.env.ACCEPTANCE_DOG_PORT || 5219);
const URL = `http://127.0.0.1:${PORT}/`;

const DOG = { x: 900, y: 3380 };
const PLAYER_SPAWN = { x: 620, y: 3380 };
const OUTSIDE = { x: 1700, y: 3380 };
const LAKE = { x: 950, y: 840 };
const LAKE_PLAYER = { x: 950, y: 1100 };
const WATER_SLOW = 0.55;

async function openWorld(browser) {
  const { page, errors } = await H.openGameWithStart(browser, URL);
  await H.clearZombies(page, { pause: true });
  await H.stopRefill(page);
  return { page, errors };
}

async function resumePhysics(page) {
  await page.evaluate(() => {
    window.game.scene.getScene('world').physics.resume();
  });
}

async function waitForDogAnim(page, index, key, timeout = 6000) {
  await page.waitForFunction(
    ([i, k]) => {
      const dog = (window.__testDogs || [])[i];
      const anims = dog && dog.gameObject && dog.gameObject.anims;
      return !!anims && !!anims.currentAnim && anims.currentAnim.key === k;
    },
    [index, key],
    { timeout, polling: 20 },
  );
}

async function waitForLocustAnim(page, index, key, timeout = 6000) {
  await page.waitForFunction(
    ([i, k]) => {
      const locust = (window.__testLocusts || [])[i];
      const anims = locust && locust.gameObject && locust.gameObject.anims;
      return !!anims && !!anims.currentAnim && anims.currentAnim.key === k;
    },
    [index, key],
    { timeout, polling: 20 },
  );
}

async function waitForDogPhase(page, index, phase, timeout = 8000) {
  await page.waitForFunction(
    ([i, p]) => {
      const dog = (window.__testDogs || [])[i];
      return !!dog && dog.phase === p;
    },
    [index, phase],
    { timeout, polling: 20 },
  );
}

async function waitForDogDead(page, index, timeout = 3000) {
  await page.waitForFunction(
    (i) => {
      const dog = (window.__testDogs || [])[i];
      return !!dog && dog.dead === true;
    },
    index,
    { timeout, polling: 20 },
  );
}

async function waitForDogDestroyed(page, index, timeout = 3000) {
  await page.waitForFunction(
    (i) => {
      const dog = (window.__testDogs || [])[i];
      return !!dog && dog.destroyed === true;
    },
    index,
    { timeout, polling: 20 },
  );
}

async function resetPlayerHp(page) {
  await page.evaluate(() => {
    const scene = window.game.scene.getScene('world');
    scene.hp = scene.maxHp;
    scene.hud.setHp(scene.hp, scene.maxHp);
  });
}

async function driveToPhase(page, index, phase) {
  if (phase === 'walk') return;
  await waitForDogPhase(page, index, 'howl', 5000);
  if (phase === 'howl') return;
  await waitForDogPhase(page, index, 'wait', 5000);
  if (phase === 'wait') return;
  await waitForDogPhase(page, index, 'angry', 4000);
  if (phase === 'angry') return;
  await waitForDogPhase(page, index, 'chase', 6000);
}

async function centerInView(page, index) {
  return page.evaluate((i) => {
    const dog = window.__testDogs[i];
    const camera = window.game.scene.getScene('world').cameras.main;
    return camera.worldView.contains(dog.body.center.x, dog.body.center.y);
  }, index);
}

describe('dog acceptance', () => {
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

  test('D1 the dog enters through the normal mix, costs three population and is capped at one', async () => {
    const { page } = await openWorld(browser);
    try {
      const before = await H.readGameState(page);

      const populationBlocked = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        const filler = {};
        scene.population.add(filler, scene.population.max - scene.population.used);
        const dog = scene.zombieManager.spawn('dog');
        scene.population.remove(filler);
        return dog;
      });
      assert.equal(populationBlocked, null, 'a full population rejects the dog');

      const spawned = await page.evaluate(() => {
        const manager = window.game.scene.getScene('world').zombieManager;
        const original = Math.random;
        let calls = 0;
        Math.random = () => {
          calls += 1;
          return calls === 1 ? 0.05 : original();
        };
        const dog = manager.spawnScheduled();
        Math.random = original;
        return dog ? { typeId: dog.typeId, maxHp: dog.maxHp, phase: dog.phase } : null;
      });
      assert.ok(spawned, 'the scheduled roll can produce a dog');
      assert.equal(spawned.typeId, 'dog');
      assert.equal(spawned.maxHp, 100);
      assert.equal(spawned.phase, 'walk');

      const occupied = await H.readGameState(page);
      assert.equal(occupied.population.used, before.population.used + 3);
      assert.equal(occupied.aliveZombies, before.aliveZombies + 1);

      const second = await page.evaluate(() => {
        const manager = window.game.scene.getScene('world').zombieManager;
        const dog = manager.spawn('dog');
        if (dog) dog.destroy();
        return { spawned: !!dog, activeDogs: manager.activeDogs.size };
      });
      assert.equal(second.spawned, false, 'only one live dog may exist');
      assert.equal(second.activeDogs, 1);

      await page.evaluate(() => {
        const manager = window.game.scene.getScene('world').zombieManager;
        const dog = manager.getLiveZombies().find((enemy) => enemy.typeId === 'dog');
        if (dog) dog.takeDamage(9999);
      });
      await page.waitForFunction(
        () => window.game.scene.getScene('world').zombieManager.activeDogs.size === 0,
        null,
        { timeout: 3000, polling: 20 },
      );

      const respawned = await page.evaluate(() => {
        const manager = window.game.scene.getScene('world').zombieManager;
        return !!manager.spawn('dog');
      });
      assert.ok(respawned, 'the freed slot lets a new dog spawn');
    } finally {
      await H.disposePage(page);
    }
  });

  test('D2 the dog walks at 60 with the normal walk clip and a display height of 120', async () => {
    const { page } = await openWorld(browser);
    try {
      const index = await H.spawnTestDog(page, DOG.x, DOG.y, { speed: 60 });
      await resumePhysics(page);

      const start = await H.readTestDog(page, index);
      assert.equal(start.phase, 'walk');
      assert.equal(start.anim, 'dog-walk');
      assert.equal(start.animFrames, 97);
      assert.equal(start.animFrameRate, 24);
      assert.equal(start.animRepeat, -1);
      assert.ok(Math.abs(start.displayHeight - 120) < 0.5, 'the dog stands 120 tall');

      await page.waitForTimeout(400);
      const moving = await H.readTestDog(page, index);
      assert.equal(moving.anim, 'dog-walk');
      const speed = Math.hypot(moving.velocity.x, moving.velocity.y);
      assert.ok(
        Math.abs(speed - 60) < 2 && moving.velocity.x < 0,
        `walks toward the player at 60 (${moving.velocity.x}, ${moving.velocity.y})`,
      );
      assert.ok(moving.center.x < start.center.x, 'the dog closes in on the player');
    } finally {
      await H.disposePage(page);
    }
  });

  test('D3 the walk speed still stacks with the water slow', async () => {
    const { page } = await openWorld(browser);
    try {
      await H.teleportPlayer(page, LAKE_PLAYER.x, LAKE_PLAYER.y);
      const index = await H.spawnTestDog(page, LAKE.x, LAKE.y, { speed: 60 });
      await H.frames(page, 3);

      const lake = await H.readTestDog(page, index);
      assert.equal(lake.anim, 'dog-walk');
      assert.ok(
        Math.abs(lake.velocity.y - 60 * WATER_SLOW) < 1.5,
        `the lake slows the dog to ${lake.velocity.y}`,
      );
      assert.ok(Math.abs(lake.displayHeight - 120) < 0.5);
    } finally {
      await H.disposePage(page);
    }
  });

  test('D4 a hit only flashes red; the dog has no injured state', async () => {
    const { page } = await openWorld(browser);
    try {
      const index = await H.spawnTestDog(page, DOG.x, DOG.y, { speed: 0 });
      await H.callTestDog(page, index, 'takeDamage', 50);

      const hit = await H.readTestDog(page, index);
      assert.equal(hit.hp, 50);
      assert.equal(hit.dead, false);
      assert.equal(hit.anim, 'dog-walk');
      assert.equal(hit.tintTopLeft, 0xff0000, 'the hit tints the dog red');
      const hasInjured = await page.evaluate(
        (i) => 'injured' in window.__testDogs[i],
        index,
      );
      assert.equal(hasInjured, false, 'the dog never enters an injured state');

      await page.waitForTimeout(220);
      const recovered = await H.readTestDog(page, index);
      assert.notEqual(recovered.tintTopLeft, 0xff0000);
      assert.equal(recovered.hp, 50);
      assert.equal(recovered.anim, 'dog-walk');
    } finally {
      await H.disposePage(page);
    }
  });

  test('D5 a weapon kill pays 200 gold and 400 XP, then fades without effects', async () => {
    const { page } = await openWorld(browser);
    try {
      await H.spyOnSounds(page);
      const before = await H.readGameState(page);
      const index = await H.spawnTestDog(page, DOG.x, DOG.y, { speed: 0 });

      await H.callTestDog(page, index, 'takeDamage', 100);
      const corpse = await H.readTestDog(page, index);
      assert.equal(corpse.dead, true);
      assert.equal(corpse.hp, 0);
      assert.equal(corpse.bodyEnabled, false);
      assert.deepEqual(corpse.velocity, { x: 0, y: 0 });
      assert.equal(corpse.active, true, 'the dog fades instead of vanishing');

      const paid = await H.readGameState(page);
      assert.equal(paid.gold, before.gold + 200);
      assert.equal(paid.level, 2, '400 XP is enough for the first level');
      assert.equal(paid.xp, 120);
      assert.equal(paid.population.used, before.population.used);
      assert.equal(paid.aliveZombies, 0);
      assert.equal((await H.readSlimes(page)).length, 0, 'the dog leaves no slime');

      await waitForDogDestroyed(page, index);
      const gone = await H.readTestDog(page, index);
      assert.equal(gone.active, false);
      assert.equal(gone.alpha <= 0 || gone.destroyed, true);
      assert.equal((await H.readSoundLog(page)).length, 0, 'the dog plays no sounds');
    } finally {
      await H.disposePage(page);
    }
  });

  test('D6 touching the player in the walk phase deals 200 and kills the dog without a reward', async () => {
    const { page } = await openWorld(browser);
    try {
      const before = await H.readGameState(page);
      const index = await H.spawnTestDog(page, DOG.x, DOG.y, { speed: 0 });
      await H.teleportPlayer(page, DOG.x, DOG.y);
      await waitForDogDead(page, index);

      const hit = await H.readGameState(page);
      assert.equal(hit.hp, before.hp - 200);
      assert.equal(hit.gold, before.gold, 'contact death pays no gold');
      assert.equal(hit.xp, before.xp, 'contact death pays no XP');
      assert.equal(hit.population.used, before.population.used);
      assert.equal(hit.aliveZombies, 0);

      const corpse = await H.readTestDog(page, index);
      assert.equal(corpse.selfDestructed, true);
      assert.equal(corpse.bodyEnabled, false);
      assert.equal((await H.readSlimes(page)).length, 0);

      await page.waitForTimeout(1300);
      assert.equal((await H.readGameState(page)).hp, before.hp - 200, 'no delayed blast');
    } finally {
      await H.disposePage(page);
    }
  });

  test('D7 contact that empties the player HP ends the game', async () => {
    const { page } = await openWorld(browser);
    try {
      await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        scene.hp = 200;
      });
      const index = await H.spawnTestDog(page, DOG.x, DOG.y, { speed: 0 });
      await H.teleportPlayer(page, DOG.x, DOG.y);
      await page.waitForFunction(
        () => window.game.scene.getScene('world').gameOver === true,
        null,
        { timeout: 3000, polling: 20 },
      );

      const ended = await H.readGameState(page);
      assert.equal(ended.hp, 0);
      assert.equal(ended.gameOver, true);
      assert.ok(ended.overlay.length > 0, 'the result overlay is shown');
      assert.equal((await H.readTestDog(page, index)).dead, true);
    } finally {
      await H.disposePage(page);
    }
  });

  test('D8 a dog beyond 1600 is culled and frees its population', async () => {
    const { page } = await openWorld(browser);
    try {
      const before = await H.readGameState(page);
      const index = await H.spawnTestDog(page, DOG.x, DOG.y, { speed: 0 });
      await page.evaluate((i) => {
        window.__testDogs[i].despawnExempt = false;
      }, index);
      await H.moveTestDogBody(page, index, DOG.x + 2000, DOG.y);
      await waitForDogDestroyed(page, index);

      const after = await H.readGameState(page);
      assert.equal(after.aliveZombies, 0);
      assert.equal(after.population.used, before.population.used);
      const activeDogs = await page.evaluate(
        () => window.game.scene.getScene('world').zombieManager.activeDogs.size,
      );
      assert.equal(activeDogs, 0);
    } finally {
      await H.disposePage(page);
    }
  });

  test('H1 the dog howls silently once after three seconds in view', async () => {
    const { page } = await openWorld(browser);
    try {
      await H.spyOnSounds(page);
      const spawnedAt = Date.now();
      const index = await H.spawnTestDog(page, DOG.x, DOG.y, { speed: 0 });

      await page.waitForTimeout(2000);
      const early = await H.readTestDog(page, index);
      assert.equal(early.howled, false, 'two seconds is not enough');
      assert.equal(early.anim, 'dog-walk');
      assert.equal(early.seen, true);
      assert.ok(early.seenMs >= 1800, `seen time is counted (${early.seenMs}ms)`);

      await waitForDogAnim(page, index, 'dog-howl', 4000);
      const elapsed = Date.now() - spawnedAt;
      assert.ok(elapsed >= 2600, `the howl waits about three seconds (${elapsed}ms)`);
      assert.ok(elapsed <= 5200, `the howl does not drag on (${elapsed}ms)`);

      const howl = await H.readTestDog(page, index);
      assert.equal(howl.phase, 'howl');
      assert.equal(howl.howled, true);
      assert.deepEqual(howl.velocity, { x: 0, y: 0 }, 'the dog stands still');
      assert.equal(howl.animFrames, 65);
      assert.equal(howl.animFrameRate, 24);
      assert.equal(howl.animRepeat, 0, 'the howl plays once');
      assert.ok(Math.abs(howl.displayHeight - 120) < 0.5);

      const fixedAt = howl.center;
      await page.waitForTimeout(1500);
      const mid = await H.readTestDog(page, index);
      assert.equal(mid.anim, 'dog-howl', 'the howl clip is about 2.7s long');
      assert.deepEqual(mid.velocity, { x: 0, y: 0 });
      assert.ok(
        Math.hypot(mid.center.x - fixedAt.x, mid.center.y - fixedAt.y) < 1.5,
        'the dog stays put while howling',
      );

      assert.equal((await H.readSoundLog(page)).length, 0, 'the howl is silent');
      const shaking = await page.evaluate(() => {
        const camera = window.game.scene.getScene('world').cameras.main;
        return camera.shakeEffect ? camera.shakeEffect.isRunning : false;
      });
      assert.equal(shaking, false, 'the howl does not shake the camera');

      await waitForDogPhase(page, index, 'wait', 4000);
      const quiet = await H.readTestDog(page, index);
      assert.deepEqual(quiet.velocity, { x: 0, y: 0 }, 'the dog waits after the howl');
      assert.equal(quiet.enraged, false);
    } finally {
      await H.disposePage(page);
    }
  });

  test('H2 a dog seen once still howls after leaving the view', async () => {
    const { page } = await openWorld(browser);
    try {
      const index = await H.spawnTestDog(page, DOG.x, DOG.y, { speed: 0 });
      await page.waitForTimeout(500);
      assert.equal((await H.readTestDog(page, index)).seen, true);

      await H.teleportPlayer(page, OUTSIDE.x, OUTSIDE.y);
      await H.frames(page, 3);
      assert.equal(await centerInView(page, index), false, 'the dog is offscreen now');

      await waitForDogAnim(page, index, 'dog-howl', 5000);
      assert.equal(await centerInView(page, index), false, 'the howl happens offscreen');
      assert.equal((await H.readTestDog(page, index)).howled, true);
    } finally {
      await H.disposePage(page);
    }
  });

  test('H3 pausing the scene stops the howl clock', async () => {
    const { page } = await openWorld(browser);
    try {
      const index = await H.spawnTestDog(page, DOG.x, DOG.y, { speed: 0 });
      await page.waitForTimeout(900);

      await page.evaluate(() => {
        window.game.scene.pause('world');
      });
      await page.waitForTimeout(2000);
      await page.evaluate(() => {
        window.game.scene.resume('world');
      });
      await page.waitForTimeout(1000);

      const stillNormal = await H.readTestDog(page, index);
      assert.equal(stillNormal.howled, false, 'paused time does not count');
      assert.equal(stillNormal.anim, 'dog-walk');

      await waitForDogAnim(page, index, 'dog-howl', 4000);
    } finally {
      await H.disposePage(page);
    }
  });

  test('H4 the howl enrages normal locusts in view and ignores the rest', async () => {
    const { page } = await openWorld(browser);
    try {
      const normal = await H.spawnTestLocust(page, 900, 3380, { speed: 0 });
      const injured = await H.spawnTestLocust(page, 800, 3600, { speed: 0 });
      await H.callTestLocust(page, injured, 'takeDamage', 4);
      const offscreen = await H.spawnTestLocust(page, OUTSIDE.x, OUTSIDE.y, { speed: 0 });
      const alreadyEnraged = await H.spawnTestLocust(page, 700, 3200, { speed: 0 });
      await H.callTestLocust(page, alreadyEnraged, 'beginEnrage');

      const dogIndex = await H.spawnTestDog(page, 1000, 3300, { speed: 0 });
      await waitForDogAnim(page, dogIndex, 'dog-howl', 5000);

      await waitForLocustAnim(page, normal, 'locust-enrage', 2000);
      const enraged = await H.readTestLocust(page, normal);
      assert.equal(enraged.enraged, true);
      assert.equal(enraged.enraging, true);
      await page.waitForFunction(
        (i) => {
          const locust = window.__testLocusts[i];
          const anims = locust && locust.gameObject && locust.gameObject.anims;
          return !!anims && !!anims.currentAnim && anims.currentAnim.key === 'locust-angry-walk';
        },
        normal,
        { timeout: 4000, polling: 20 },
      );

      const hurt = await H.readTestLocust(page, injured);
      assert.equal(hurt.enraged, false, 'injured locusts are not enraged');
      assert.equal(hurt.injured, true);
      assert.equal(hurt.anim, 'locust-hurt');

      assert.equal(
        (await H.readTestLocust(page, offscreen)).enraged,
        false,
        'offscreen locusts are not enraged',
      );
      const old = await H.readTestLocust(page, alreadyEnraged);
      assert.equal(old.enraged, true, 'an already enraged locust stays enraged');
      assert.equal(old.anim, 'locust-angry-walk');

      const late = await H.spawnTestLocust(page, 700, 3600, { speed: 0 });
      await page.waitForTimeout(400);
      assert.equal(
        (await H.readTestLocust(page, late)).enraged,
        false,
        'locusts spawned after the howl are not enraged by it',
      );
    } finally {
      await H.disposePage(page);
    }
  });

  test('H5 a locust no longer enrages on its own', async () => {
    const { page } = await openWorld(browser);
    try {
      const index = await H.spawnTestLocust(page, 900, 3380, { speed: 0 });
      await page.waitForTimeout(4500);
      const idle = await H.readTestLocust(page, index);
      assert.equal(idle.enraged, false, 'there is no automatic enrage without a dog');
      assert.equal(idle.enraging, false);
      assert.equal(idle.anim, 'locust-walk');
    } finally {
      await H.disposePage(page);
    }
  });

  test('H6 killing the dog before the howl cancels it', async () => {
    const { page } = await openWorld(browser);
    try {
      const locust = await H.spawnTestLocust(page, 900, 3380, { speed: 0 });
      const index = await H.spawnTestDog(page, DOG.x, DOG.y, { speed: 0 });
      await page.waitForTimeout(1000);

      await H.callTestDog(page, index, 'takeDamage', 9999);
      await page.waitForTimeout(3000);
      const cancelled = await H.readTestDog(page, index);
      assert.equal(cancelled.dead, true);
      assert.equal(cancelled.howled, false, 'the howl never starts');
      assert.equal((await H.readTestLocust(page, locust)).enraged, false);
    } finally {
      await H.disposePage(page);
    }
  });

  test('H7 killing the dog after the howl does not undo the enrage', async () => {
    const { page } = await openWorld(browser);
    try {
      const locust = await H.spawnTestLocust(page, 900, 3380, { speed: 0 });
      const index = await H.spawnTestDog(page, DOG.x, DOG.y, { speed: 0 });
      await waitForDogAnim(page, index, 'dog-howl', 5000);

      await H.callTestDog(page, index, 'takeDamage', 9999);
      await page.waitForTimeout(400);
      assert.equal((await H.readTestDog(page, index)).dead, true);
      assert.equal((await H.readTestLocust(page, locust)).enraged, true);

      await page.waitForTimeout(2500);
      assert.equal(
        (await H.readTestLocust(page, locust)).enraged,
        true,
        'the enrage is not reverted',
      );
    } finally {
      await H.disposePage(page);
    }
  });

  test('H8 contact during the howl still deals 200 and kills the dog', async () => {
    const { page } = await openWorld(browser);
    try {
      const before = await H.readGameState(page);
      const index = await H.spawnTestDog(page, DOG.x, DOG.y, { speed: 0 });
      await waitForDogAnim(page, index, 'dog-howl', 5000);

      await H.teleportPlayer(page, DOG.x, DOG.y);
      await waitForDogDead(page, index);
      const hit = await H.readGameState(page);
      assert.equal(hit.hp, before.hp - 200);
      assert.equal(hit.gold, before.gold);
      assert.equal(hit.xp, before.xp);
      assert.equal((await H.readTestDog(page, index)).selfDestructed, true);
    } finally {
      await H.disposePage(page);
    }
  });

  test('T1 the dog waits, transforms and then chases at three times the speed', async () => {
    const { page } = await openWorld(browser);
    try {
      const index = await H.spawnTestDog(page, DOG.x, DOG.y, { speed: 60 });

      await waitForDogPhase(page, index, 'howl', 6000);
      const howlAt = Date.now();
      const howl = await H.readTestDog(page, index);
      assert.equal(howl.anim, 'dog-howl');
      assert.equal(howl.animFrames, 65);
      assert.equal(howl.animFrameRate, 24);
      assert.equal(howl.animRepeat, 0);
      assert.deepEqual(howl.velocity, { x: 0, y: 0 });

      await waitForDogPhase(page, index, 'wait', 5000);
      const howlMs = Date.now() - howlAt;
      assert.ok(howlMs >= 2300 && howlMs <= 3600, `the howl lasts about 2.7s (${howlMs}ms)`);
      const waited = await H.readTestDog(page, index);
      assert.deepEqual(waited.velocity, { x: 0, y: 0 }, 'the dog stands through the wait');
      assert.equal(waited.enraged, false);

      await waitForDogPhase(page, index, 'angry', 5000);
      const waitMs = Date.now() - howlAt - howlMs;
      assert.ok(waitMs >= 1700 && waitMs <= 2800, `the dog waits 2s (${waitMs}ms)`);
      const angry = await H.readTestDog(page, index);
      assert.equal(angry.enraged, true);
      assert.equal(angry.enraging, true);
      assert.equal(angry.anim, 'dog-angry');
      assert.equal(angry.animFrames, 97);
      assert.equal(angry.animFrameRate, 24);
      assert.equal(angry.animRepeat, 0, 'the enrage clip plays once');
      assert.deepEqual(angry.velocity, { x: 0, y: 0 }, 'the dog stands through the enrage');
      assert.ok(Math.abs(angry.displayHeight - 120) < 0.5);

      await waitForDogPhase(page, index, 'chase', 8000);
      const angryMs = Date.now() - howlAt - howlMs - waitMs;
      assert.ok(angryMs >= 3500 && angryMs <= 5000, `the enrage clip lasts about 4s (${angryMs}ms)`);
      await H.frames(page, 3);

      const chase = await H.readTestDog(page, index);
      assert.equal(chase.enraged, true);
      assert.equal(chase.enraging, false);
      assert.equal(chase.anim, 'dog-angry-walk');
      assert.equal(chase.animFrames, 97);
      assert.equal(chase.animFrameRate, 24);
      assert.equal(chase.animRepeat, -1, 'the angry walk loops');
      assert.equal(chase.speed, 180);
      const speed = Math.hypot(chase.velocity.x, chase.velocity.y);
      assert.ok(Math.abs(speed - 180) < 2, `chases at 180 (${speed})`);
      assert.ok(chase.velocity.x < 0, 'runs toward the player');
      assert.ok(Math.abs(chase.displayHeight - 120) < 0.5);
      assert.ok(
        Math.hypot(chase.x - howl.x, chase.y - howl.y) < 1.5,
        'the dog holds its ground until the chase',
      );
    } finally {
      await H.disposePage(page);
    }
  });

  test('T2 the threefold chase speed still stacks with the water slow', async () => {
    const { page } = await openWorld(browser);
    try {
      await H.teleportPlayer(page, LAKE_PLAYER.x, LAKE_PLAYER.y);
      const index = await H.spawnTestDog(page, LAKE.x, LAKE.y, { speed: 60 });
      await H.callTestDog(page, index, 'beginAngry');
      await waitForDogPhase(page, index, 'chase', 6000);
      await H.frames(page, 3);

      const chase = await H.readTestDog(page, index);
      assert.equal(chase.enraged, true);
      assert.equal(chase.enraging, false);
      assert.equal(chase.howled, false, 'a direct enrage never falls back to the howl');
      assert.equal(chase.speed, 180);
      assert.equal(chase.anim, 'dog-angry-walk');
      assert.equal(chase.animFrameRate, 24);
      const speed = Math.hypot(chase.velocity.x, chase.velocity.y);
      assert.ok(Math.abs(speed - 180 * WATER_SLOW) < 2, `water chase speed is ${speed}`);
      assert.ok(chase.velocity.y > 0, 'runs toward the player');
      assert.ok(Math.abs(chase.displayHeight - 120) < 0.5);
    } finally {
      await H.disposePage(page);
    }
  });

  test('T3 contact in every phase deals 200, kills the dog and pays nothing', async () => {
    const { page } = await openWorld(browser);
    try {
      for (const phase of ['walk', 'howl', 'wait', 'angry', 'chase']) {
        await resetPlayerHp(page);
        await H.teleportPlayer(page, PLAYER_SPAWN.x, PLAYER_SPAWN.y);
        const before = await H.readGameState(page);

        const index = await H.spawnTestDog(page, DOG.x, DOG.y, { speed: 0 });
        await driveToPhase(page, index, phase);
        const staged = await H.readTestDog(page, index);
        assert.equal(staged.phase, phase);

        if (phase === 'chase') {
          await page.evaluate(() => {
            const scene = window.game.scene.getScene('world');
            scene.hp = 200;
          });
        }

        await H.teleportPlayer(page, staged.center.x, staged.center.y);
        await waitForDogDead(page, index);

        const hit = await H.readGameState(page);
        if (phase === 'chase') {
          assert.equal(hit.hp, 0);
          assert.equal(hit.gameOver, true);
          assert.ok(hit.overlay.length > 0, 'the result overlay is shown');
        } else {
          assert.equal(hit.hp, before.hp - 200);
        }
        assert.equal(hit.gold, before.gold, `contact in ${phase} pays no gold`);
        assert.equal(hit.xp, before.xp, `contact in ${phase} pays no XP`);
        assert.equal((await H.readSlimes(page)).length, 0);

        const corpse = await H.readTestDog(page, index);
        assert.equal(corpse.selfDestructed, true, `the dog dies from contact in ${phase}`);
        assert.equal(corpse.bodyEnabled, false);
        if (phase !== 'chase') await waitForDogDestroyed(page, index);
      }
    } finally {
      await H.disposePage(page);
    }
  });

  test('T4 a kill during the wait or the enrage pays the weapon reward and stops the transformation', async () => {
    const { page } = await openWorld(browser);
    try {
      const locust = await H.spawnTestLocust(page, 800, 3600, { speed: 0 });

      const firstDog = await H.spawnTestDog(page, DOG.x, DOG.y, { speed: 0 });
      await waitForDogPhase(page, firstDog, 'wait', 6000);
      await waitForLocustAnim(page, locust, 'locust-angry-walk', 4000);
      const before = await H.readGameState(page);

      await H.callTestDog(page, firstDog, 'takeDamage', 9999);
      const first = await H.readGameState(page);
      assert.equal(first.gold, before.gold + 200);
      assert.equal(first.level, 2);
      assert.equal(first.xp, 120);

      await page.waitForTimeout(2500);
      const stopped = await H.readTestDog(page, firstDog);
      assert.equal(stopped.phase, 'dead', 'the wait never turns into the enrage');
      assert.equal(stopped.enraged, false);
      assert.equal((await H.readTestLocust(page, locust)).enraged, true, 'the locust stays angry');
      await waitForDogDestroyed(page, firstDog);

      const secondDog = await H.spawnTestDog(page, DOG.x, DOG.y, { speed: 0 });
      await waitForDogPhase(page, secondDog, 'angry', 9000);
      const mid = await H.readGameState(page);

      await H.callTestDog(page, secondDog, 'takeDamage', 9999);
      const second = await H.readGameState(page);
      assert.equal(second.gold, mid.gold + 200);
      assert.equal(second.level, 3);
      assert.equal(second.xp, 180);

      await page.waitForTimeout(3000);
      const interrupted = await H.readTestDog(page, secondDog);
      assert.equal(interrupted.phase, 'dead', 'the enrage clip never resumes');
      assert.equal(interrupted.enraging, false);
      assert.equal(
        (await H.readTestLocust(page, locust)).enraged,
        true,
        'the enraged locust is untouched',
      );
    } finally {
      await H.disposePage(page);
    }
  });

  test('T5 despawning during the howl or the enrage frees the population', async () => {
    const { page } = await openWorld(browser);
    try {
      for (const phase of ['howl', 'angry']) {
        const before = await H.readGameState(page);
        const index = await H.spawnTestDog(page, DOG.x, DOG.y, { speed: 0 });
        await driveToPhase(page, index, phase);

        await page.evaluate((i) => {
          window.__testDogs[i].despawnExempt = false;
        }, index);
        await H.moveTestDogBody(page, index, DOG.x + 2000, DOG.y);
        await waitForDogDestroyed(page, index);
        await H.frames(page, 2);

        const after = await H.readGameState(page);
        assert.equal(after.aliveZombies, 0);
        assert.equal(after.population.used, before.population.used);
        const activeDogs = await page.evaluate(
          () => window.game.scene.getScene('world').zombieManager.activeDogs.size,
        );
        assert.equal(activeDogs, 0);
      }
    } finally {
      await H.disposePage(page);
    }
  });
});