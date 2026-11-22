'use strict';

/**
 * Acceptance suite for the development-only test console.
 *
 * The console is enabled by CONSOLE.enabled (import.meta.env.DEV) and renders a
 * fixed panel in the top-right corner with buttons that drive the running world
 * scene: spawn/clear enemies, HP lock, heal, XP, defeat and victory.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness.js');

const PORT = Number(process.env.ACCEPTANCE_CONSOLE_PORT || 5196);
const URL = `http://127.0.0.1:${PORT}/`;

async function openWorld(browser) {
  const { page } = await H.openGameWithStart(browser, URL);
  await H.clearZombies(page, { pause: true });
  return page;
}

async function clickButton(page, id) {
  const point = await page.evaluate((buttonId) => {
    const entry = window.game.scene.getScene('world').devConsole.buttons.get(buttonId);
    if (!entry) throw new Error(`missing console button: ${buttonId}`);
    return {
      x: entry.rect.x + entry.rect.width / 2,
      y: entry.rect.y + entry.rect.height / 2,
    };
  }, id);
  const canvasPoint = await H.canvasPoint(page, point.x, point.y);
  await page.mouse.click(canvasPoint.x, canvasPoint.y);
  await H.frames(page, 2);
}

function readConsole(page) {
  return page.evaluate(() => {
    const scene = window.game.scene.getScene('world');
    const devConsole = scene.devConsole;
    if (!devConsole) return null;
    return {
      visible: devConsole.root.visible,
      depth: devConsole.root.depth,
      scrollFactor: [devConsole.root.scrollFactorX, devConsole.root.scrollFactorY],
      bounds: { ...devConsole.bounds },
      status: devConsole.statusText.text,
      ids: Array.from(devConsole.buttons.keys()),
      labels: Array.from(devConsole.buttons.values()).map((entry) => entry.text.text),
      active: Array.from(devConsole.buttons.values())
        .filter((entry) => entry.active)
        .map((entry) => entry.id),
      allFixed: Array.from(devConsole.buttons.values()).every(
        (entry) =>
          entry.rect.scrollFactorX === 0 &&
          entry.rect.scrollFactorY === 0 &&
          entry.text.scrollFactorX === 0 &&
          entry.text.scrollFactorY === 0,
      ),
      allInteractive: Array.from(devConsole.buttons.values()).every(
        (entry) => !!(entry.rect.input && entry.rect.input.enabled),
      ),
    };
  });
}

describe('dev console acceptance', () => {
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

  test('C1 the console switch defaults on and shows every test button', async () => {
    const page = await openWorld(browser);
    try {
      const enabled = await page.evaluate(async () => {
        const mod = await import('/src/config.js');
        return mod.CONSOLE.enabled;
      });
      assert.equal(enabled, true, 'the console switch defaults on');

      const view = await readConsole(page);
      assert.ok(view, 'the world scene creates the dev console');
      assert.equal(view.visible, true);
      assert.equal(view.depth, 1500);
      assert.deepEqual(view.scrollFactor, [0, 0]);

      const screen = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        return { width: scene.scale.width, height: scene.scale.height };
      });
      assert.equal(view.bounds.x + view.bounds.width, screen.width - 16, 'panel hugs the right edge');
      assert.equal(view.bounds.y, 16, 'panel hugs the top edge');
      assert.ok(view.bounds.y + view.bounds.height < screen.height - 114 - 8, 'panel clears the bottom bar');

      assert.deepEqual(view.ids, [
        'spawn',
        'clear',
        'hpLock',
        'heal',
        'xp',
        'end',
        'win',
      ]);
      assert.deepEqual(view.labels, [
        '刷出当前敌人',
        '清空场上敌人',
        '生命锁定：关',
        '回满生命',
        '经验 +500',
        '结束本局',
        '立即胜利',
      ]);
      assert.equal(view.status, '开发模式 · 仅测试用');
      assert.equal(view.allFixed, true, 'console elements ignore camera scroll');
      assert.equal(view.allInteractive, true, 'every button is clickable');
      assert.deepEqual(view.active, []);
    } finally {
      await H.disposePage(page);
    }
  });

  test('C2 spawn button adds one current-stage enemy immediately', async () => {
    const page = await openWorld(browser);
    try {
      const before = await H.readGameState(page);
      assert.equal(before.aliveZombies, 0);
      assert.equal(before.spawnTimerActive, false, 'the timer is stopped by the test setup');

      await clickButton(page, 'spawn');

      const after = await H.readGameState(page);
      assert.equal(after.aliveZombies, 1, 'one enemy appears without waiting for the spawn timer');
      assert.equal(after.population.used, 1);
      assert.equal(after.population.occupants, 1);
      assert.equal(after.spawnTimerActive, false);

      const view = await readConsole(page);
      assert.match(view.status, /已刷出：普通僵尸/);
    } finally {
      await H.disposePage(page);
    }
  });

  test('C3 HP lock blocks damage until unlocked, and heal restores full HP', async () => {
    const page = await openWorld(browser);
    try {
      await clickButton(page, 'hpLock');

      let view = await readConsole(page);
      assert.deepEqual(view.active, ['hpLock']);
      assert.equal(view.labels[2], '生命锁定：开');
      assert.match(view.status, /生命已锁定/);

      const locked = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        scene.handlePlayerHit(9999);
        return {
          hpLocked: scene.hpLocked,
          hp: scene.hp,
          hud: scene.hud.hpText.text,
        };
      });
      assert.equal(locked.hpLocked, true);
      assert.equal(locked.hp, 648, 'locked HP never drops');
      assert.equal(locked.hud, '648 / 648');
      assert.equal(await page.evaluate(() => window.game.scene.getScene('world').gameOver), false);

      await clickButton(page, 'hpLock');
      view = await readConsole(page);
      assert.deepEqual(view.active, []);
      assert.equal(view.labels[2], '生命锁定：关');
      assert.match(view.status, /生命已解锁/);

      const unlocked = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        scene.handlePlayerHit(100);
        return { hp: scene.hp, hud: scene.hud.hpText.text };
      });
      assert.equal(unlocked.hp, 548, 'damage applies again after unlocking');
      assert.equal(unlocked.hud, '548 / 648');

      await clickButton(page, 'heal');
      const healed = await H.readGameState(page);
      assert.equal(healed.hp, 648);
      assert.equal(healed.hud.hp, '648 / 648');
      assert.match((await readConsole(page)).status, /生命值已回满/);
    } finally {
      await H.disposePage(page);
    }
  });

  test('C4 the XP button updates the HUD immediately', async () => {
    const page = await openWorld(browser);
    try {
      await clickButton(page, 'xp');
      const state = await H.readGameState(page);
      assert.equal(state.level, 2);
      assert.equal(state.xp, 220);
      assert.equal(state.xpToNext, 340);
      assert.equal(state.hud.level, '2');
      assert.ok(Math.abs(state.hud.xpRatio - 220 / 340) < 1e-9);
      assert.match((await readConsole(page)).status, /经验 \+500（当前等级 2）/);
    } finally {
      await H.disposePage(page);
    }
  });

  test('C5 end-game button settles a defeat and restart brings back a fresh console', async () => {
    const page = await openWorld(browser);
    try {
      await clickButton(page, 'end');
      await page.waitForFunction(
        () => window.game.scene.getScene('world').gameOver === true,
        null,
        { timeout: 5000, polling: 50 },
      );
      await H.frames(page, 3);

      const over = await H.readGameState(page);
      assert.equal(over.result, 'defeat');
      assert.ok(over.overlay.includes('失败'));
      assert.equal(over.overlay.some((text) => text.includes('金钱')), false);
      assert.ok(over.overlay.some((text) => text.startsWith('存活时间 ')));
      assert.equal((await readConsole(page)).visible, false, 'console hides behind the result overlay');

      const button = await H.canvasPoint(page, H.GAME_WIDTH / 2, H.GAME_HEIGHT / 2 + 90);
      await page.mouse.click(button.x, button.y);
      await H.waitForWorld(page);

      const after = await H.readGameState(page);
      assert.equal(after.gameOver, false);
      assert.equal(after.result, null);
      assert.equal(after.hp, 648);
      assert.equal(after.hud.time, '3:00');

      const view = await readConsole(page);
      assert.ok(view);
      assert.equal(view.visible, true);
      assert.deepEqual(view.active, []);
      assert.equal(view.labels[2], '生命锁定：关');
      assert.equal(
        await page.evaluate(() => window.game.scene.getScene('world').hpLocked),
        false,
      );
    } finally {
      await H.disposePage(page);
    }
  });

  test('C6 immediate-victory button wins the run and reports the full survival time', async () => {
    const page = await openWorld(browser);
    try {
      await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        scene.remainingMs = 90000;
        scene.hud.setTime(scene.formatTime(scene.remainingMs));
      });
      await clickButton(page, 'win');
      await page.waitForFunction(
        () => window.game.scene.getScene('world').gameOver === true,
        null,
        { timeout: 5000, polling: 50 },
      );
      await H.frames(page, 3);

      const over = await H.readGameState(page);
      assert.equal(over.result, 'victory');
      assert.equal(over.elapsedMs, 180000, 'the forced victory snaps the run time to the goal');
      assert.equal(over.remainingMs, 0);
      assert.equal(over.hud.time, '0:00');
      assert.ok(over.overlay.includes('胜利'));
      assert.ok(over.overlay.includes('存活时间 3:00'));
      assert.equal((await readConsole(page)).visible, false);
    } finally {
      await H.disposePage(page);
    }
  });
});
