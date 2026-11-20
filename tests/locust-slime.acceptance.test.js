'use strict';

/**
 * Acceptance suite for ticket 04 — slime spawn and lifetime.
 *
 * The slime sheet was split from 蝗虫死亡与粘液动画.mp4 (3s-6s): 37 frames of
 * 392x90 at 12fps, looped. A slime only appears after the death clip, lives
 * 30s, fades out, never blocks movement and never joins the population.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness.js');

const PORT = Number(process.env.ACCEPTANCE_LOCUST_SLIME_PORT || 5209);
const URL = `http://127.0.0.1:${PORT}/`;

const SPAWN = { x: 620, y: 3380 };
const LOCUST_AT = { x: 700, y: 3380 };

async function openWorld(browser, { pause = true } = {}) {
  const { page, errors } = await H.openGameWithStart(browser, URL);
  await H.clearZombies(page, { pause });
  await H.stopRefill(page);
  return { page, errors };
}

async function killLocustAt(page, x, y) {
  const index = await H.spawnTestLocust(page, x, y, { speed: 0 });
  const deathPoint = await page.evaluate((i) => {
    const locust = window.__testLocusts[i];
    locust.takeDamage(9999);
    return { ...locust.deathPoint };
  }, index);
  return { index, deathPoint };
}

async function waitForSlimeCount(page, count, timeout = 7000) {
  await page.waitForFunction(
    (n) => {
      const field = window.game.scene.getScene('world').slimes;
      return field && field.items.length === n;
    },
    count,
    { timeout, polling: 30 },
  );
}

describe('locust slime acceptance', () => {
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

  test('S1 a finished death clip drops one looping slime at the death point', async () => {
    const { page } = await openWorld(browser);
    try {
      const killedAt = Date.now();
      const { deathPoint } = await killLocustAt(page, LOCUST_AT.x, LOCUST_AT.y);

      await page.waitForTimeout(700);
      assert.deepEqual(await H.readSlimes(page), [], 'no slime while the corpse animates');

      await waitForSlimeCount(page, 1);
      const appearedAt = Date.now() - killedAt;
      assert.ok(appearedAt >= 1300, `the slime waits for the fast death clip (${appearedAt}ms)`);
      assert.ok(appearedAt <= 2300, `the slime follows the 24fps death clip (${appearedAt}ms)`);

      const [slime] = await H.readSlimes(page);
      assert.ok(Math.abs(slime.x - deathPoint.x) < 0.5, 'the slime sits on the death point');
      assert.ok(Math.abs(slime.y - deathPoint.y) < 0.5);
      assert.equal(slime.textureKey, 'locust-slime-sheet');
      assert.equal(slime.anim, 'locust-slime');
      assert.equal(slime.animRepeat, -1, 'the puddle loops forever');
      assert.equal(slime.animFrames, 37);
      assert.equal(slime.animFrameRate, 12);
      assert.equal(slime.hasBody, false, 'the slime has no physics body');
      assert.equal(slime.active, true);

      await page.waitForTimeout(300);
      const [advanced] = await H.readSlimes(page);
      assert.ok(advanced.frame > slime.frame, 'the slime animation advances');
      assert.equal((await H.readSlimes(page)).length, 1, 'one death drops exactly one slime');

      await H.teleportPlayer(page, SPAWN.x + 700, SPAWN.y);
      await page.waitForTimeout(600);
      const far = await H.readSlimes(page);
      assert.equal(far.length, 1, 'walking away does not remove the slime early');
      assert.equal(far[0].active, true);
    } finally {
      await H.disposePage(page);
    }
  });

  test('S2 the slime never blocks movement and expires after its lifetime', async () => {
    const { page } = await openWorld(browser, { pause: false });
    try {
      await killLocustAt(page, LOCUST_AT.x, LOCUST_AT.y);
      await waitForSlimeCount(page, 1);

      await H.teleportPlayer(page, LOCUST_AT.x - 100, LOCUST_AT.y);
      await page.keyboard.down('ArrowRight');
      await page.waitForTimeout(700);
      await page.keyboard.up('ArrowRight');
      await H.frames(page, 2);

      const crossed = await page.evaluate(() => {
        const body = window.game.scene.getScene('world').player.body;
        return { x: body.center.x, y: body.center.y };
      });
      assert.ok(
        crossed.x > LOCUST_AT.x,
        `the player walks through the puddle (${crossed.x.toFixed(1)})`,
      );

      await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        scene.time.timeScale = 100;
        scene.tweens.timeScale = 100;
      });
      await page.waitForFunction(
        () => {
          const field = window.game.scene.getScene('world').slimes;
          return field && field.items.length === 0;
        },
        null,
        { timeout: 5000, polling: 30 },
      );
      await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        scene.time.timeScale = 1;
        scene.tweens.timeScale = 1;
      });
      assert.deepEqual(await H.readSlimes(page), [], 'the slime fades out at the end of its life');
    } finally {
      await H.disposePage(page);
    }
  });
});
