'use strict';

/**
 * Acceptance suite for the 180-second survival goal.
 *
 * S1 the HUD shows a 3:00 countdown that ticks with game time and stops while
 *    the scene is paused.
 * S2 reaching zero with HP left ends the run as a victory.
 * S3 dying before the countdown ends the run as a defeat.
 * S4 a death and the countdown expiring in the same frame resolve as a defeat
 *    and never flip to victory afterwards.
 * S5 the result panel shows the outcome and survival time, freezes the run and
 *    resets the countdown on restart.
 * S6 the dev console ends a run as a defeat and can force a victory.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness.js');

const PORT = Number(process.env.ACCEPTANCE_SURVIVAL_PORT || 5220);
const URL = `http://127.0.0.1:${PORT}/`;

const GOAL_MS = 180000;

async function openWorld(browser) {
  const { page } = await H.openGameWithStart(browser, URL);
  await H.clearZombies(page, { pause: true });
  return page;
}

function waitForOver(page) {
  return page.waitForFunction(
    () => window.game.scene.getScene('world').gameOver === true,
    null,
    { timeout: 5000, polling: 20 },
  );
}

async function restart(page) {
  const button = await H.canvasPoint(page, H.GAME_WIDTH / 2, H.GAME_HEIGHT / 2 + 90);
  await page.mouse.click(button.x, button.y);
  await H.waitForWorld(page);
}

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatCountdown(ms) {
  const totalSeconds = Math.ceil(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

describe('survival goal acceptance', () => {
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

  test('S1 the run starts on a 3:00 countdown that ticks and pauses', async () => {
    const page = await openWorld(browser);
    try {
      const start = await H.readGameState(page);
      assert.equal(start.hud.time, '3:00', 'the countdown starts at three minutes');
      assert.ok(
        start.remainingMs <= GOAL_MS && start.remainingMs > GOAL_MS - 2000,
        `remaining time starts at the goal (${start.remainingMs})`,
      );

      await page.waitForTimeout(1500);
      const ticking = await H.readGameState(page);
      const tickedBy = start.remainingMs - ticking.remainingMs;
      assert.ok(tickedBy >= 600 && tickedBy <= 3500, `the countdown ticks with game time (${tickedBy}ms)`);
      assert.equal(ticking.hud.time, formatCountdown(ticking.remainingMs));

      await page.evaluate(() => window.game.scene.pause('world'));
      await H.frames(page, 2);
      const paused = await H.readGameState(page);
      await page.waitForTimeout(600);
      const stillPaused = await H.readGameState(page);
      assert.equal(
        stillPaused.remainingMs,
        paused.remainingMs,
        'the countdown must not move while the scene is paused',
      );
      await page.evaluate(() => window.game.scene.resume('world'));
      await H.frames(page, 2);
    } finally {
      await H.disposePage(page);
    }
  });

  test('S2 reaching zero while alive ends the run as a victory', async () => {
    const page = await openWorld(browser);
    try {
      await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        scene.remainingMs = 10;
        scene.hud.setTime(scene.formatTime(scene.remainingMs));
      });
      await waitForOver(page);
      await H.frames(page, 3);

      const over = await H.readGameState(page);
      assert.equal(over.result, 'victory');
      assert.equal(over.gameOver, true);
      assert.equal(over.paused, true, 'physics pauses on victory');
      assert.equal(over.spawnTimerActive, false, 'spawning stops on victory');
      assert.equal(over.remainingMs, 0);
      assert.equal(over.hud.time, '0:00');
      assert.ok(over.overlay.includes('胜利'), 'the result panel announces the victory');
      assert.ok(over.overlay.includes('存活时间 3:00'), 'a victory reports the full target duration');
      assert.ok(over.overlay.includes('再来一局'));
      assert.equal(
        over.overlay.some((text) => text.includes('金钱')),
        false,
        'the result panel no longer reports gold',
      );
      assert.equal(over.overlayAllFixed, true);
    } finally {
      await H.disposePage(page);
    }
  });

  test('S3 dying before zero ends the run as a defeat', async () => {
    const page = await openWorld(browser);
    try {
      const survival = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        scene.elapsedMs = 92000;
        scene.remainingMs = 88000;
        scene.hud.setTime(scene.formatTime(scene.remainingMs));
        scene.handlePlayerHit(scene.maxHp);
        return { elapsedMs: scene.elapsedMs, hp: scene.hp };
      });
      assert.equal(survival.hp, 0);
      await waitForOver(page);
      await H.frames(page, 3);

      const over = await H.readGameState(page);
      assert.equal(over.result, 'defeat');
      assert.ok(over.overlay.includes('失败'), 'the result panel announces the defeat');
      assert.ok(
        over.overlay.includes(`存活时间 ${formatTime(92000)}`),
        'a defeat reports the actual survival time',
      );
      assert.equal(over.overlay.some((text) => text.includes('金钱')), false);
      assert.ok(over.overlay.includes('再来一局'));
    } finally {
      await H.disposePage(page);
    }
  });

  test('S4 a same-frame death and timeout resolve as a defeat and never flip', async () => {
    const page = await openWorld(browser);
    try {
      const outcome = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        scene.remainingMs = 0;
        scene.hp = 1;
        scene.hud.setHp(scene.hp, scene.maxHp);
        // Death and the countdown expiring land in the same frame.
        scene.handlePlayerHit(1);
        scene.winGame();
        return scene.result;
      });
      assert.equal(outcome, 'defeat', 'death has priority over the timeout');

      await waitForOver(page);
      await H.frames(page, 3);
      await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        scene.remainingMs = 0;
        scene.elapsedMs = 999999;
      });
      await H.frames(page, 5);

      const over = await H.readGameState(page);
      assert.equal(over.result, 'defeat', 'the result must not flip to victory later');
      assert.ok(over.overlay.includes('失败'));
      assert.equal(over.overlay.includes('胜利'), false);
    } finally {
      await H.disposePage(page);
    }
  });

  test('S5 the result freezes the run and restart resets the countdown and progress', async () => {
    const page = await openWorld(browser);
    try {
      await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        scene.elapsedMs = 30000;
        scene.remainingMs = 150000;
        scene.hud.setTime(scene.formatTime(scene.remainingMs));
        scene.level = 4;
        scene.xp = 120;
        scene.upgradePoints = 3;
        scene.handlePlayerHit(scene.maxHp);
      });
      await waitForOver(page);
      await H.frames(page, 3);

      const frozen = await H.readGameState(page);
      await page.waitForTimeout(600);
      const later = await H.readGameState(page);
      assert.equal(later.remainingMs, frozen.remainingMs, 'the countdown freezes after the result');
      assert.equal(later.hud.time, frozen.hud.time);
      assert.equal(later.elapsedMs, frozen.elapsedMs);
      assert.equal(frozen.result, 'defeat');

      await restart(page);
      const after = await H.readGameState(page);
      assert.equal(after.gameOver, false);
      assert.equal(after.result, null);
      assert.equal(after.paused, false);
      assert.equal(after.hp, 648);
      assert.equal(after.level, 1);
      assert.equal(after.xp, 0);
      assert.equal(after.upgradePoints, 0);
      assert.equal(after.hud.time, '3:00', 'the countdown resets to three minutes');
      assert.ok(
        after.remainingMs <= GOAL_MS && after.remainingMs > GOAL_MS - 2000,
        'the reset countdown starts at the goal',
      );
      assert.ok(
        !after.overlay.includes('失败') && !after.overlay.includes('胜利'),
        'the result panel is gone after a restart',
      );
    } finally {
      await H.disposePage(page);
    }
  });

  test('S6 the dev console ends as a defeat and can force a victory', async () => {
    const defeatPage = await openWorld(browser);
    try {
      await defeatPage.evaluate(() => {
        window.game.scene.getScene('world').devConsole.run('end');
      });
      await H.frames(defeatPage, 3);
      const over = await H.readGameState(defeatPage);
      assert.equal(over.result, 'defeat');
      assert.ok(over.overlay.includes('失败'));
    } finally {
      await H.disposePage(defeatPage);
    }

    const victoryPage = await openWorld(browser);
    try {
      await victoryPage.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        scene.remainingMs = 60000;
        scene.devConsole.run('win');
      });
      await H.frames(victoryPage, 3);
      const over = await H.readGameState(victoryPage);
      assert.equal(over.result, 'victory');
      assert.equal(over.elapsedMs, GOAL_MS, 'the forced victory snaps the run time to the goal');
      assert.equal(over.remainingMs, 0);
      assert.equal(over.hud.time, '0:00');
      assert.ok(over.overlay.includes('胜利'));
      assert.ok(over.overlay.includes('存活时间 3:00'));
    } finally {
      await H.disposePage(victoryPage);
    }
  });
});