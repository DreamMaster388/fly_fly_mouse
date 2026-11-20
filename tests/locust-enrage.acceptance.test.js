'use strict';

/**
 * Acceptance suite for the locust enrage transition and movement.
 *
 * Enrage is no longer self-triggered: the dog howl calls the same
 * `beginEnrage` entry (covered by tests/dog.acceptance.test.js). A locust that
 * is still in its normal state freezes, plays its 21-frame enrage transition
 * once, then walks with the 25-frame angry sheet at double speed and double
 * animation rate. Injury first cancels enrage forever.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness.js');

const PORT = Number(process.env.ACCEPTANCE_LOCUST_ENRAGE_PORT || 5211);
const URL = `http://127.0.0.1:${PORT}/`;

const IN_VIEW = { x: 900, y: 3380 };
const LAKE = { x: 950, y: 840 };
const LAKE_PLAYER = { x: 950, y: 1100 };
const WATER_SLOW = 0.55;

async function openWorld(browser) {
  const { page, errors } = await H.openGameWithStart(browser, URL);
  await H.clearZombies(page, { pause: true });
  await H.stopRefill(page);
  return { page, errors };
}

async function waitForAnim(page, index, key, timeout = 6000) {
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

async function readMotion(page, index) {
  return page.evaluate((i) => {
    const locust = (window.__testLocusts || [])[i];
    if (!locust) return null;
    const go = locust.gameObject;
    const anim = go.anims.currentAnim;
    const velocity = locust.body.velocity;
    const scene = window.game.scene.getScene('world');
    return {
      anim: anim ? anim.key : null,
      frames: anim ? anim.frames.length : null,
      frameRate: anim ? anim.frameRate : null,
      repeat: anim ? anim.repeat : null,
      velocity: Math.hypot(velocity.x, velocity.y),
      getSpeed: locust.getSpeed(),
      multiplier: scene.gameMap.speedMultiplierAt(
        locust.body.center.x,
        locust.body.center.y,
      ),
      center: { x: locust.body.center.x, y: locust.body.center.y },
      displayHeight: go.displayHeight,
      enraged: !!locust.enraged,
      enraging: !!locust.enraging,
    };
  }, index);
}

describe('locust enrage acceptance', () => {
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

  test('E1 a normal locust freezes in the transition, then walks angry', async () => {
    const { page } = await openWorld(browser);
    try {
      const index = await H.spawnTestLocust(page, IN_VIEW.x, IN_VIEW.y, { speed: 45 });
      const initial = await H.readTestLocust(page, index);
      assert.equal(initial.anim, 'locust-walk');
      assert.equal(initial.enraged, false);
      assert.ok(Math.abs(initial.displayHeight - 100) < 0.5, 'standing height stays 100');

      await H.callTestLocust(page, index, 'beginEnrage');
      const transition = await H.readTestLocust(page, index);
      assert.equal(transition.enraged, true);
      assert.equal(transition.enraging, true, 'the transition is running');
      assert.equal(transition.animFrames, 21);
      assert.equal(transition.animFrameRate, 12);
      assert.equal(transition.animRepeat, 0, 'the transition must not loop');
      assert.ok(Math.abs(transition.displayHeight - 100) < 0.5, 'the transition keeps the height');
      assert.deepEqual(transition.velocity, { x: 0, y: 0 }, 'the locust is frozen');

      await waitForAnim(page, index, 'locust-angry-walk');
      const angry = await H.readTestLocust(page, index);
      assert.equal(angry.enraged, true);
      assert.equal(angry.enraging, false);
      assert.equal(angry.animFrames, 25);
      assert.equal(angry.animFrameRate, 24, 'the angry walk animation rate doubles');
      assert.equal(angry.animRepeat, -1, 'the angry walk loops');
      assert.ok(Math.abs(angry.displayHeight - 100) < 0.5, 'the angry walk keeps the height');
    } finally {
      await H.disposePage(page);
    }
  });

  test('E2 an injured locust cannot be enraged', async () => {
    const { page } = await openWorld(browser);
    try {
      const index = await H.spawnTestLocust(page, IN_VIEW.x, IN_VIEW.y, { speed: 0 });
      await H.callTestLocust(page, index, 'takeDamage', 4);

      const hurt = await H.readTestLocust(page, index);
      assert.equal(hurt.injured, true);
      assert.equal(hurt.anim, 'locust-hurt');

      await H.callTestLocust(page, index, 'beginEnrage');
      await page.waitForTimeout(500);
      const after = await H.readTestLocust(page, index);
      assert.equal(after.enraged, false, 'an injured locust never enrages');
      assert.equal(after.enraging, false);
      assert.equal(after.injured, true);
      assert.equal(after.anim, 'locust-hurt');
    } finally {
      await H.disposePage(page);
    }
  });

  test('E3 a locust no longer enrages after staying in view', async () => {
    const { page } = await openWorld(browser);
    try {
      const index = await H.spawnTestLocust(page, IN_VIEW.x, IN_VIEW.y, { speed: 0 });
      await page.waitForTimeout(4500);
      const idle = await H.readTestLocust(page, index);
      assert.equal(idle.enraged, false, 'there is no automatic enrage');
      assert.equal(idle.enraging, false);
      assert.equal(idle.anim, 'locust-walk');
    } finally {
      await H.disposePage(page);
    }
  });

  test('E4 an enraged locust stays enraged when wounded again', async () => {
    const { page } = await openWorld(browser);
    try {
      const index = await H.spawnTestLocust(page, IN_VIEW.x, IN_VIEW.y, { speed: 45 });
      await H.callTestLocust(page, index, 'beginEnrage');
      await waitForAnim(page, index, 'locust-angry-walk');

      await H.callTestLocust(page, index, 'takeDamage', 4);
      const wounded = await H.readTestLocust(page, index);
      assert.equal(wounded.hp, 2);
      assert.equal(wounded.injured, false, 'enrage is terminal: no hurt downgrade');
      assert.equal(wounded.enraged, true);
      assert.equal(wounded.anim, 'locust-angry-walk');
      assert.equal(await H.callTestLocust(page, index, 'getSpeed'), 90, 'the double speed is kept');
    } finally {
      await H.disposePage(page);
    }
  });

  test('E5 a death during the transition interrupts the enrage animation', async () => {
    const { page } = await openWorld(browser);
    try {
      const index = await H.spawnTestLocust(page, IN_VIEW.x, IN_VIEW.y, { speed: 0 });
      await H.callTestLocust(page, index, 'beginEnrage');
      await waitForAnim(page, index, 'locust-enrage');

      await H.callTestLocust(page, index, 'takeDamage', 9999);
      const death = await H.readTestLocust(page, index);
      assert.equal(death.dead, true);
      assert.equal(death.textureKey, 'locust-death-sheet');
      assert.equal(death.anim, 'locust-death');

      await page.waitForTimeout(700);
      const later = await H.readTestLocust(page, index);
      assert.equal(later.dead, true);
      assert.equal(later.anim, 'locust-death', 'the transition must not resume over the death');
    } finally {
      await H.disposePage(page);
    }
  });

  test('E6 the double speed stacks with the water slow', async () => {
    const { page } = await openWorld(browser);
    try {
      await H.teleportPlayer(page, LAKE_PLAYER.x, LAKE_PLAYER.y);

      const index = await H.spawnTestLocust(page, LAKE.x, LAKE.y, { speed: 45 });
      await H.callTestLocust(page, index, 'beginEnrage');
      await waitForAnim(page, index, 'locust-angry-walk');

      const angry = await readMotion(page, index);
      assert.equal(angry.enraged, true);
      assert.equal(angry.anim, 'locust-angry-walk');
      assert.equal(angry.frameRate, 24);
      assert.equal(angry.multiplier, WATER_SLOW, 'the lake still slows the angry locust');
      assert.equal(angry.getSpeed, 90);
      assert.ok(
        Math.abs(angry.velocity - 90 * WATER_SLOW) < 1,
        `angry water speed is ${angry.velocity}`,
      );
    } finally {
      await H.disposePage(page);
    }
  });
});
