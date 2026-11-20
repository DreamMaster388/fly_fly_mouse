'use strict';

/**
 * Acceptance suite for ticket 05 — slime stacks and permanent drain.
 *
 * Touching a puddle stacks once immediately and again only after that puddle's
 * 1s cooldown; different puddles cooldown independently but share one global
 * stack count. Every stack drains 1 HP per second, forever, until the run is
 * restarted. A lethal tick ends the run through the existing game-over flow.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness.js');

const PORT = Number(process.env.ACCEPTANCE_SLIME_DOT_PORT || 5210);
const URL = `http://127.0.0.1:${PORT}/`;

const SPAWN = { x: 620, y: 3380 };
const A = { x: 900, y: 3380 };
const B = { x: 1100, y: 3380 };

async function openWorld(browser) {
  const { page } = await H.openGameWithStart(browser, URL);
  await H.clearZombies(page);
  await H.stopRefill(page);
  return page;
}

async function dropPuddles(page, points) {
  const indices = [];
  for (const point of points) {
    indices.push(await H.spawnTestLocust(page, point.x, point.y, { speed: 0 }));
  }
  return page.evaluate((list) => {
    const points = list.map((i) => {
      const locust = window.__testLocusts[i];
      locust.takeDamage(9999);
      return { ...locust.deathPoint };
    });
    return points;
  }, indices);
}

async function waitForSlimeCount(page, count, timeout = 8000) {
  await page.waitForFunction(
    (n) => {
      const field = window.game.scene.getScene('world').slimes;
      return field && field.items.length === n;
    },
    count,
    { timeout, polling: 30 },
  );
}

async function waitForStacks(page, count, timeout = 3000) {
  await page.waitForFunction(
    (n) => window.game.scene.getScene('world').slimeStacks === n,
    count,
    { timeout, polling: 30 },
  );
}

describe('slime stacks acceptance', () => {
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

  test('P1 a puddle stacks on entry, once per second, independently per puddle', async () => {
    const page = await openWorld(browser);
    try {
      await dropPuddles(page, [A, B]);
      await waitForSlimeCount(page, 2);

      const initial = await H.readSlimeDotState(page);
      assert.equal(initial.stacks, 0, 'no stacks before touching any puddle');
      assert.equal(initial.hp, initial.maxHp);

      await H.teleportPlayer(page, A.x, A.y);
      assert.equal((await H.readSlimeDotState(page)).stacks, 1, 'entry stacks at once');

      await page.waitForTimeout(400);
      assert.equal((await H.readSlimeDotState(page)).stacks, 1, 'the same puddle is on cooldown');

      await H.teleportPlayer(page, B.x, B.y);
      assert.equal(
        (await H.readSlimeDotState(page)).stacks,
        2,
        'a different puddle has its own cooldown and shares the stack count',
      );

      await waitForStacks(page, 3, 2500);
      assert.equal(
        (await H.readSlimeDotState(page)).stacks,
        3,
        'standing in a puddle restacks once its second is up',
      );
      assert.equal((await H.readSlimes(page)).length, 2, 'stacking never consumes the puddles');
    } finally {
      await H.disposePage(page);
    }
  });

  test('P2 every stack drains 1 HP/s with a flash, and stacks outlive the puddle', async () => {
    const page = await openWorld(browser);
    try {
      await dropPuddles(page, [A]);
      await waitForSlimeCount(page, 1);

      const calm = await H.readSlimeDotState(page);
      await page.waitForTimeout(1300);
      const stillCalm = await H.readSlimeDotState(page);
      assert.equal(stillCalm.stacks, 0);
      assert.equal(stillCalm.hp, calm.hp, 'zero stacks never tick');

      await H.teleportPlayer(page, A.x, A.y);
      await waitForStacks(page, 2, 2500);
      assert.equal((await H.readSlimeDotState(page)).stacks, 2, 'the puddle restacks after 1s');

      await H.teleportPlayer(page, SPAWN.x, SPAWN.y);
      const trace = await H.traceSlimeDot(page, 2200);
      assert.ok(
        trace.drops.length >= 2 && trace.drops.length <= 3,
        `2.2s contains two or three ticks (${trace.drops.length})`,
      );
      for (const drop of trace.drops) {
        assert.equal(drop, 2, 'each tick drains exactly one HP per stack');
      }
      assert.ok(trace.maxAlpha > 0, 'a red flash accompanies a tick');
      assert.ok(trace.flashes >= 2, `the flash appears once a second (${trace.flashes})`);

      const after = await H.readSlimeDotState(page);
      assert.equal(after.stacks, 2);
      assert.equal(after.hudHp, `${after.hp} / ${after.maxHp}`, 'the HUD tracks the drain');

      // Fast-forward the 30s puddle lifetime while damage keeps ticking.
      await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        scene.hp = 5000;
        scene.hud.setHp(5000, scene.maxHp);
        scene.time.timeScale = 100;
        scene.tweens.timeScale = 100;
      });
      await waitForSlimeCount(page, 0, 5000);
      await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        scene.time.timeScale = 1;
        scene.tweens.timeScale = 1;
        scene.hp = 200;
        scene.hud.setHp(200, scene.maxHp);
      });

      assert.deepEqual(await H.readSlimes(page), []);
      const persisted = await H.readSlimeDotState(page);
      assert.equal(persisted.stacks, 2, 'stacks survive the puddle');
      assert.equal(persisted.gameOver, false);

      const tail = await H.traceSlimeDot(page, 2100);
      assert.ok(tail.drops.length >= 1, 'the drain keeps ticking without any puddle');
      for (const drop of tail.drops) {
        assert.equal(drop, 2, 'stacks still drain one HP each per second');
      }
      assert.equal((await H.readSlimeDotState(page)).stacks, 2);
    } finally {
      await H.disposePage(page);
    }
  });

  test('P3 a lethal tick ends the run and stops all slime effects', async () => {
    const page = await openWorld(browser);
    try {
      await dropPuddles(page, [A]);
      await waitForSlimeCount(page, 1);

      await H.teleportPlayer(page, A.x, A.y);
      assert.equal((await H.readSlimeDotState(page)).stacks, 1);

      await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        scene.hp = 1;
        scene.hud.setHp(1, scene.maxHp);
      });
      await page.waitForFunction(() => window.game.scene.getScene('world').gameOver, null, {
        timeout: 3000,
        polling: 30,
      });

      const state = await H.readGameState(page);
      assert.equal(state.gameOver, true);
      assert.ok(state.overlay.includes('本局结束'), 'the existing game-over overlay appears');

      const dead = await H.readSlimeDotState(page);
      assert.equal(dead.hp, 0);
      assert.equal(dead.stacks, 1);

      await H.teleportPlayer(page, A.x, A.y);
      await page.waitForTimeout(1400);
      const after = await H.readSlimeDotState(page);
      assert.equal(after.hp, 0, 'no ticks after the run is over');
      assert.equal(after.stacks, 1, 'no stacking after the run is over');
      assert.equal(after.flashAlpha, 0, 'the flash is gone');
    } finally {
      await H.disposePage(page);
    }
  });
});
