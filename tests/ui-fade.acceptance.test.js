'use strict';

/**
 * Acceptance suite for the UI proximity fade.
 *
 * U1 the HUD, minimap and dev console register fade regions with a hysteresis
 *    buffer (exit distance noticeably larger than enter distance).
 * U2 the player standing in the bottom-right corner fades the minimap only,
 *    and moving back to the centre restores it.
 * U3 a zombie touching the HUD bar fades the bar and the bar restores once the
 *    zombie walks away.
 * U4 the gap between enter and exit distance keeps the fade from flip-flopping.
 * U5 enemies that are off screen cannot trigger a fade even when they sit just
 *    outside the panel edge (e.g. below the bottom bar).
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness.js');

const PORT = Number(process.env.ACCEPTANCE_UI_FADE_PORT || 5198);
const URL = `http://127.0.0.1:${PORT}/`;
const SETTLE_MS = 900;

async function openWorld(browser) {
  const { page, errors } = await H.openGameWithStart(browser, URL);
  await H.clearZombies(page, { pause: true });
  return { page, errors };
}

async function teleportPlayer(page, x, y) {
  await page.evaluate(
    ([targetX, targetY]) => {
      const player = window.game.scene.getScene('world').player;
      const dx = player.body.center.x - player.gameObject.x;
      const dy = player.body.center.y - player.gameObject.y;
      player.body.reset(targetX - dx, targetY - dy);
      player.body.updateFromGameObject();
    },
    [x, y],
  );
  await H.frames(page, 2);
}

async function settle(page) {
  await page.waitForTimeout(SETTLE_MS);
  await H.frames(page, 1);
}

function readFade(page) {
  return page.evaluate(() => {
    const scene = window.game.scene.getScene('world');
    const fade = scene.uiFade;
    return {
      enter: fade.config.enterDistance,
      exit: fade.config.exitDistance,
      fadedAlpha: fade.config.fadedAlpha,
      panels: fade.panels.map((panel) => ({
        id: panel.id,
        faded: panel.faded,
        alpha: panel.alpha,
        regions: panel.regions.map((region) => ({ ...region })),
      })),
      objectAlpha: {
        hud: scene.hud.chrome.alpha,
        hudText: scene.hud.timeText.alpha,
        minimap: scene.minimap.marker.alpha,
        minimapPanel: scene.minimap.panel.alpha,
        console: scene.devConsole ? scene.devConsole.root.alpha : null,
      },
    };
  });
}

function panelOf(view, id) {
  return view.panels.find((panel) => panel.id === id);
}

describe('ui-fade acceptance', () => {
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

  test('U1 the fixed panels register fade regions with a hysteresis buffer', async () => {
    const { page, errors } = await openWorld(browser);
    try {
      const view = await readFade(page);
      assert.deepEqual(
        view.panels.map((panel) => panel.id),
        ['hud', 'minimap', 'console'],
      );
      assert.equal(view.enter, 44);
      assert.equal(view.exit, 120);
      assert.ok(view.exit - view.enter >= 60, 'exit distance leaves a wide buffer');
      assert.ok(view.fadedAlpha >= 0.2 && view.fadedAlpha <= 0.5, 'faded UI stays readable');

      const hud = panelOf(view, 'hud');
      assert.deepEqual(
        hud.regions[0],
        { x: 243, y: 598, width: 680, height: 114 },
        'the bottom bar region matches the shifted HUD layout',
      );
      assert.deepEqual(
        hud.regions[1],
        { x: 929, y: 598, width: 108, height: 114 },
        'the trinket/gold panel fades with the bar',
      );
      assert.ok(
        hud.regions.some((region) => region.x === 24 && region.y === 20),
        'the top-left time block fades as well',
      );

      const minimap = panelOf(view, 'minimap');
      assert.deepEqual(minimap.regions, [
        { x: 1048, y: 488, width: 216, height: 216 },
      ]);

      const consolePanel = panelOf(view, 'console');
      assert.equal(consolePanel.regions[0].x, 1032);
      assert.equal(consolePanel.regions[0].width, 232);
      assert.ok(consolePanel.regions[0].height > 300);

      assert.ok(
        view.panels.every((panel) => !panel.faded && panel.alpha === 1),
        'everything starts fully opaque',
      );
      assert.deepEqual(view.objectAlpha, {
        hud: 1,
        hudText: 1,
        minimap: 1,
        minimapPanel: 1,
        console: 1,
      });
      assert.deepEqual(errors.console, []);
      assert.deepEqual(errors.page, []);
    } finally {
      await H.disposePage(page);
    }
  });

  test('U2 the player in the bottom-right corner fades the minimap only', async () => {
    const { page } = await openWorld(browser);
    try {
      await teleportPlayer(page, 3980, 3980);
      await settle(page);
      let view = await readFade(page);
      const minimap = panelOf(view, 'minimap');
      assert.equal(minimap.faded, true, 'the player overlaps the minimap');
      assert.ok(
        minimap.alpha > 0.3 && minimap.alpha < 0.4,
        `minimap fades to a readable alpha (${minimap.alpha.toFixed(2)})`,
      );
      assert.ok(
        view.objectAlpha.minimap > 0.3 && view.objectAlpha.minimap < 0.4,
        'the marker fades with the panel',
      );
      assert.ok(
        view.objectAlpha.minimapPanel > 0.3 && view.objectAlpha.minimapPanel < 0.4,
        'the panel frame fades with the marker',
      );
      assert.equal(panelOf(view, 'hud').faded, false, 'the HUD stays untouched');
      assert.equal(view.objectAlpha.hud, 1);
      assert.equal(panelOf(view, 'console').faded, false);
      assert.equal(view.objectAlpha.console, 1);

      await teleportPlayer(page, 2000, 2000);
      await settle(page);
      view = await readFade(page);
      assert.equal(panelOf(view, 'minimap').faded, false, 'walking away restores the minimap');
      assert.equal(view.objectAlpha.minimap, 1);
      assert.equal(view.objectAlpha.minimapPanel, 1);
    } finally {
      await H.disposePage(page);
    }
  });

  test('U3 a zombie touching the HUD bar fades it and restores it on retreat', async () => {
    const { page } = await openWorld(browser);
    try {
      await teleportPlayer(page, 2000, 2000);
      await H.spawnTestZombie(page, 2000, 2290, { speed: 0 });
      await settle(page);

      let view = await readFade(page);
      assert.equal(panelOf(view, 'hud').faded, true, 'the zombie overlaps the bottom bar');
      assert.ok(
        view.objectAlpha.hud > 0.3 && view.objectAlpha.hud < 0.4,
        `the HUD fades to a readable alpha (${view.objectAlpha.hud.toFixed(2)})`,
      );
      assert.ok(view.objectAlpha.hudText > 0.3 && view.objectAlpha.hudText < 0.4);
      assert.equal(panelOf(view, 'minimap').faded, false, 'the minimap stays opaque');
      assert.equal(panelOf(view, 'console').faded, false, 'the console stays opaque');

      await H.moveTestZombieBody(page, 0, 2000, 1800);
      await settle(page);
      view = await readFade(page);
      assert.equal(panelOf(view, 'hud').faded, false, 'the zombie left the bar');
      assert.equal(view.objectAlpha.hud, 1);
      assert.equal(view.objectAlpha.hudText, 1);
    } finally {
      await H.disposePage(page);
    }
  });

  test('U4 the enter/exit gap stops the fade from flip-flopping', async () => {
    const { page } = await openWorld(browser);
    try {
      await teleportPlayer(page, 24, 200);
      await settle(page);
      let view = await readFade(page);
      assert.equal(
        panelOf(view, 'hud').faded,
        false,
        'between enter and exit distance the HUD stays opaque',
      );
      assert.equal(view.objectAlpha.hudText, 1);

      await teleportPlayer(page, 24, 130);
      await settle(page);
      view = await readFade(page);
      assert.equal(panelOf(view, 'hud').faded, true, 'close enough to fade');
      assert.ok(view.objectAlpha.hud < 0.45);

      await teleportPlayer(page, 24, 200);
      await settle(page);
      view = await readFade(page);
      assert.equal(
        panelOf(view, 'hud').faded,
        true,
        'back in the buffer the HUD holds the faded state',
      );
      assert.ok(view.objectAlpha.hud < 0.45, 'the faded alpha is held, not flickering');

      await teleportPlayer(page, 24, 300);
      await settle(page);
      view = await readFade(page);
      assert.equal(panelOf(view, 'hud').faded, false, 'beyond the exit distance it restores');
      assert.equal(view.objectAlpha.hudText, 1);
      assert.equal(view.objectAlpha.hud, 1);
    } finally {
      await H.disposePage(page);
    }
  });

  test('U5 off-screen enemies do not fade the UI', async () => {
    const { page } = await openWorld(browser);
    try {
      await teleportPlayer(page, 2000, 2000);
      await settle(page);
      const camera = await page.evaluate(() => {
        const cam = window.game.scene.getScene('world').cameras.main;
        return { x: cam.scrollX, y: cam.scrollY };
      });
      const screenToWorld = (sx, sy) => [camera.x + sx, camera.y + sy];
      await H.spawnTestZombie(page, 2000, 2000, { speed: 0 });

      // Screen y 740 is 20px below the 720px viewport.
      await H.moveTestZombieBody(page, 0, ...screenToWorld(640, 740));
      await settle(page);
      let view = await readFade(page);
      assert.equal(
        panelOf(view, 'hud').faded,
        false,
        'a zombie just below the screen edge must not fade the bottom bar',
      );
      assert.equal(view.objectAlpha.hud, 1);

      // Screen y 670 is inside the viewport, hidden behind the bar.
      await H.moveTestZombieBody(page, 0, ...screenToWorld(640, 670));
      await settle(page);
      view = await readFade(page);
      assert.equal(panelOf(view, 'hud').faded, true, 'a visible zombie behind the bar still fades it');
      assert.ok(view.objectAlpha.hud < 0.45);

      await H.moveTestZombieBody(page, 0, ...screenToWorld(640, 960));
      await settle(page);
      view = await readFade(page);
      assert.equal(panelOf(view, 'hud').faded, false, 'the bar restores once the zombie is gone');

      // Screen x 1300 is 20px right of the viewport, 36px right of the minimap.
      await H.moveTestZombieBody(page, 0, ...screenToWorld(1300, 600));
      await settle(page);
      view = await readFade(page);
      assert.equal(
        panelOf(view, 'minimap').faded,
        false,
        'a zombie right of the screen edge must not fade the minimap',
      );
      assert.equal(view.objectAlpha.minimap, 1);
      assert.equal(view.objectAlpha.minimapPanel, 1);
    } finally {
      await H.disposePage(page);
    }
  });
});
