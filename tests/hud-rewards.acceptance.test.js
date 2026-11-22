'use strict';

/**
 * Acceptance suite for the League-of-Legends-style bottom info bar and the
 * XP reward economy. Covers:
 *  - the bar layout (2x2 grid, avatar with XP ring/level badge, six weapon slots
 *    over the HP bar) centred on screen and its fixed-screen behaviour;
 *  - fixed per-enemy XP drops (normal zombie: 60 XP);
 *  - XP accumulation, level-ups against the configured LoL curve and the level cap;
 *  - the defeat result overlay and a restart clearing the run;
 *  - the circular avatar asset being bundled and served.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness.js');

const PORT = Number(process.env.ACCEPTANCE_HUD_PORT || 5193);
const URL = `http://127.0.0.1:${PORT}/`;

async function openWorld(browser, { collectNetwork = false } = {}) {
  const { page, errors } = await H.openGameWithStart(browser, URL, { collectNetwork });
  await H.clearZombies(page, { pause: true });
  return { page, errors };
}

async function killZombie(page, index) {
  await H.callTestZombie(page, index, 'takeDamage', 9999);
  await H.frames(page, 2);
}

describe('hud-rewards acceptance', () => {
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

  test('H1 the bottom bar follows the reference order and stays fixed on screen', async () => {
    const { page, errors } = await openWorld(browser, { collectNetwork: true });
    try {
      const view = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        const hud = scene.hud;
        const layout = hud.layout;
        const slotXs = layout.weaponSlots.map((slot) => slot.x);
        const slotYs = layout.weaponSlots.map((slot) => slot.y);
        const gridXs = [...new Set(layout.grid.slots.map((slot) => slot.x))];
        const gridYs = [...new Set(layout.grid.slots.map((slot) => slot.y))];
        return {
          screen: { width: scene.scale.width, height: scene.scale.height },
          layout: JSON.parse(JSON.stringify(layout)),
          slotXs,
          slotYs,
          gridXs,
          gridYs,
          inventory: {
            weapons: [...scene.inventory.weapons],
            trinkets: scene.inventory.trinkets ?? null,
          },
          weaponIcons: Array.from({ length: layout.weaponSlots.length }, (_, index) => {
            const icon = hud.icons.weapon[index];
            return icon
              ? {
                  visible: icon.visible,
                  texture: icon.texture.key,
                  x: icon.x,
                  y: icon.y,
                }
              : null;
          }),
          text: {
            time: { x: hud.timeText.x, y: hud.timeText.y, depth: hud.timeText.depth },
            hp: {
              x: hud.hpText.x,
              y: hud.hpText.y,
              depth: hud.hpText.depth,
              text: hud.hpText.text,
              origin: hud.hpText.originX,
            },
            level: {
              x: hud.levelText.x,
              y: hud.levelText.y,
              depth: hud.levelText.depth,
              text: hud.levelText.text,
            },
          },
          fixed: [hud.chrome, hud.hpGraphics, hud.xpGraphics, hud.avatar, hud.hpText]
            .map((obj) => obj.scrollFactorX === 0 && obj.scrollFactorY === 0),
          depths: {
            chrome: hud.chrome.depth,
            hpGraphics: hud.hpGraphics.depth,
            xpGraphics: hud.xpGraphics.depth,
          },
          avatar: {
            texture: hud.avatar.texture.key,
            width: hud.avatar.displayWidth,
            height: hud.avatar.displayHeight,
          },
          avatarTextureExists: scene.textures.exists('player-avatar'),
        };
      });

      const { layout } = view;
      const { width, height } = view.screen;
      assert.ok(
        Math.abs(layout.bar.x + layout.bar.width / 2 - width / 2) <= 1,
        'the bar is centred on screen',
      );
      assert.equal(layout.bar.x, (width - layout.bar.width) / 2, 'the bar sits on the centre axis');
      assert.equal(layout.bar.y + layout.bar.height, height - 8, 'bar hugs the bottom edge');
      assert.equal(layout.side, undefined, 'the right-hand item panel is gone');
      assert.equal(layout.trinketSlots, undefined, 'the trinket grid is gone');

      assert.equal(layout.grid.slots.length, 4, 'the far-left placeholder is a 2x2 grid');
      assert.equal(view.gridXs.length, 2);
      assert.equal(view.gridYs.length, 2);
      assert.ok(layout.grid.slots.every((slot) => slot.size === layout.grid.slots[0].size));
      assert.ok(
        layout.grid.x + layout.grid.size < layout.avatar.x - layout.avatar.radius,
        'the 2x2 grid sits left of the avatar',
      );

      assert.ok(layout.avatar.radius > 0);
      assert.ok(
        layout.avatar.xpRadius > layout.avatar.radius,
        'the XP ring wraps the circular avatar on the outside',
      );
      assert.ok(
        layout.avatar.badge.x > layout.avatar.x &&
          layout.avatar.badge.y > layout.avatar.y,
        'the level badge hangs off the lower-right of the avatar',
      );

      assert.equal(layout.weaponSlots.length, 6, 'the middle box holds six weapon slots');
      assert.equal(new Set(view.slotYs).size, 1, 'the six weapon slots form one row');
      assert.ok(view.slotXs.every((x) => x > layout.middle.x && x < layout.middle.x + layout.middle.width));
      const gaps = view.slotXs.slice(1).map((x, i) => x - view.slotXs[i]);
      assert.ok(gaps.every((gap) => gap === gaps[0]), 'weapon slots are evenly spaced');

      assert.deepEqual(
        view.inventory,
        { weapons: ['dart'], trinkets: null },
        'the run starts with only the spinning dart and no trinket inventory',
      );
      assert.deepEqual(
        view.weaponIcons[0],
        {
          visible: true,
          texture: 'dart',
          x: layout.weaponSlots[0].x + layout.weaponSlots[0].size / 2,
          y: layout.weaponSlots[0].y + layout.weaponSlots[0].size / 2,
        },
        'the spinning dart fills the first weapon slot',
      );
      assert.deepEqual(
        view.weaponIcons.slice(1),
        [null, null, null, null, null],
        'the other weapon slots stay empty',
      );

      assert.ok(layout.hpBar.y >= view.slotYs[0] + layout.weaponSlots[0].size, 'HP sits under the slots');
      assert.equal(layout.hpBar.x, layout.weaponSlots[0].x, 'HP bar aligns with the slot row');
      assert.equal(
        layout.hpBar.x + layout.hpBar.width,
        view.slotXs[5] + layout.weaponSlots[5].size,
        'HP bar spans the slot row',
      );

      assert.equal(layout.goldButton, undefined, 'the HUD no longer has a gold button');

      assert.ok(view.text.hp.y > layout.bar.y, 'HP moved into the bottom bar');
      assert.equal(view.text.hp.text, '648 / 648');
      assert.equal(view.text.level.text, '1');
      assert.equal(view.text.hp.origin, 0.5, 'HP text is centred on the bar');
      assert.equal(view.text.time.y, 20);

      assert.ok(view.fixed.every(Boolean), 'all bottom-bar elements ignore camera scroll');
      assert.deepEqual(view.depths, { chrome: 1000, hpGraphics: 1001, xpGraphics: 1001 });
      assert.equal(view.text.hp.depth, 1002);
      assert.equal(view.text.level.depth, 1002);

      assert.equal(view.avatar.texture, 'player-avatar');
      assert.equal(view.avatarTextureExists, true);
      assert.ok(Math.abs(view.avatar.width - (layout.avatar.radius * 2 - 8)) <= 1);

      const avatarResponses = errors.responses.filter((res) => /avatar\.png/i.test(res.url));
      assert.ok(avatarResponses.length >= 1, 'avatar.png must be requested');
      const avatarImage = avatarResponses.find((res) => /image\/png/.test(res.contentType));
      assert.ok(
        avatarImage,
        `the avatar must be served as a PNG (${avatarResponses.map((res) => res.contentType)})`,
      );
      assert.equal(avatarImage.status, 200);
    } finally {
      await H.disposePage(page);
    }
  });

  test('H2 every kill drops fixed XP and updates the HUD', async () => {
    const { page } = await openWorld(browser);
    try {
      const config = await page.evaluate(async () => {
        const mod = await import('/src/config.js');
        return JSON.parse(JSON.stringify(mod.ZOMBIES));
      });
      const types = Object.values(config);
      assert.ok(types.length >= 1);
      for (const type of types) {
        assert.equal(Number.isInteger(type.reward.xp), true, `${type.name} XP is fixed`);
        assert.ok(type.reward.xp > 0);
        assert.equal('gold' in type.reward, false, `${type.name} no longer drops gold`);
      }
      assert.deepEqual(config.normal.reward, { xp: 60 });

      const initial = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        return {
          xp: scene.xp,
          ringCommands: scene.hud.xpGraphics.commandBuffer.length,
        };
      });
      assert.equal(initial.xp, 0);
      assert.equal(initial.ringCommands, 0, 'the XP ring is empty at zero XP');

      const first = await H.spawnTestZombie(page, 400, 400, { maxHp: 10 });
      await killZombie(page, first);
      let state = await H.readGameState(page);
      assert.equal(state.xp, 60);
      assert.equal(state.hud.level, '1');
      assert.ok(Math.abs(state.hud.xpRatio - 60 / 280) < 1e-9);

      const ringDrawn = await page.evaluate(
        () => window.game.scene.getScene('world').hud.xpGraphics.commandBuffer.length,
      );
      assert.ok(ringDrawn > 0, 'the XP ring renders the partial arc');

      const second = await H.spawnTestZombie(page, 450, 400, { maxHp: 10 });
      await killZombie(page, second);
      state = await H.readGameState(page);
      assert.equal(state.xp, 120, 'XP accumulates per kill');
      assert.ok(Math.abs(state.hud.xpRatio - 120 / 280) < 1e-9);
    } finally {
      await H.disposePage(page);
    }
  });

  test('H3 XP levels up on the configured LoL curve and caps at level 18', async () => {
    const { page } = await openWorld(browser);
    try {
      await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        scene.xp = 270;
        scene.hud.setXp(1, 270, 280);
      });

      const index = await H.spawnTestZombie(page, 400, 400, { maxHp: 10 });
      await killZombie(page, index);

      let state = await H.readGameState(page);
      assert.equal(state.level, 2, '60 XP carries 270/280 over the level-1 threshold');
      assert.equal(state.xp, 50, 'the surplus XP rolls into the new level');
      assert.equal(state.xpToNext, 340, 'level 2 requires the next LoL threshold');
      assert.equal(state.hud.level, '2');
      assert.ok(Math.abs(state.hud.xpRatio - 50 / 340) < 1e-9);

      const badge = await page.evaluate(() => {
        const hud = window.game.scene.getScene('world').hud;
        return {
          text: hud.levelText.text,
          centred: hud.levelText.originX === 0.5 && hud.levelText.originY === 0.5,
          x: hud.levelText.x,
          y: hud.levelText.y,
          badge: { ...hud.layout.avatar.badge },
        };
      });
      assert.equal(badge.text, '2');
      assert.equal(badge.centred, true);
      assert.equal(badge.x, badge.badge.x);
      assert.equal(badge.y, badge.badge.y + 1);

      const multi = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        scene.addXp(1000);
        scene.hud.setXp(scene.level, scene.xp, scene.xpToNext);
        return { level: scene.level, xp: scene.xp, xpToNext: scene.xpToNext };
      });
      assert.deepEqual(multi, { level: 4, xp: 250, xpToNext: 640 });

      const cap = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        scene.level = 18;
        scene.xp = 9080;
        scene.xpToNext = 9080;
        scene.hud.setXp(18, 9080, 9080);
        scene.addXp(5000);
        scene.hud.setXp(scene.level, scene.xp, scene.xpToNext);
        return {
          level: scene.level,
          xp: scene.xp,
          text: scene.hud.levelText.text,
          ratio: scene.hud.xpRatio,
        };
      });
      assert.deepEqual(cap, { level: 18, xp: 9080, text: '18', ratio: 1 }, 'level 18 is the cap');
    } finally {
      await H.disposePage(page);
    }
  });

  test('H4 the result overlay reports the defeat and a restart clears the run', async () => {
    const { page } = await openWorld(browser);
    try {
      const first = await H.spawnTestZombie(page, 400, 400, { maxHp: 10 });
      const second = await H.spawnTestZombie(page, 450, 400, { maxHp: 10 });
      await killZombie(page, first);
      await killZombie(page, second);

      const before = await H.readGameState(page);
      assert.equal(before.xp, 120);

      await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        scene.handlePlayerHit(scene.maxHp);
      });
      await page.waitForFunction(
        () => window.game.scene.getScene('world').gameOver === true,
        null,
        { timeout: 5000, polling: 50 },
      );
      await H.frames(page, 3);

      const over = await H.readGameState(page);
      assert.equal(over.result, 'defeat');
      assert.ok(over.overlay.includes('失败'));
      assert.ok(over.overlay.some((text) => text.startsWith('存活时间 ')));
      assert.equal(over.overlay.some((text) => text.includes('金钱')), false, 'the result no longer reports gold');
      assert.equal(over.overlay.some((text) => text.includes('分数')), false, 'the score system is gone');
      assert.equal(over.overlayAllFixed, true);

      const button = await H.canvasPoint(page, H.GAME_WIDTH / 2, H.GAME_HEIGHT / 2 + 90);
      await page.mouse.click(button.x, button.y);
      await H.waitForWorld(page);

      const after = await H.readGameState(page);
      assert.equal(after.gameOver, false);
      assert.equal(after.level, 1);
      assert.equal(after.xp, 0);
      assert.equal(after.hud.level, '1');
      assert.equal(after.hud.hp, '648 / 648');
      assert.equal(after.hud.time, '3:00');
      assert.ok(!after.overlay.includes('失败'));
    } finally {
      await H.disposePage(page);
    }
  });
});
