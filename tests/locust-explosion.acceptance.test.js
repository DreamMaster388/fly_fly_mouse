'use strict';

/**
 * Acceptance suite for ticket 03 — death explosion and unified self-destruct.
 *
 * Both death sources (weapon kill and contact self-destruct) explode once at
 * the death point 0.625s into the death clip, dealing 20 to the player within
 * 120px. Zombies and other enemies are never hurt by it. Self-destruct no
 * longer applies instant contact damage or pays a reward.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness.js');

const PORT = Number(process.env.ACCEPTANCE_LOCUST_EXPLOSION_PORT || 5208);
const URL = `http://127.0.0.1:${PORT}/`;

const SPAWN = { x: 620, y: 3380 };

async function openWorld(browser) {
  const { page, errors } = await H.openGameWithStart(browser, URL);
  await H.clearZombies(page, { pause: true });
  await H.stopRefill(page);
  return { page, errors };
}

async function killLocustAt(page, x, y) {
  const index = await H.spawnTestLocust(page, x, y, { speed: 0 });
  await H.callTestLocust(page, index, 'takeDamage', 6);
  return index;
}

async function waitForHp(page, hp, timeout = 5000) {
  await page.waitForFunction(
    (target) => window.game.scene.getScene('world').hp === target,
    hp,
    { timeout, polling: 20 },
  );
}

describe('locust death explosion acceptance', () => {
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

  test('E1 a weapon kill blasts the player once at about 0.6s and spares zombies', async () => {
    const { page } = await openWorld(browser);
    try {
      const bystander = await H.spawnTestZombie(page, 700, 3480, { maxHp: 10, speed: 0 });
      const before = await H.readGameState(page);
      const killedAt = Date.now();
      await killLocustAt(page, 700, 3380);

      await page.waitForTimeout(300);
      const early = await H.readGameState(page);
      assert.equal(early.hp, before.hp, 'the blast is delayed, not instant');
      assert.equal((await H.readTestZombie(page, bystander)).hp, 10);

      await waitForHp(page, before.hp - 20);
      const elapsed = Date.now() - killedAt;
      assert.ok(elapsed >= 500, `the blast waits for the fast death clip (${elapsed}ms)`);
      assert.ok(elapsed <= 1100, `the blast lands around 0.625s (${elapsed}ms)`);

      const blast = await H.readGameState(page);
      assert.equal(blast.hp, before.hp - 20, 'the blast deals exactly 20');
      const zombie = await H.readTestZombie(page, bystander);
      assert.equal(zombie.hp, 10, 'zombies inside the radius are untouched');
      assert.equal(zombie.dead, false);

      await page.waitForTimeout(1400);
      assert.equal((await H.readGameState(page)).hp, before.hp - 20, 'only one blast per locust');
      assert.equal((await H.readTestZombie(page, bystander)).hp, 10);
    } finally {
      await H.disposePage(page);
    }
  });

  test('E2 a locust dying outside the radius never hurts the player', async () => {
    const { page } = await openWorld(browser);
    try {
      const before = await H.readGameState(page);
      await killLocustAt(page, SPAWN.x + 280, SPAWN.y);
      await page.waitForTimeout(1700);
      assert.equal((await H.readGameState(page)).hp, before.hp);
    } finally {
      await H.disposePage(page);
    }
  });

  test('E3 self-destruct enters the death flow with no touch damage and no reward', async () => {
    const { page } = await openWorld(browser);
    try {
      const before = await H.readGameState(page);
      const index = await H.spawnTestLocust(page, SPAWN.x + 200, SPAWN.y, { speed: 0 });
      const occupied = await H.readGameState(page);
      assert.equal(occupied.population.used, before.population.used + 1);

      // Touch it only after the occupancy read so the assertion is not raced.
      await H.teleportPlayer(page, SPAWN.x + 200, SPAWN.y);
      await page.waitForFunction(
        (i) => {
          const locust = (window.__testLocusts || [])[i];
          return locust && locust.dead === true;
        },
        index,
        { timeout: 3000, polling: 20 },
      );

      const touched = await H.readGameState(page);
      const corpse = await H.readTestLocust(page, index);
      assert.equal(touched.hp, before.hp, 'touching a locust no longer deals 10');
      assert.equal(touched.xp, before.xp, 'self-destruct pays no XP');
      assert.equal(touched.population.used, before.population.used, 'the slot frees instantly');
      assert.equal(touched.aliveZombies, 0);
      assert.equal(corpse.active, true, 'the corpse runs the death flow');
      assert.equal(corpse.textureKey, 'locust-death-sheet');
      assert.equal(corpse.anim, 'locust-death');

      await waitForHp(page, before.hp - 20);
      // The fast death clip drops a puddle where the player stood; step out
      // before it lands so its drain cannot mask the one-blast assertion.
      await H.teleportPlayer(page, SPAWN.x, SPAWN.y);
      await page.waitForTimeout(1300);
      assert.equal((await H.readGameState(page)).hp, before.hp - 20, 'one blast only');
    } finally {
      await H.disposePage(page);
    }
  });

  test('E4 walking out of the radius before the blast dodges the damage', async () => {
    const { page } = await openWorld(browser);
    try {
      const before = await H.readGameState(page);
      const index = await H.spawnTestLocust(page, SPAWN.x, SPAWN.y, { speed: 0 });
      await page.waitForFunction(
        (i) => {
          const locust = (window.__testLocusts || [])[i];
          return locust && locust.dead === true;
        },
        index,
        { timeout: 3000, polling: 20 },
      );

      await H.teleportPlayer(page, SPAWN.x + 300, SPAWN.y);
      await page.waitForTimeout(1800);
      assert.equal((await H.readGameState(page)).hp, before.hp, 'the dodge window is real');
    } finally {
      await H.disposePage(page);
    }
  });
});
