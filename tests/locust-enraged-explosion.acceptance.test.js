'use strict';

/**
 * Acceptance suite for ticket 03 — enraged death explosion.
 *
 * An enraged locust's blast deals 40 to the player inside 120px after the
 * usual 625ms delay, whether it was killed by a weapon or self-destructed on
 * contact. Normal locusts still deal 20, the blast never hurts other enemies,
 * and the corpse still leaves the unchanged slime puddle.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness.js');

const PORT = Number(process.env.ACCEPTANCE_LOCUST_ENRAGED_EXPLOSION_PORT || 5212);
const URL = `http://127.0.0.1:${PORT}/`;

const SPAWN = { x: 620, y: 3380 };
const LOCUST = { x: 900, y: 3380 };

async function openWorld(browser) {
  const { page, errors } = await H.openGameWithStart(browser, URL);
  await H.clearZombies(page, { pause: true });
  await H.stopRefill(page);
  return { page, errors };
}

async function waitForAngryWalk(page, index, timeout = 7000) {
  await page.waitForFunction(
    ([i, k]) => {
      const locust = (window.__testLocusts || [])[i];
      const anims = locust && locust.gameObject && locust.gameObject.anims;
      return !!anims && !!anims.currentAnim && anims.currentAnim.key === k;
    },
    [index, 'locust-angry-walk'],
    { timeout, polling: 20 },
  );
}

async function waitForHp(page, hp, timeout = 5000) {
  await page.waitForFunction(
    (target) => window.game.scene.getScene('world').hp === target,
    hp,
    { timeout, polling: 20 },
  );
}

async function waitForDeath(page, index, timeout = 3000) {
  await page.waitForFunction(
    (i) => {
      const locust = (window.__testLocusts || [])[i];
      return !!locust && locust.dead === true;
    },
    index,
    { timeout, polling: 20 },
  );
}

describe('enraged locust explosion acceptance', () => {
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

  test('X1 an enraged weapon kill deals 40 after the delay and spares other enemies', async () => {
    const { page } = await openWorld(browser);
    try {
      const before = await H.readGameState(page);
      const bystanderZombie = await H.spawnTestZombie(page, LOCUST.x + 60, LOCUST.y + 100, {
        maxHp: 10,
        speed: 0,
      });
      const bystanderLocust = await H.spawnTestLocust(page, LOCUST.x - 60, LOCUST.y, {
        speed: 0,
      });
      const index = await H.spawnTestLocust(page, LOCUST.x, LOCUST.y, { speed: 0 });
      await H.teleportPlayer(page, LOCUST.x + 100, LOCUST.y);
      await H.callTestLocust(page, index, 'beginEnrage');

      await waitForAngryWalk(page, index);
      assert.equal((await H.readTestLocust(page, index)).enraged, true);

      const killedAt = Date.now();
      await H.callTestLocust(page, index, 'takeDamage', 9999);

      await page.waitForTimeout(300);
      assert.equal((await H.readGameState(page)).hp, before.hp, 'the blast is delayed');

      await waitForHp(page, before.hp - 40);
      const elapsed = Date.now() - killedAt;
      assert.ok(elapsed >= 500, `the blast still waits for the death clip (${elapsed}ms)`);
      assert.ok(elapsed <= 1200, `the blast lands around 0.625s (${elapsed}ms)`);

      assert.equal((await H.readGameState(page)).hp, before.hp - 40, 'exactly 40 damage');
      assert.equal((await H.readTestZombie(page, bystanderZombie)).hp, 10, 'zombies are untouched');
      const other = await H.readTestLocust(page, bystanderLocust);
      assert.equal(other.hp, 6, 'other locusts are untouched');
      assert.equal(other.dead, false);

      await page.waitForTimeout(1400);
      assert.equal((await H.readGameState(page)).hp, before.hp - 40, 'one blast only');
    } finally {
      await H.disposePage(page);
    }
  });

  test('X2 an enraged self-destruct deals 40 with no reward', async () => {
    const { page } = await openWorld(browser);
    try {
      const before = await H.readGameState(page);
      const index = await H.spawnTestLocust(page, LOCUST.x, LOCUST.y, { speed: 0 });
      await H.callTestLocust(page, index, 'beginEnrage');
      await waitForAngryWalk(page, index);

      const occupied = await H.readGameState(page);
      assert.equal(occupied.population.used, before.population.used + 1);

      await H.teleportPlayer(page, LOCUST.x, LOCUST.y);
      await waitForDeath(page, index);

      const touched = await H.readGameState(page);
      assert.equal(touched.hp, before.hp, 'contact itself deals no damage');
      assert.equal(touched.xp, before.xp, 'self-destruct pays no XP');
      assert.equal(touched.population.used, before.population.used, 'the slot frees instantly');
      assert.equal(touched.aliveZombies, 0);
      const corpse = await H.readTestLocust(page, index);
      assert.equal(corpse.active, true);
      assert.equal(corpse.anim, 'locust-death');

      await waitForHp(page, before.hp - 40);
      await H.teleportPlayer(page, SPAWN.x, SPAWN.y);
      await page.waitForTimeout(1300);
      assert.equal((await H.readGameState(page)).hp, before.hp - 40, 'one 40 blast only');
    } finally {
      await H.disposePage(page);
    }
  });

  test('X3 a normal locust still deals 20', async () => {
    const { page } = await openWorld(browser);
    try {
      const before = await H.readGameState(page);
      const index = await H.spawnTestLocust(page, LOCUST.x, LOCUST.y, { speed: 0 });
      await H.teleportPlayer(page, LOCUST.x + 100, LOCUST.y);

      await H.callTestLocust(page, index, 'takeDamage', 6);
      const corpse = await H.readTestLocust(page, index);
      assert.equal(corpse.enraged, false);

      await waitForHp(page, before.hp - 20);
      assert.equal((await H.readGameState(page)).hp, before.hp - 20);
    } finally {
      await H.disposePage(page);
    }
  });

  test('X4 an enraged blast outside the radius never hurts the player', async () => {
    const { page } = await openWorld(browser);
    try {
      const before = await H.readGameState(page);
      const index = await H.spawnTestLocust(page, LOCUST.x, LOCUST.y, { speed: 0 });
      await H.teleportPlayer(page, LOCUST.x + 300, LOCUST.y);
      await H.callTestLocust(page, index, 'beginEnrage');

      await waitForAngryWalk(page, index);
      await H.callTestLocust(page, index, 'takeDamage', 9999);
      await page.waitForTimeout(1500);
      assert.equal((await H.readGameState(page)).hp, before.hp);
    } finally {
      await H.disposePage(page);
    }
  });

  test('X5 an enraged death still leaves a slime puddle that stacks', async () => {
    const { page } = await openWorld(browser);
    try {
      const index = await H.spawnTestLocust(page, LOCUST.x, LOCUST.y, { speed: 0 });
      await H.teleportPlayer(page, LOCUST.x + 300, LOCUST.y);
      await H.callTestLocust(page, index, 'beginEnrage');
      await waitForAngryWalk(page, index);
      await H.callTestLocust(page, index, 'takeDamage', 9999);

      await page.waitForFunction(
        (i) => {
          const locust = (window.__testLocusts || [])[i];
          return !locust || locust.gameObject.active === false;
        },
        index,
        { timeout: 6000, polling: 50 },
      );

      const slimes = await H.readSlimes(page);
      assert.equal(slimes.length, 1, 'the corpse left one puddle');
      assert.equal(slimes[0].textureKey, 'locust-slime-sheet');
      assert.equal(slimes[0].anim, 'locust-slime');
      assert.equal(slimes[0].active, true);

      await H.teleportPlayer(page, slimes[0].x, slimes[0].y);
      await page.waitForFunction(
        () => window.game.scene.getScene('world').slimeStacks >= 1,
        null,
        { timeout: 4000, polling: 20 },
      );
      const dot = await H.readSlimeDotState(page);
      assert.equal(dot.stacks, 1, 'stepping on the puddle adds one stack');
    } finally {
      await H.disposePage(page);
    }
  });
});
