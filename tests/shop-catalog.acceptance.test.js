'use strict';

/**
 * Acceptance suite for the shop catalogue and the first trinket.
 *
 * S1 the shop splits into a wide square-cell goods grid and a narrow detail
 *    panel, with weapon/trinket tabs; ruby is listed at 100 gold.
 * S2 buying without enough gold is rejected and the run keeps its state.
 * S3 each ruby purchase spends 100 gold, fills the next trinket slot and adds
 *    +10 current/max HP; the same trinket can be bought again.
 * S4 switching categories swaps the grid and the detail panel.
 * S5 repeated rubies fill all six slots and the seventh purchase is refused.
 * S6 extra goods wrap into rows of equal square cells without overlapping.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness.js');

const PORT = Number(process.env.ACCEPTANCE_SHOP_PORT || 5203);
const URL = `http://127.0.0.1:${PORT}/`;

async function openWorld(browser) {
  const { page } = await H.openGameWithStart(browser, URL);
  await H.clearZombies(page, { pause: false });
  return page;
}

async function clickGold(page) {
  const point = await page.evaluate(() => {
    const { goldButton } = window.game.scene.getScene('world').hud.layout;
    return { x: goldButton.x + goldButton.width / 2, y: goldButton.y + goldButton.height / 2 };
  });
  const canvasPoint = await H.canvasPoint(page, point.x, point.y);
  await page.mouse.click(canvasPoint.x, canvasPoint.y);
}

function waitForShop(page, open) {
  return page.waitForFunction(
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

async function openShop(page) {
  await clickGold(page);
  await waitForShop(page, true);
  await H.frames(page, 2);
}

async function clickGamePoint(page, point) {
  const canvasPoint = await H.canvasPoint(page, point.x, point.y);
  await page.mouse.click(canvasPoint.x, canvasPoint.y);
}

function collectTexts() {
  const texts = [];
  const collect = (list) => {
    for (const child of list) {
      if (typeof child.text === 'string') texts.push(child.text);
      if (Array.isArray(child.list)) collect(child.list);
    }
  };
  const shop = window.game.scene.getScene('shop');
  collect(shop.children.list);
  return texts;
}

async function moveToTrinketSlot(page, index) {
  const point = await page.evaluate((slotIndex) => {
    const slot = window.game.scene.getScene('world').hud.layout.trinketSlots[slotIndex];
    return { x: slot.x + slot.size / 2, y: slot.y + slot.size / 2 };
  }, index);
  const canvasPoint = await H.canvasPoint(page, point.x, point.y);
  await page.mouse.move(canvasPoint.x, canvasPoint.y);
  await H.frames(page, 2);
}

describe('shop catalogue acceptance', () => {
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

  test('S1 the shop splits into a goods list and a detail panel with tabs', async () => {
    const page = await openWorld(browser);
    try {
      await openShop(page);
      const view = await page.evaluate(async () => {
        const { ITEMS } = await import('/src/items.js');
        const shop = window.game.scene.getScene('shop');
        const world = window.game.scene.getScene('world');
        const item = ITEMS.ruby;
        const initial = {
          category: shop.category,
          selectedId: shop.selectedId,
          entries: shop.listEntries.map((entry) => entry.id),
        };
        shop.selectCategory('trinket');
        return {
          ruby: {
            id: item.id,
            name: item.name,
            category: item.category,
            textureKey: item.textureKey,
            price: item.price,
            description: item.description,
            flavor: item.flavor,
            effects: item.effects,
          },
          tabs: shop.tabs.map((tab) => ({ id: tab.id, label: tab.text.text })),
          initial,
          category: shop.category,
          layout: {
            panel: { ...shop.layout.panel },
            list: { ...shop.layout.list },
            detail: { ...shop.layout.detail },
          },
          grid: { ...shop.grid },
          listEntries: shop.listEntries.map((entry) => ({
            id: entry.id,
            x: entry.x,
            y: entry.y,
            width: entry.width,
            height: entry.height,
          })),
          texts: collectTexts(),
          buyButton: shop.buyButton ? { ...shop.buyButton } : null,
          goldLabel: shop.goldText.text,
          gold: world.gold,
        };

        function collectTexts() {
          const texts = [];
          const collect = (list) => {
            for (const child of list) {
              if (typeof child.text === 'string') texts.push(child.text);
              if (Array.isArray(child.list)) collect(child.list);
            }
          };
          collect(shop.children.list);
          return texts;
        }
      });

      assert.deepEqual(view.ruby, {
        id: 'ruby',
        name: '红宝石',
        category: 'trinket',
        textureKey: 'ruby',
        price: 100,
        description: ['生命与最大生命+10。'],
        flavor: '这个加血，这个厉害。',
        effects: { hp: 10, maxHp: 10 },
      });
      assert.deepEqual(view.tabs, [
        { id: 'weapon', label: '武器' },
        { id: 'trinket', label: '饰品' },
      ]);
      assert.deepEqual(
        view.initial,
        { category: 'weapon', selectedId: 'bomb', entries: ['bomb'] },
        'the shop opens on the stocked weapon before switching tabs',
      );
      assert.equal(view.category, 'trinket', 'the trinket tab is selected for the ruby checks');

      const { panel, list, detail } = view.layout;
      assert.ok(list.width > detail.width, 'the goods list takes the larger left half');
      assert.ok(
        list.width / (list.width + detail.width) > 0.6,
        'the list occupies more than 60% of the content width',
      );
      assert.ok(list.x >= panel.x && detail.x + detail.width <= panel.x + panel.width);
      assert.equal(detail.x, list.x + list.width + 20, 'the detail panel attaches to the right');
      assert.ok(list.y === detail.y && list.height === detail.height);

      assert.deepEqual(view.listEntries.map((entry) => entry.id), ['ruby']);
      assert.equal(view.grid.columns, 4, 'goods sit in a four-column grid');
      const entry = view.listEntries[0];
      assert.equal(entry.width, entry.height, 'each goods entry is a square cell');
      assert.equal(entry.width, view.grid.cell);
      assert.ok(
        entry.x >= list.x &&
          entry.x + entry.width <= list.x + list.width &&
          entry.y >= list.y &&
          entry.y + entry.height <= list.y + list.height,
        'the ruby cell fits inside the goods grid',
      );

      for (const text of [
        '红宝石',
        '饰品 · 100 金币',
        '生命与最大生命+10。',
        '这个加血，这个厉害。',
        '金钱不足，还差 100',
        '退出',
        '按 ESC 关闭商店',
      ]) {
        assert.ok(view.texts.includes(text), `the shop shows "${text}"`);
      }
      assert.equal(view.goldLabel, '0');
      assert.equal(view.gold, 0);
      assert.ok(view.buyButton, 'the detail panel exposes a buy button');
      assert.equal(view.buyButton.enabled, false);
      assert.equal(view.buyButton.label, '金钱不足');
    } finally {
      await H.disposePage(page);
    }
  });

  test('S2 buying without enough gold is rejected', async () => {
    const page = await openWorld(browser);
    try {
      await openShop(page);
      const result = await page.evaluate(() => {
        const shop = window.game.scene.getScene('shop');
        const world = window.game.scene.getScene('world');
        const purchase = shop.purchase();
        return {
          purchase,
          gold: world.gold,
          inventory: {
            weapons: [...world.inventory.weapons],
            trinkets: [...world.inventory.trinkets],
          },
          notice: shop.noticeText.text,
          buyLabel: shop.buyButton.label,
          buyEnabled: shop.buyButton.enabled,
        };
      });

      assert.deepEqual(result.purchase, { ok: false, reason: 'gold' });
      assert.equal(result.gold, 0);
      assert.deepEqual(result.inventory, { weapons: ['dart'], trinkets: [] });
      assert.equal(result.notice, '金钱不足');
      assert.equal(result.buyLabel, '金钱不足');
      assert.equal(result.buyEnabled, false);
    } finally {
      await H.disposePage(page);
    }
  });

  test('S3 each ruby costs 100 gold and grants +10 current and max HP', async () => {
    const page = await openWorld(browser);
    try {
      await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        scene.addGold(250);
      });
      await openShop(page);
      await page.evaluate(() => window.game.scene.getScene('shop').selectCategory('trinket'));
      await H.frames(page, 2);

      const clickBuy = async () => {
        const buy = await page.evaluate(() => {
          const shop = window.game.scene.getScene('shop');
          return { ...shop.buyButton };
        });
        await clickGamePoint(page, {
          x: buy.x + buy.width / 2,
          y: buy.y + buy.height / 2,
        });
      };

      const ready = await page.evaluate(() => {
        const shop = window.game.scene.getScene('shop');
        return {
          goldLabel: shop.goldText.text,
          buy: { ...shop.buyButton },
        };
      });
      assert.equal(ready.goldLabel, '250');
      assert.equal(ready.buy.enabled, true);
      assert.equal(ready.buy.label, '购买');

      await clickBuy();
      await page.waitForFunction(
        () => window.game.scene.getScene('world').inventory.trinkets.length === 1,
        null,
        { timeout: 5000, polling: 50 },
      );
      await H.frames(page, 2);

      const first = await page.evaluate(() => {
        const shop = window.game.scene.getScene('shop');
        const world = window.game.scene.getScene('world');
        return {
          gold: world.gold,
          hp: world.hp,
          maxHp: world.maxHp,
          trinkets: [...world.inventory.trinkets],
          buy: { ...shop.buyButton },
          notice: shop.noticeText.text,
        };
      });
      assert.equal(first.gold, 150);
      assert.equal(first.hp, 658);
      assert.equal(first.maxHp, 658);
      assert.deepEqual(first.trinkets, ['ruby']);
      assert.equal(first.buy.enabled, true, 'the same trinket can be bought again');
      assert.equal(first.buy.label, '购买');
      assert.equal(first.notice, '已购买 红宝石');

      await clickBuy();
      await page.waitForFunction(
        () => window.game.scene.getScene('world').inventory.trinkets.length === 2,
        null,
        { timeout: 5000, polling: 50 },
      );
      await H.frames(page, 2);

      const bought = await page.evaluate(() => {
        const shop = window.game.scene.getScene('shop');
        const world = window.game.scene.getScene('world');
        const hud = world.hud;
        return {
          gold: world.gold,
          hp: world.hp,
          maxHp: world.maxHp,
          hpText: hud.hpText.text,
          goldText: hud.goldText.text,
          inventory: {
            weapons: [...world.inventory.weapons],
            trinkets: [...world.inventory.trinkets],
          },
          icons: hud.icons.trinket.map((icon) =>
            icon
              ? {
                  visible: icon.visible,
                  texture: icon.texture.key,
                  x: icon.x,
                  y: icon.y,
                  size: icon.displayWidth,
                }
              : null,
          ),
          slots: hud.layout.trinketSlots.map((slot) => ({ ...slot })),
          shopGold: shop.goldText.text,
          buy: { ...shop.buyButton },
          notice: shop.noticeText.text,
          texts: collectTexts(),
          repurchase: shop.purchase(),
        };

        function collectTexts() {
          const texts = [];
          const collect = (list) => {
            for (const child of list) {
              if (typeof child.text === 'string') texts.push(child.text);
              if (Array.isArray(child.list)) collect(child.list);
            }
          };
          collect(shop.children.list);
          return texts;
        }
      });

      assert.equal(bought.gold, 50, 'two rubies cost 200 of the 250 gold');
      assert.deepEqual(bought.inventory, {
        weapons: ['dart'],
        trinkets: ['ruby', 'ruby'],
      });
      assert.equal(bought.hp, 668, 'each ruby adds 10 current HP');
      assert.equal(bought.maxHp, 668, 'each ruby adds 10 max HP');
      assert.equal(bought.hpText, '668 / 668');
      assert.equal(bought.goldText, '50');
      assert.equal(bought.shopGold, '50');

      for (const index of [0, 1]) {
        const icon = bought.icons[index];
        const slot = bought.slots[index];
        assert.ok(icon, `ruby copy ${index + 1} fills trinket slot ${index + 1}`);
        assert.equal(icon.visible, true);
        assert.equal(icon.texture, 'ruby');
        assert.equal(icon.x, slot.x + slot.size / 2);
        assert.equal(icon.y, slot.y + slot.size / 2);
        assert.ok(icon.size < slot.size);
      }
      assert.equal(bought.buy.enabled, false, '50 gold is not enough for a third ruby');
      assert.equal(bought.buy.label, '金钱不足');
      assert.ok(bought.texts.includes('×2'), 'the grid cell counts both copies');
      assert.equal(bought.notice, '已购买 红宝石');
      assert.equal(bought.repurchase.ok, false);
      assert.equal(
        bought.repurchase.reason,
        'gold',
        'repeat purchases are limited by gold, not ownership',
      );

      await page.keyboard.press('Escape');
      await waitForShop(page, false);

      await moveToTrinketSlot(page, 0);
      await page.waitForFunction(
        () => window.game.scene.getScene('world').hud.tooltip.visible,
        null,
        { timeout: 5000, polling: 50 },
      );
      const tooltip = await page.evaluate(() => {
        const tip = window.game.scene.getScene('world').hud.tooltip;
        return {
          name: tip.itemName,
          text: tip.runs.map((run) => run.text).join(''),
          stats: tip.runs.filter((run) => run.stat).length,
          flavor: tip.flavor,
        };
      });
      assert.equal(tooltip.name, '红宝石');
      assert.equal(tooltip.text, '生命与最大生命+10。');
      assert.equal(tooltip.stats, 0, 'the hover card only carries the description text');
      assert.equal(tooltip.flavor, '这个加血，这个厉害。');
    } finally {
      await H.disposePage(page);
    }
  });

  test('S4 category tabs switch between the bomb and ruby detail panels', async () => {
    const page = await openWorld(browser);
    try {
      await openShop(page);
      const tabPoint = await page.evaluate(() => {
        const shop = window.game.scene.getScene('shop');
        const tab = shop.tabs.find((entry) => entry.id === 'weapon').bg;
        return { x: tab.x + tab.width / 2, y: tab.y + tab.height / 2 };
      });
      await clickGamePoint(page, tabPoint);
      await H.frames(page, 2);

      const weapons = await page.evaluate(() => {
        const shop = window.game.scene.getScene('shop');
        const texts = [];
        const collect = (list) => {
          for (const child of list) {
            if (typeof child.text === 'string') texts.push(child.text);
            if (Array.isArray(child.list)) collect(child.list);
          }
        };
        collect(shop.children.list);
        return {
          category: shop.category,
          selectedId: shop.selectedId,
          buyButton: shop.buyButton,
          texts,
        };
      });
      assert.equal(weapons.category, 'weapon');
      assert.equal(weapons.selectedId, 'bomb', 'the weapon tab selects the bomb');
      assert.ok(weapons.buyButton, 'the bomb detail panel offers a buy button');
      assert.equal(weapons.buyButton.itemId, 'bomb');
      assert.equal(weapons.buyButton.enabled, false);
      assert.equal(weapons.buyButton.label, '金钱不足');
      for (const text of ['蹦蹦炸弹', '武器 · 600 金币', '每隔10秒，投掷炸弹，造成10点范围伤害。', '全都可以炸完~']) {
        assert.ok(weapons.texts.includes(text), `the weapon tab shows "${text}"`);
      }

      const trinketPoint = await page.evaluate(() => {
        const shop = window.game.scene.getScene('shop');
        const tab = shop.tabs.find((entry) => entry.id === 'trinket').bg;
        return { x: tab.x + tab.width / 2, y: tab.y + tab.height / 2 };
      });
      await clickGamePoint(page, trinketPoint);
      await H.frames(page, 2);

      const trinkets = await page.evaluate(() => {
        const shop = window.game.scene.getScene('shop');
        return {
          category: shop.category,
          selectedId: shop.selectedId,
          buyButton: shop.buyButton ? { ...shop.buyButton } : null,
        };
      });
      assert.equal(trinkets.category, 'trinket');
      assert.equal(trinkets.selectedId, 'ruby');
      assert.ok(trinkets.buyButton);
      assert.equal(trinkets.buyButton.itemId, 'ruby');
    } finally {
      await H.disposePage(page);
    }
  });

  test('S5 repeated rubies fill all six slots and the seventh is refused', async () => {
    const page = await openWorld(browser);
    try {
      await page.evaluate(() => {
        window.game.scene.getScene('world').addGold(1000);
      });
      await openShop(page);
      await page.evaluate(() => window.game.scene.getScene('shop').selectCategory('trinket'));
      await H.frames(page, 2);

      const result = await page.evaluate(() => {
        const shop = window.game.scene.getScene('shop');
        const world = window.game.scene.getScene('world');
        const purchases = [];
        for (let index = 0; index < 7; index += 1) purchases.push(shop.purchase());

        const texts = [];
        const collect = (list) => {
          for (const child of list) {
            if (typeof child.text === 'string') texts.push(child.text);
            if (Array.isArray(child.list)) collect(child.list);
          }
        };
        collect(shop.children.list);

        return {
          results: purchases.map((entry) => ({
            ok: entry.ok,
            reason: entry.reason || null,
          })),
          gold: world.gold,
          hp: world.hp,
          maxHp: world.maxHp,
          trinkets: [...world.inventory.trinkets],
          icons: world.hud.icons.trinket.map((icon) =>
            icon ? { visible: icon.visible, texture: icon.texture.key } : null,
          ),
          buy: { ...shop.buyButton },
          notice: shop.noticeText.text,
          texts,
        };
      });

      assert.deepEqual(result.results, [
        { ok: true, reason: null },
        { ok: true, reason: null },
        { ok: true, reason: null },
        { ok: true, reason: null },
        { ok: true, reason: null },
        { ok: true, reason: null },
        { ok: false, reason: 'full' },
      ]);
      assert.equal(result.gold, 400, 'six rubies cost 600 of the 1000 gold');
      assert.equal(result.hp, 708);
      assert.equal(result.maxHp, 708);
      assert.deepEqual(result.trinkets, Array(6).fill('ruby'), 'each copy keeps its own slot');
      assert.equal(result.icons.length, 6);
      for (const icon of result.icons) {
        assert.ok(icon && icon.visible, 'every trinket slot shows a ruby');
        assert.equal(icon.texture, 'ruby');
      }
      assert.equal(result.buy.enabled, false);
      assert.equal(result.buy.label, '栏位已满');
      assert.equal(result.notice, '栏位已满');
      assert.ok(result.texts.includes('×6'), 'the grid badge counts all six copies');
      assert.ok(result.texts.includes('饰品栏已满 · 不可堆叠'));
    } finally {
      await H.disposePage(page);
    }
  });

  test('S6 extra goods wrap into rows of equal square cells', async () => {
    const page = await openWorld(browser);
    try {
      await openShop(page);
      const view = await page.evaluate(async () => {
        const { ITEMS } = await import('/src/items.js');
        for (let index = 1; index <= 4; index += 1) {
          ITEMS[`test${index}`] = {
            id: `test${index}`,
            name: `测试${index}`,
            category: 'trinket',
            textureKey: 'ruby',
            price: 50,
            description: ['测试商品。'],
            flavor: '仅供测试。',
            effects: {},
          };
        }

        const shop = window.game.scene.getScene('shop');
        shop.selectCategory('trinket');
        shop.renderList();
        return {
          list: { ...shop.layout.list },
          entries: shop.listEntries.map((entry) => ({
            id: entry.id,
            x: entry.x,
            y: entry.y,
            width: entry.width,
            height: entry.height,
          })),
        };
      });

      assert.equal(view.entries.length, 5, 'ruby plus four test trinkets');
      const cell = view.entries[0].width;
      for (const entry of view.entries) {
        assert.equal(entry.width, cell);
        assert.equal(entry.height, cell, 'every cell stays square');
        assert.ok(
          entry.x >= view.list.x &&
            entry.x + entry.width <= view.list.x + view.list.width &&
            entry.y >= view.list.y &&
            entry.y + entry.height <= view.list.y + view.list.height,
          `${entry.id} stays inside the goods grid`,
        );
      }

      const firstRow = view.entries.slice(0, 4);
      assert.equal(new Set(firstRow.map((entry) => entry.y)).size, 1, 'four cells per row');
      assert.deepEqual(
        firstRow.map((entry) => entry.x),
        [...firstRow.map((entry) => entry.x)].sort((a, b) => a - b),
        'cells advance left to right',
      );
      assert.ok(
        view.entries[4].y > firstRow[0].y,
        'the fifth cell wraps to the second row',
      );

      for (let i = 0; i < view.entries.length; i += 1) {
        for (let j = i + 1; j < view.entries.length; j += 1) {
          const a = view.entries[i];
          const b = view.entries[j];
          const overlaps =
            a.x < b.x + b.width &&
            b.x < a.x + a.width &&
            a.y < b.y + b.height &&
            b.y < a.y + a.height;
          assert.equal(overlaps, false, `${a.id} and ${b.id} do not overlap`);
        }
      }
    } finally {
      await H.disposePage(page);
    }
  });
});
