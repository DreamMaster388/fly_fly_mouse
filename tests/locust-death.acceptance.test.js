'use strict';

/**
 * Acceptance suite for ticket 02 — locust death animation.
 *
 * The locust is killed by a weapon, so the weapon-kill path is exercised by a
 * lethal `takeDamage`. The death sheet was split from the first three seconds
 * of 蝗虫死亡与粘液动画.mp4: 37 frames of 456x260 at 24fps (about 1.5s).
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness.js');

const PORT = Number(process.env.ACCEPTANCE_LOCUST_DEATH_PORT || 5207);
const URL = `http://127.0.0.1:${PORT}/`;

async function openWorld(browser) {
  const { page, errors } = await H.openGameWithStart(browser, URL);
  await H.clearZombies(page, { pause: true });
  await H.stopRefill(page);
  return { page, errors };
}

async function spawnStillLocust(page) {
  return H.spawnTestLocust(page, 900, 3380, { speed: 0 });
}

async function waitForCorpseGone(page, index, timeout = 6000) {
  await page.waitForFunction(
    (i) => {
      const locust = (window.__testLocusts || [])[i];
      return !locust || locust.gameObject.active === false;
    },
    index,
    { timeout, polling: 50 },
  );
}

describe('locust death animation acceptance', () => {
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

  test('D1 a kill plays the 37-frame death sheet once, in place and at the standing scale', async () => {
    const { page } = await openWorld(browser);
    try {
      const index = await spawnStillLocust(page);
      const alive = await H.readTestLocust(page, index);
      assert.equal(alive.textureKey, 'locust-walk-sheet');
      assert.equal(alive.dead, false);
      const standingScale = alive.scaleX;

      // Kill and sample in one evaluate so the clip is caught on its first frame.
      const death = await page.evaluate((i) => {
        const locust = window.__testLocusts[i];
        const go = locust.gameObject;
        const origin = { x: go.x, y: go.y };
        locust.takeDamage(9999);
        const anims = go.anims;
        const current = anims.currentAnim;
        return {
          hp: locust.hp,
          dead: locust.dead,
          bodyEnabled: locust.body.enable,
          velocity: { x: locust.body.velocity.x, y: locust.body.velocity.y },
          textureKey: go.texture.key,
          anim: current ? current.key : null,
          animRepeat: current ? current.repeat : null,
          animFrames: current ? current.frames.length : null,
          animFrameRate: current ? current.frameRate : null,
          playing: anims.isPlaying,
          frame: anims.currentFrame ? anims.currentFrame.index : null,
          x: go.x,
          y: go.y,
          scaleX: go.scaleX,
          scaleY: go.scaleY,
          origin,
        };
      }, index);

      assert.equal(death.dead, true);
      assert.equal(death.hp, 0);
      assert.equal(death.bodyEnabled, false, 'the corpse stops colliding instantly');
      assert.deepEqual(death.velocity, { x: 0, y: 0 }, 'the corpse stops moving instantly');
      assert.equal(death.textureKey, 'locust-death-sheet');
      assert.equal(death.anim, 'locust-death');
      assert.equal(death.animRepeat, 0, 'the death clip must not loop');
      assert.equal(death.animFrames, 37);
      assert.equal(death.animFrameRate, 24);
      assert.equal(death.playing, true);
      assert.equal(death.frame, 1, 'the death clip starts on its first frame (1-based)');
      assert.deepEqual(
        { x: death.x, y: death.y },
        death.origin,
        'the corpse stays where the locust died',
      );
      assert.equal(death.scaleX, standingScale, 'the corpse keeps the standing scale');
      assert.equal(death.scaleY, alive.scaleY);

      await page.waitForTimeout(300);
      const advanced = await H.readTestLocust(page, index);
      assert.ok(advanced.frame > death.frame, `frames advance (${advanced.frame} > ${death.frame})`);
      assert.equal(advanced.active, true, 'the corpse is still on screen mid-clip');

      const startedAt = Date.now();
      await waitForCorpseGone(page, index);
      const elapsed = Date.now() - startedAt + 300;
      assert.ok(elapsed >= 1300, `the 37 frames last about 1.5 seconds (${elapsed}ms)`);
      assert.ok(elapsed <= 2300, `the death clip is not slower than 24fps (${elapsed}ms)`);
      const gone = await H.readTestLocust(page, index);
      assert.equal(gone.active, false);
      assert.equal(gone.destroyed, true, 'the corpse is removed when the clip ends');
    } finally {
      await H.disposePage(page);
    }
  });

  test('D2 gold, XP and the population slot are settled at the death instant', async () => {
    const { page } = await openWorld(browser);
    try {
      const before = await H.readGameState(page);
      const index = await spawnStillLocust(page);
      const occupied = await H.readGameState(page);
      assert.equal(occupied.population.used, before.population.used + 1);

      await H.callTestLocust(page, index, 'takeDamage', 6);
      const after = await H.readGameState(page);
      const corpse = await H.readTestLocust(page, index);

      assert.equal(after.gold, before.gold + 10, 'the locust drops its 10 gold');
      assert.equal(after.level, before.level);
      assert.equal(after.xp, before.xp + 30, 'the locust grants its 30 XP');
      assert.equal(after.population.used, before.population.used, 'the slot frees instantly');
      assert.equal(after.aliveZombies, 0, 'the dying corpse is no longer a live target');
      assert.equal(corpse.active, true, 'the corpse animates after the payout');
    } finally {
      await H.disposePage(page);
    }
  });

  test('D3 a corpse cannot be hit again or hurt the player standing on it', async () => {
    const { page } = await openWorld(browser);
    try {
      const before = await H.readGameState(page);
      const index = await spawnStillLocust(page);
      await H.callTestLocust(page, index, 'takeDamage', 6);

      const settled = await H.readGameState(page);
      assert.equal(settled.aliveZombies, 0);
      assert.equal(settled.hp, before.hp, 'no instant contact damage');

      await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        const player = scene.player;
        const dx = player.body.center.x - player.gameObject.x;
        const dy = player.body.center.y - player.gameObject.y;
        player.body.reset(900 - dx, 3380 - dy);
        player.body.updateFromGameObject();
      });
      await page.waitForTimeout(500);

      const near = await H.readGameState(page);
      assert.equal(near.hp, before.hp, 'standing on a corpse deals no damage');

      await H.callTestLocust(page, index, 'takeDamage', 2);
      const corpse = await H.readTestLocust(page, index);
      assert.equal(corpse.hp, 0, 'the corpse cannot be damaged again');
      assert.equal(corpse.dead, true);
      assert.equal((await H.readGameState(page)).gold, before.gold + 10, 'no double reward');
    } finally {
      await H.disposePage(page);
    }
  });
});
