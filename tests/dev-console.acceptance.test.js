'use strict';

/**
 * Acceptance suite for the development-only test console.
 *
 * The console is enabled by CONSOLE.enabled (import.meta.env.DEV) and renders a
 * fixed panel in the top-right corner with buttons that drive the running world
 * scene: spawn/clear enemies, HP lock, heal, gold, XP, tier skip and game over.
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
        'gold',
        'xp',
        'tier',
        'end',
      ]);
      assert.deepEqual(view.labels, [
        '刷出当前敌人',
        '清空场上敌人',
        '生命锁定：关',
        '回满生命',
        '金钱 +100',
        '经验 +500',
        '进入下一难度',
        '结束本局',
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

  test('C4 gold, XP and tier buttons update the HUD immediately', async () => {
    const page = await openWorld(browser);
    try {
      await clickButton(page, 'gold');
      await clickButton(page, 'gold');
      let state = await H.readGameState(page);
      assert.equal(state.gold, 200);
      assert.equal(state.hud.gold, '200');
      assert.match((await readConsole(page)).status, /金钱 \+100（当前 200）/);

      await clickButton(page, 'xp');
      state = await H.readGameState(page);
      assert.equal(state.level, 2);
      assert.equal(state.xp, 220);
      assert.equal(state.xpToNext, 340);
      assert.equal(state.hud.level, '2');
      assert.ok(Math.abs(state.hud.xpRatio - 220 / 340) < 1e-9);
      assert.match((await readConsole(page)).status, /经验 \+500（当前等级 2）/);

      const tiers = ['白银', '黄金', '翡翠', '钻石', '大师', '王者'];
      for (const expected of tiers) {
        await clickButton(page, 'tier');
        state = await H.readGameState(page);
        assert.equal(state.tier.name, expected);
        assert.equal(state.hud.difficulty, `难度 ${expected}`);
        assert.match((await readConsole(page)).status, new RegExp(`当前难度：${expected}`));
      }

      state = await H.readGameState(page);
      assert.ok(
        state.elapsedMs >= 360000 && state.elapsedMs < 361000,
        '王者 starts at six minutes',
      );
      assert.equal(state.hud.time, '6:00');

      await clickButton(page, 'tier');
      const capped = await H.readGameState(page);
      assert.ok(capped.elapsedMs - state.elapsedMs < 1000, 'the highest tier cannot be skipped past');
      assert.equal(capped.tier.name, '王者');
      assert.match((await readConsole(page)).status, /已是最高难度/);
    } finally {
      await H.disposePage(page);
    }
  });

  test('C5 end-game button shows the overlay and restart brings back a fresh console', async () => {
    const page = await openWorld(browser);
    try {
      await clickButton(page, 'gold');

      await clickButton(page, 'end');
      await page.waitForFunction(
        () => window.game.scene.getScene('world').gameOver === true,
        null,
        { timeout: 5000, polling: 50 },
      );
      await H.frames(page, 3);

      const over = await H.readGameState(page);
      assert.ok(over.overlay.includes('本局结束'));
      assert.ok(over.overlay.includes('金钱 100'));
      assert.equal((await readConsole(page)).visible, false, 'console hides behind the result overlay');

      const button = await H.canvasPoint(page, H.GAME_WIDTH / 2, H.GAME_HEIGHT / 2 + 90);
      await page.mouse.click(button.x, button.y);
      await H.waitForWorld(page);

      const after = await H.readGameState(page);
      assert.equal(after.gameOver, false);
      assert.equal(after.gold, 0);
      assert.equal(after.hp, 648);

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
});
