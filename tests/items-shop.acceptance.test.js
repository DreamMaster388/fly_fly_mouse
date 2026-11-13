'use strict';

/**
 * Acceptance suite for the item inventory and the shop window.
 *
 * I1 weapons and trinkets are separate 6-slot collections kept in acquisition
 *    order; the run starts with only the spinning dart, trinkets repeat while
 *    weapons stay unique.
 * I2 the HUD weapon row shows the dart in the first slot, the right-hand panel
 *    reserves a 2x3 trinket grid and a clickable gold button.
 * I3 clicking the gold button opens the shop and pauses the world; ESC closes
 *    the shop and resumes the same run.
 * I4 the shop's bottom-right exit button closes it, and reopening is guarded.
 * I5 every canvas and DOM font uses the bundled 字小魂萌萌哒体 face.
 * I6 hovering the dart shows its description, coloured stats and flavour text;
 *    empty weapon and trinket slots show nothing.
 * I7 tooltip numbers are read from live weapon stats on every hover.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness.js');

const PORT = Number(process.env.ACCEPTANCE_ITEMS_PORT || 5199);
const URL = `http://127.0.0.1:${PORT}/`;

async function openWorld(browser) {
  const { page } = await H.openGameWithStart(browser, URL);
  await H.clearZombies(page, { pause: false });
  return page;
}

function goldButtonPoint(page) {
  return page.evaluate(() => {
    const { goldButton } = window.game.scene.getScene('world').hud.layout;
    return { x: goldButton.x + goldButton.width / 2, y: goldButton.y + goldButton.height / 2 };
  });
}

async function clickGold(page) {
  const point = await goldButtonPoint(page);
  const canvasPoint = await H.canvasPoint(page, point.x, point.y);
  await page.mouse.click(canvasPoint.x, canvasPoint.y);
}

async function waitForShop(page, open) {
  await page.waitForFunction(
    (shouldOpen) => {
      const manager = window.game.scene;
      return shouldOpen
        ? manager.isActive('shop') && manager.isPaused('world')
        : !manager.isActive('shop') && manager.isActive('world');
    },
    open,
    { timeout: 5000, polling: 50 },
  );
}

async function moveToSlot(page, kind, index) {
  const point = await page.evaluate(
    ({ slotKind, slotIndex }) => {
      const layout = window.game.scene.getScene('world').hud.layout;
      const slots = slotKind === 'weapon' ? layout.weaponSlots : layout.trinketSlots;
      const slot = slots[slotIndex];
      return { x: slot.x + slot.size / 2, y: slot.y + slot.size / 2 };
    },
    { slotKind: kind, slotIndex: index },
  );
  const canvasPoint = await H.canvasPoint(page, point.x, point.y);
  await page.mouse.move(canvasPoint.x, canvasPoint.y);
  await H.frames(page, 2);
}

function waitForTooltip(page, visible) {
  return page.waitForFunction(
    (shouldShow) => window.game.scene.getScene('world').hud.tooltip.visible === shouldShow,
    visible,
    { timeout: 5000, polling: 50 },
  );
}

describe('items and shop acceptance', () => {
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

  test('I1 weapons and trinkets are separate six-slot ordered collections', async () => {
    const page = await openWorld(browser);
    try {
      const data = await page.evaluate(async () => {
        const { default: Inventory, ITEM_CATEGORY, ITEMS, MAX_TRINKETS, MAX_WEAPONS, getItem } =
          await import('/src/items.js');
        const scene = window.game.scene.getScene('world');

        const catalog = { dart: getItem('dart') };
        for (let index = 1; index <= 7; index += 1) {
          catalog[`w${index}`] = { name: `W${index}`, category: 'weapon', textureKey: 'dart' };
          catalog[`t${index}`] = { name: `T${index}`, category: 'trinket', textureKey: 'dart' };
        }
        const inventory = new Inventory(
          {
            weapons: ['dart', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6'],
            trinkets: ['t1', 't2', 't3', 't4', 't5', 't6', 't7'],
          },
          catalog,
        );
        const repeats = new Inventory({ trinkets: ['t1'] }, catalog);
        const repeatAdded = repeats.addItem('t1');

        return {
          categories: ITEM_CATEGORY,
          catalogIds: Object.keys(ITEMS),
          dart: (() => {
            const item = getItem('dart');
            return { name: item.name, category: item.category, textureKey: item.textureKey };
          })(),
          ruby: (() => {
            const item = getItem('ruby');
            return {
              name: item.name,
              category: item.category,
              textureKey: item.textureKey,
              price: item.price,
              description: item.description,
              flavor: item.flavor,
              effects: item.effects,
            };
          })(),
          max: { weapons: MAX_WEAPONS, trinkets: MAX_TRINKETS },
          initial: {
            weapons: [...scene.inventory.weapons],
            trinkets: [...scene.inventory.trinkets],
          },
          weapons: inventory.weapons,
          trinkets: inventory.trinkets,
          overflow: [inventory.addItem('w7'), inventory.addItem('t7')],
          duplicate: inventory.addItem('dart'),
          unknown: inventory.addItem('missing'),
          has: [inventory.hasItem('dart'), inventory.hasItem('w1'), inventory.hasItem('t1')],
          repeat: {
            added: repeatAdded,
            trinkets: [...repeats.trinkets],
            count: repeats.count('t1'),
            hasRoom: repeats.hasRoom('t1'),
          },
        };
      });

      assert.deepEqual(data.categories, { weapon: 'weapon', trinket: 'trinket' });
      assert.deepEqual(
        data.catalogIds,
        ['dart', 'bomb', 'ruby'],
        'the catalog holds the dart, the bomb and ruby',
      );
      assert.deepEqual(data.dart, {
        name: '旋转飞镖',
        category: 'weapon',
        textureKey: 'dart',
      });
      assert.deepEqual(data.ruby, {
        name: '红宝石',
        category: 'trinket',
        textureKey: 'ruby',
        price: 100,
        description: ['生命与最大生命+10。'],
        flavor: '这个加血，这个厉害。',
        effects: { hp: 10, maxHp: 10 },
      });
      assert.deepEqual(data.max, { weapons: 6, trinkets: 6 });
      assert.deepEqual(data.initial, { weapons: ['dart'], trinkets: [] }, 'the run starts with the dart');
      assert.deepEqual(
        data.weapons,
        ['dart', 'w1', 'w2', 'w3', 'w4', 'w5'],
        'weapons keep acquisition order and cap at six',
      );
      assert.deepEqual(
        data.trinkets,
        ['t1', 't2', 't3', 't4', 't5', 't6'],
        'trinkets keep acquisition order and cap at six',
      );
      assert.deepEqual(data.overflow, [false, false], 'a seventh item is rejected in each category');
      assert.equal(data.duplicate, false, 'weapon duplicates are rejected');
      assert.equal(data.unknown, false, 'unknown item ids are rejected');
      assert.deepEqual(data.has, [true, true, true]);
      assert.deepEqual(
        data.repeat,
        { added: true, trinkets: ['t1', 't1'], count: 2, hasRoom: true },
        'trinkets repeat without stacking over the six slots',
      );
    } finally {
      await H.disposePage(page);
    }
  });

  test('I2 the HUD shows the dart in weapon slot 1 and reserves the trinket grid', async () => {
    const page = await openWorld(browser);
    try {
      const view = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        const hud = scene.hud;
        const layout = hud.layout;
        const dart = hud.icons.weapon[0];
        return {
          inventory: {
            weapons: [...scene.inventory.weapons],
            trinkets: [...scene.inventory.trinkets],
          },
          dart: dart
            ? {
                visible: dart.visible,
                texture: dart.texture.key,
                x: dart.x,
                y: dart.y,
                size: dart.displayWidth,
              }
            : null,
          slot: { ...layout.weaponSlots[0] },
          weaponSlots: layout.weaponSlots.length,
          trinketSlots: layout.trinketSlots.length,
          trinketIcons: hud.icons.trinket.filter(Boolean).length,
          side: { ...layout.side },
          barRight: layout.bar.x + layout.bar.width,
          goldButton: { ...layout.goldButton },
        };
      });

      assert.deepEqual(view.inventory, { weapons: ['dart'], trinkets: [] });
      assert.ok(view.dart, 'the dart icon exists');
      assert.equal(view.dart.visible, true);
      assert.equal(view.dart.texture, 'dart');
      assert.equal(view.dart.x, view.slot.x + view.slot.size / 2, 'the icon is centred in slot 1');
      assert.equal(view.dart.y, view.slot.y + view.slot.size / 2);
      assert.ok(view.dart.size < view.slot.size, 'the icon fits inside the slot');
      assert.equal(view.weaponSlots, 6, 'six weapon slots');
      assert.equal(view.trinketSlots, 6, 'six trinket slots');
      assert.equal(view.trinketIcons, 0, 'no trinkets owned, no icons');
      assert.ok(view.side.x > view.barRight, 'the item panel sits right of the bar');
      assert.equal(view.side.width, 108);
      assert.ok(
        view.goldButton.x > view.side.x &&
          view.goldButton.x + view.goldButton.width < view.side.x + view.side.width,
        'the gold button fits inside the item panel',
      );
    } finally {
      await H.disposePage(page);
    }
  });

  test('I3 the gold button opens the shop, pauses the world and ESC resumes it', async () => {
    const page = await openWorld(browser);
    try {
      const before = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        return {
          elapsed: scene.elapsedMs,
          shopOpen: scene.shopOpen,
          shopActive: window.game.scene.isActive('shop'),
          paused: window.game.scene.isPaused('world'),
        };
      });
      assert.equal(before.shopOpen, false);
      assert.equal(before.shopActive, false);
      assert.equal(before.paused, false);

      await clickGold(page);
      await waitForShop(page, true);

      const opened = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        const shop = window.game.scene.getScene('shop');
        shop.selectCategory('trinket');
        const texts = [];
        const collect = (list) => {
          for (const child of list) {
            if (typeof child.text === 'string') texts.push(child.text);
            if (Array.isArray(child.list)) collect(child.list);
          }
        };
        collect(shop.children.list);
        return {
          elapsed: scene.elapsedMs,
          shopOpen: scene.shopOpen,
          worldActive: window.game.scene.isActive('world'),
          texts,
          guard: scene.openShop(),
        };
      });
      assert.equal(opened.shopOpen, true);
      assert.equal(opened.worldActive, false, 'the world scene is paused');
      assert.equal(opened.guard, false, 'a second shop cannot be opened');
      for (const label of ['商店', '武器', '饰品', '红宝石', '金钱不足', '退出', '按 ESC 关闭商店']) {
        assert.ok(opened.texts.includes(label), `the shop shows "${label}"`);
      }

      await page.waitForTimeout(400);
      const frozen = await page.evaluate(
        () => window.game.scene.getScene('world').elapsedMs,
      );
      assert.equal(frozen, opened.elapsed, 'the run clock freezes while the shop is open');

      await page.keyboard.press('Escape');
      await waitForShop(page, false);

      const closed = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        return {
          shopOpen: scene.shopOpen,
          elapsed: scene.elapsedMs,
          active: window.game.scene.isActive('world'),
        };
      });
      assert.equal(closed.shopOpen, false);
      assert.equal(closed.active, true, 'the world scene resumes');

      await page.waitForTimeout(300);
      const resumed = await page.evaluate(
        () => window.game.scene.getScene('world').elapsedMs,
      );
      assert.ok(resumed > frozen, 'the run clock continues after the shop closes');
    } finally {
      await H.disposePage(page);
    }
  });

  test('I4 the exit button closes the shop and the same run continues', async () => {
    const page = await openWorld(browser);
    try {
      await clickGold(page);
      await waitForShop(page, true);

      const exit = await page.evaluate(() => {
        const { exitButton } = window.game.scene.getScene('shop').layout;
        return {
          x: exitButton.x + exitButton.width / 2,
          y: exitButton.y + exitButton.height / 2,
        };
      });
      const point = await H.canvasPoint(page, exit.x, exit.y);
      await page.mouse.click(point.x, point.y);
      await waitForShop(page, false);

      const state = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        return {
          shopOpen: scene.shopOpen,
          active: window.game.scene.isActive('world'),
          gold: scene.gold,
          hp: scene.hp,
        };
      });
      assert.equal(state.shopOpen, false);
      assert.equal(state.active, true);
      assert.equal(state.gold, 0, 'opening the shop does not reset the run');
      assert.equal(state.hp, 648);

      await clickGold(page);
      await waitForShop(page, true);
      const reopened = await page.evaluate(() => window.game.scene.getScene('world').shopOpen);
      assert.equal(reopened, true, 'the shop can be reopened after closing');
    } finally {
      await H.disposePage(page);
    }
  });

  test('I5 every screen uses the bundled 字小魂萌萌哒体 font', async () => {
    const page = await H.openStartScreen(browser, URL);
    try {
      await page.waitForFunction(() => document.fonts.check('16px "字小魂萌萌哒体"'), null, {
        timeout: 15000,
        polling: 100,
      });

      const startView = await page.evaluate(() => {
        const start = window.game.scene.getScene('start');
        const button = start.children.list.find((object) => object.type === 'Text');
        return {
          loaded: document.fonts.check('16px "字小魂萌萌哒体"'),
          hint: getComputedStyle(document.querySelector('.hint')).fontFamily,
          button: { text: button.text, font: button.style.fontFamily },
        };
      });
      assert.equal(startView.loaded, true, 'the bundled face is loaded');
      assert.match(startView.hint, /字小魂萌萌哒体/, 'the DOM hint uses the bundled font');
      assert.equal(startView.button.text, '开始游戏');
      assert.match(startView.button.font, /字小魂萌萌哒体/, 'the start button uses the bundled font');

      const centre = await H.canvasPoint(page, H.GAME_WIDTH / 2, H.GAME_HEIGHT / 2);
      await page.mouse.click(centre.x, centre.y);
      await H.waitForWorld(page);

      const worldFonts = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        const texts = [];
        for (const object of scene.children.list) {
          if (object.type === 'Text' && typeof object.text === 'string') texts.push(object);
          if (Array.isArray(object.list)) {
            for (const child of object.list) {
              if (child && child.type === 'Text' && typeof child.text === 'string') {
                texts.push(child);
              }
            }
          }
        }
        return texts.map((object) => ({ text: object.text, font: object.style.fontFamily }));
      });
      assert.ok(
        worldFonts.some((entry) => entry.text.includes('测试控制台')),
        'the dev console is part of the check',
      );
      assert.ok(
        worldFonts.every((entry) => /字小魂萌萌哒体/.test(entry.font)),
        'every world text uses the bundled font',
      );

      await clickGold(page);
      await waitForShop(page, true);
      const shopFonts = await page.evaluate(() => {
        const shop = window.game.scene.getScene('shop');
        const texts = [];
        const collect = (list) => {
          for (const object of list) {
            if (object.type === 'Text') {
              texts.push({ text: object.text, font: object.style.fontFamily });
            }
            if (Array.isArray(object.list)) collect(object.list);
          }
        };
        collect(shop.children.list);
        return texts;
      });
      assert.ok(shopFonts.length >= 6, 'the shop title, hints and exit label are text objects');
      assert.ok(
        shopFonts.every((entry) => /字小魂萌萌哒体/.test(entry.font)),
        'every shop text uses the bundled font',
      );

      await page.keyboard.press('Escape');
      await waitForShop(page, false);
    } finally {
      await H.disposePage(page);
    }
  });

  test('I6 hovering the dart shows its description, coloured stats and flavour', async () => {
    const page = await openWorld(browser);
    try {
      const initial = await page.evaluate(
        () => window.game.scene.getScene('world').hud.tooltip.visible,
      );
      assert.equal(initial, false, 'the tooltip is hidden until hovered');

      await moveToSlot(page, 'weapon', 0);
      await waitForTooltip(page, true);

      const view = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        const hud = scene.hud;
        return {
          name: hud.tooltip.itemName,
          runs: hud.tooltip.runs.map((run) => ({
            text: run.text,
            color: run.color,
            stat: run.stat || null,
          })),
          flavor: hud.tooltip.flavor,
          bounds: hud.tooltip.bounds,
          slTop: hud.layout.weaponSlots[0].y,
          container: {
            visible: hud.tooltip.container.visible,
            depth: hud.tooltip.container.depth,
            scrollX: hud.tooltip.container.scrollFactorX,
            scrollY: hud.tooltip.container.scrollFactorY,
          },
        };
      });

      assert.equal(view.name, '旋转飞镖');
      assert.equal(
        view.runs.map((run) => run.text).join(''),
        '召唤围绕主角的飞镖。每隔1秒，召唤1枚飞镖，最多8枚，每枚造成2点伤害。',
      );
      const stats = view.runs.filter((run) => run.stat);
      assert.deepEqual(
        stats.map((run) => run.stat),
        ['refillIntervalMs', 'refillCount', 'slotCount', 'damage'],
      );
      assert.deepEqual(
        stats.map((run) => run.text),
        ['1', '1', '8', '2'],
        'the numbers come from the weapon config',
      );
      assert.equal(new Set(stats.map((run) => run.color)).size, 4, 'each stat has its own colour');
      assert.equal(view.flavor, '影流之主！');
      assert.equal(view.container.visible, true);
      assert.equal(view.container.depth, 1200, 'the transient card floats above the minimap');
      assert.deepEqual([view.container.scrollX, view.container.scrollY], [0, 0]);
      assert.ok(view.bounds.y + view.bounds.height <= view.slTop, 'the card floats above the bar');

      await moveToSlot(page, 'weapon', 1);
      await waitForTooltip(page, false);

      await moveToSlot(page, 'trinket', 0);
      await waitForTooltip(page, false);

      const trinketSetup = await page.evaluate(async () => {
        const { ITEMS } = await import('/src/items.js');
        ITEMS.testTrinket = {
          id: 'testTrinket',
          category: 'trinket',
          name: '测试饰品',
          textureKey: 'dart',
          description: ['测试用饰品。'],
          flavor: '仅供测试。',
        };
        const scene = window.game.scene.getScene('world');
        scene.inventory.addItem('testTrinket');
        scene.hud.refreshItems();
        return {
          trinkets: [...scene.inventory.trinkets],
          icon: !!scene.hud.icons.trinket[0],
        };
      });
      assert.deepEqual(trinketSetup.trinkets, ['testTrinket']);
      assert.equal(trinketSetup.icon, true, 'the trinket icon fills the first trinket slot');

      await moveToSlot(page, 'weapon', 1);
      await moveToSlot(page, 'trinket', 0);
      await waitForTooltip(page, true);
      const trinketView = await page.evaluate(() => {
        const tooltip = window.game.scene.getScene('world').hud.tooltip;
        return {
          name: tooltip.itemName,
          text: tooltip.runs.map((run) => run.text).join(''),
          flavor: tooltip.flavor,
        };
      });
      assert.equal(trinketView.name, '测试饰品');
      assert.equal(trinketView.text, '测试用饰品。');
      assert.equal(trinketView.flavor, '仅供测试。');
    } finally {
      await H.disposePage(page);
    }
  });

  test('I7 tooltip numbers follow live weapon stats', async () => {
    const page = await openWorld(browser);
    try {
      await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        scene.weaponOrbit.config.refillIntervalMs = 2500;
        scene.weaponOrbit.config.refillCount = 3;
        scene.weaponOrbit.config.slotCount = 12;
        scene.weaponOrbit.config.damage = 7;
      });

      await moveToSlot(page, 'weapon', 0);
      await waitForTooltip(page, true);

      const stats = await page.evaluate(() =>
        window.game.scene
          .getScene('world')
          .hud.tooltip.runs.filter((run) => run.stat)
          .map((run) => ({ stat: run.stat, text: run.text, color: run.color })),
      );
      assert.deepEqual(
        stats.map((run) => run.text),
        ['2.5', '3', '12', '7'],
        'seconds and counts are re-read on every hover',
      );
      assert.deepEqual(
        stats.map((run) => run.color),
        ['#6fd3ff', '#8ee08a', '#ffd166', '#ff8a7a'],
        'colours stay stable while values change',
      );
    } finally {
      await H.disposePage(page);
    }
  });
});
