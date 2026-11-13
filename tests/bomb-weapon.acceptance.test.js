'use strict';

/**
 * Acceptance suite for the purchasable bouncing bomb weapon.
 *
 * B1 the bomb catalogue entry: 600 gold, explosion damage, 10/80/10s base
 *    stats, the eight-step ladder and the level-8 bonus description.
 * B2 the shop sells the bomb once, equips it and removes it from the grid.
 * B3 the bomb targets the nearest enemy, plays one full 14-frame cherry-bomb
 *    animation over the flight, then deals 10 explosion damage in an 80px radius.
 * B4 at level 8 a 50% roll splits the explosion into one extra bouncing bomb
 *    aimed at the nearest enemy still alive after the blast (no radius limit)
 *    that plays the same full animation and does not chain again.
 * B5 the hover card shows only the description/flavour at level 1 and appends
 *    the chain line from level 8; the upgrade card previews 0% -> 50%.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness.js');

const PORT = Number(process.env.ACCEPTANCE_BOMB_PORT || 5205);
const URL = `http://127.0.0.1:${PORT}/`;

async function openWorld(browser) {
  const { page } = await H.openGameWithStart(browser, URL);
  await H.clearZombies(page, { pause: false });
  return page;
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
  const point = await page.evaluate(() => {
    const { goldButton } = window.game.scene.getScene('world').hud.layout;
    return { x: goldButton.x + goldButton.width / 2, y: goldButton.y + goldButton.height / 2 };
  });
  const canvasPoint = await H.canvasPoint(page, point.x, point.y);
  await page.mouse.click(canvasPoint.x, canvasPoint.y);
  await waitForShop(page, true);
  await H.frames(page, 2);
}

async function buyBombDirectly(page) {
  return page.evaluate(() => {
    const scene = window.game.scene.getScene('world');
    scene.addGold(1000);
    const result = scene.purchaseItem('bomb');
    return {
      result,
      gold: scene.gold,
      weapons: [...scene.inventory.weapons],
      hasBomb: !!scene.weaponInstances.get('bomb'),
    };
  });
}

async function placeBodies(page, placements) {
  return page.evaluate((entries) => {
    const scene = window.game.scene.getScene('world');
    const center = scene.player.body.center;
    return entries.map(({ index, dx, dy, hp }) => {
      const zombie = (window.__testZombies || [])[index];
      if (!zombie) throw new Error(`missing zombie ${index}`);
      if (typeof hp === 'number') zombie.hp = hp;
      const offsetX = zombie.body.center.x - zombie.gameObject.x;
      const offsetY = zombie.body.center.y - zombie.gameObject.y;
      zombie.body.reset(center.x + dx - offsetX, center.y + dy - offsetY);
      return {
        index,
        x: zombie.body.center.x,
        y: zombie.body.center.y,
        hp: zombie.hp,
      };
    });
  }, placements);
}

describe('bouncing bomb acceptance', () => {
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

  test('B1 the bomb defines the requested price, damage, ladder and texts', async () => {
    const page = await openWorld(browser);
    try {
      const data = await page.evaluate(async () => {
        const config = await import('/src/config.js');
        const items = await import('/src/items.js');
        const bomb = config.WEAPONS.bomb;
        const blockText = (block) =>
          block
            .map((part) => (part.stat ? `{${part.stat}}` : part.text))
            .join('');
        return {
          base: {
            name: bomb.name,
            category: items.getItem('bomb').category,
            price: bomb.price,
            damageType: bomb.damageType,
            damage: bomb.damage,
            cooldownMs: bomb.cooldownMs,
            radius: bomb.radius,
            chainChance: bomb.chainChance,
            maxLevel: bomb.maxLevel,
            textureKey: bomb.textureKey,
            mechanic: bomb.mechanic,
          },
          animation: { ...bomb.animation },
          explosion: { ...bomb.explosion },
          steps: bomb.upgradeSteps.map((step) => ({ ...step })),
          labels: { ...bomb.upgradeLabels },
          formats: { ...bomb.upgradeFormats },
          description: bomb.description.map(blockText),
          flavor: bomb.flavor,
          level1: items.getDescriptionBlocks(bomb, 1).length,
          level8: items.getDescriptionBlocks(bomb, 8).map(blockText),
          level7Upgrade: items.describeUpgrade(bomb, 7, {
            ...bomb,
            damage: 30,
            cooldownMs: 6000,
            radius: 120,
            chainChance: 0,
          }),
          dart: {
            textureKey: config.WEAPONS.dart.textureKey,
            projectileTextureKey: config.WEAPONS.dart.projectileTextureKey,
          },
        };
      });

      assert.deepEqual(data.base, {
        name: '蹦蹦炸弹',
        category: 'weapon',
        price: 600,
        damageType: 'explosion',
        damage: 10,
        cooldownMs: 10000,
        radius: 80,
        chainChance: 0,
        maxLevel: 8,
        textureKey: 'bomb',
        mechanic: 'bomb',
      });
      assert.equal(data.animation.textureKey, 'cherry-bomb');
      assert.equal(data.animation.frameCount, 14, 'the cherry bomb animation has 14 frames');
      assert.equal(data.animation.frameRate, 30, 'it plays at PvZ 30 fps');
      assert.equal(data.animation.displayHeight, 64);
      assert.equal(data.explosion.textureKey, 'bomb-explosion');
      assert.deepEqual(data.steps, [
        { damage: 15 },
        { cooldownMs: 8000 },
        { damage: 20 },
        { radius: 120 },
        { damage: 30 },
        { cooldownMs: 6000 },
        { chainChance: 0.5 },
      ]);
      assert.deepEqual(data.labels, {
        damage: '伤害',
        cooldownMs: '冷却时间',
        radius: '爆炸范围',
        chainChance: '连锁概率',
      });
      assert.deepEqual(data.formats, { cooldownMs: 'seconds', chainChance: 'percent' });
      assert.deepEqual(data.description, [
        '每隔{cooldownMs}秒，投掷炸弹，造成{damage}点范围伤害。',
      ]);
      assert.equal(data.flavor, '全都可以炸完~');
      assert.equal(data.level1, 1, 'the chain line is hidden before level 8');
      assert.deepEqual(data.level8, [
        '每隔{cooldownMs}秒，投掷炸弹，造成{damage}点范围伤害。',
        '蹦蹦炸弹爆炸后，有{chainChance}概率分裂并弹跳至最近敌人。',
      ]);
      assert.deepEqual(data.level7Upgrade, [
        {
          key: 'chainChance',
          label: '连锁概率',
          from: 0,
          to: 0.5,
          format: 'percent',
        },
      ]);
      assert.deepEqual(data.dart, { textureKey: 'dart', projectileTextureKey: 'dart-projectile' });
    } finally {
      await H.disposePage(page);
    }
  });

  test('B2 the shop sells the bomb once and hides it after purchase', async () => {
    const page = await openWorld(browser);
    try {
      await page.evaluate(() => window.game.scene.getScene('world').addGold(1000));
      await openShop(page);

      const before = await page.evaluate(() => {
        const shop = window.game.scene.getScene('shop');
        const world = window.game.scene.getScene('world');
        return {
          category: shop.category,
          entries: shop.listEntries.map((entry) => entry.id),
          selectedId: shop.selectedId,
          buy: shop.buyButton ? { ...shop.buyButton } : null,
          gold: world.gold,
        };
      });
      assert.equal(before.category, 'weapon');
      assert.deepEqual(before.entries, ['bomb'], 'only the unowned bomb is listed');
      assert.equal(before.selectedId, 'bomb');
      assert.equal(before.buy.itemId, 'bomb');
      assert.equal(before.buy.enabled, true);
      assert.equal(before.buy.label, '购买');
      assert.equal(before.gold, 1000);

      const after = await page.evaluate(() => {
        const shop = window.game.scene.getScene('shop');
        const world = window.game.scene.getScene('world');
        const result = shop.purchase();
        const texts = [];
        const collect = (list) => {
          for (const child of list) {
            if (typeof child.text === 'string') texts.push(child.text);
            if (Array.isArray(child.list)) collect(child.list);
          }
        };
        collect(shop.children.list);
        return {
          result,
          gold: world.gold,
          weapons: [...world.inventory.weapons],
          entries: shop.listEntries.map((entry) => entry.id),
          selectedId: shop.selectedId,
          buy: shop.buyButton,
          texts,
          notice: shop.noticeText.text,
          hudIcon: world.hud.icons.weapon[1]
            ? {
                visible: world.hud.icons.weapon[1].visible,
                texture: world.hud.icons.weapon[1].texture.key,
              }
            : null,
          weapon: (() => {
            const bomb = world.weaponInstances.get('bomb');
            return bomb
              ? { level: bomb.level, damage: bomb.config.damage, damageType: bomb.config.damageType }
              : null;
          })(),
          weaponStock: shop.getShopItems('weapon').map((item) => item.id),
          trinketStock: shop.getShopItems('trinket').map((item) => item.id),
        };
      });

      assert.equal(after.result.ok, true);
      assert.equal(after.result.item.name, '蹦蹦炸弹');
      assert.equal(after.gold, 400, 'the bomb costs 600 of the 1000 gold');
      assert.deepEqual(after.weapons, ['dart', 'bomb']);
      assert.deepEqual(after.entries, [], 'the owned bomb leaves the shop grid');
      assert.equal(after.selectedId, null);
      assert.equal(after.buy, null);
      assert.ok(after.texts.includes('暂无商品'), 'the emptied weapon tab shows the placeholder');
      assert.equal(after.notice, '已购买 蹦蹦炸弹');
      assert.deepEqual(after.hudIcon, { visible: true, texture: 'bomb' });
      assert.deepEqual(after.weapon, { level: 1, damage: 10, damageType: 'explosion' });
      assert.deepEqual(after.weaponStock, []);
      assert.deepEqual(after.trinketStock, ['ruby']);

      await page.evaluate(() => window.game.scene.getScene('shop').close());
      await waitForShop(page, false);
      await page.evaluate(() => window.game.scene.getScene('world').openShop());
      await waitForShop(page, true);
      await H.frames(page, 2);

      const reopened = await page.evaluate(() => {
        const shop = window.game.scene.getScene('shop');
        return {
          category: shop.category,
          selectedId: shop.selectedId,
          entries: shop.listEntries.map((entry) => entry.id),
        };
      });
      assert.deepEqual(reopened, { category: 'trinket', selectedId: 'ruby', entries: ['ruby'] });
    } finally {
      await H.disposePage(page);
    }
  });

  test('B3 the bomb targets the nearest zombie and resolves one full animation', async () => {
    const page = await openWorld(browser);
    try {
      await H.removeAllDarts(page);
      const purchased = await buyBombDirectly(page);
      assert.equal(purchased.result.ok, true);
      assert.equal(purchased.hasBomb, true);

      await H.spawnTestZombie(page, 400, 400, { maxHp: 30 });
      await H.spawnTestZombie(page, 400, 400, { maxHp: 30 });
      await H.spawnTestZombie(page, 400, 400, { maxHp: 30 });
      await placeBodies(page, [
        { index: 0, dx: 200, dy: 0 },
        { index: 1, dx: 260, dy: 0 },
        { index: 2, dx: 700, dy: 0 },
      ]);

      const started = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        const bomb = scene.weaponInstances.get('bomb');
        bomb.nextThrowAt = scene.time.now;
        return {
          duration: (bomb.config.animation.frameCount / bomb.config.animation.frameRate) * 1000,
          frameCount: bomb.config.animation.frameCount,
          frameRate: bomb.config.animation.frameRate,
        };
      });
      await page.waitForFunction(
        () => window.game.scene.getScene('world').weaponInstances.get('bomb').flights.size === 1,
        null,
        { timeout: 5000, polling: 20 },
      );

      const flight = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        const bomb = scene.weaponInstances.get('bomb');
        const [active] = [...bomb.flights];
        return {
          chain: active.chain,
          duration: active.duration,
          frames: (() => {
            const anim = active.sprite.anims.currentAnim;
            return anim ? anim.frames.length : 0;
          })(),
          playing: active.sprite.anims.isPlaying,
          animationKey: active.sprite.anims.currentAnim
            ? active.sprite.anims.currentAnim.key
            : null,
          texture: active.sprite.texture.key,
          targetIndex: (window.__testZombies || []).findIndex((z) => z === active.target),
          targetCenter: {
            x: active.target.body.center.x,
            y: active.target.body.center.y,
          },
        };
      });
      assert.equal(flight.chain, false);
      assert.equal(flight.targetIndex, 0, 'the nearest zombie is the primary target');
      assert.equal(flight.texture, 'cherry-bomb');
      assert.equal(flight.animationKey, 'cherry-bomb-throw');
      assert.equal(flight.playing, true);
      assert.equal(flight.frames, started.frameCount);
      assert.equal(flight.duration, started.duration);
      assert.equal(started.frameCount, 14);
      assert.equal(started.frameRate, 30);

      await page.waitForFunction(
        () => window.game.scene.getScene('world').weaponInstances.get('bomb').flights.size === 0,
        null,
        { timeout: 5000, polling: 20 },
      );

      const blast = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        const list = scene.children.list;
        const zombies = (window.__testZombies || []).slice(0, 3).map((zombie) => ({
          hp: zombie.hp,
          dead: zombie.dead,
          damageType: zombie.lastDamageType,
        }));
        return {
          zombies,
          flights: scene.weaponInstances.get('bomb').flights.size,
          bombSprites: list.filter((o) => o.texture && o.texture.key === 'cherry-bomb').length,
          explosionSprites: list.filter((o) => o.texture && o.texture.key === 'bomb-explosion').length,
        };
      });

      assert.deepEqual(blast.zombies, [
        { hp: 20, dead: false, damageType: 'explosion' },
        { hp: 20, dead: false, damageType: 'explosion' },
        { hp: 30, dead: false, damageType: null },
      ]);
      assert.equal(blast.flights, 0);
      assert.equal(blast.bombSprites, 0, 'the bomb sprite is gone once the animation ends');
      assert.ok(blast.explosionSprites >= 1, 'the landing plays the PvZ 砰 explosion');
    } finally {
      await H.disposePage(page);
    }
  });

  test('B4 level 8 rolls one split bomb that bounces to another enemy', async () => {
    const page = await openWorld(browser);
    try {
      await H.removeAllDarts(page);
      const setup = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        scene.addGold(1000);
        scene.purchaseItem('bomb');
        scene.upgradePoints = 7;
        const index = scene.inventory.weapons.indexOf('bomb');
        for (let step = 0; step < 7; step += 1) {
          if (!scene.upgradeWeapon(index)) throw new Error(`upgrade ${step + 1} failed`);
        }
        const bomb = scene.weaponInstances.get('bomb');
        return {
          level: bomb.level,
          damage: bomb.config.damage,
          radius: bomb.config.radius,
          chainChance: bomb.config.chainChance,
          points: scene.upgradePoints,
        };
      });
      assert.deepEqual(setup, {
        level: 8,
        damage: 30,
        radius: 120,
        chainChance: 0.5,
        points: 0,
      });

      await H.spawnTestZombie(page, 400, 400, { maxHp: 30 });
      await H.spawnTestZombie(page, 400, 400, { maxHp: 100 });
      await H.spawnTestZombie(page, 400, 400, { maxHp: 100 });
      await placeBodies(page, [
        { index: 0, dx: 200, dy: 0 },
        { index: 1, dx: 500, dy: 0 },
        { index: 2, dx: 700, dy: 0 },
      ]);

      await page.evaluate(() => {
        window.__originalRandom = Math.random;
        Math.random = () => 0;
        const scene = window.game.scene.getScene('world');
        scene.weaponInstances.get('bomb').nextThrowAt = scene.time.now;
      });

      await page.waitForFunction(
        () => {
          const bomb = window.game.scene.getScene('world').weaponInstances.get('bomb');
          return [...bomb.flights].some((flight) => flight.chain);
        },
        null,
        { timeout: 5000, polling: 20 },
      );

      const chainFlight = await page.evaluate(() => {
        const bomb = window.game.scene.getScene('world').weaponInstances.get('bomb');
        const active = [...bomb.flights].find((flight) => flight.chain);
        const frameCount = active.sprite.anims.currentAnim
          ? active.sprite.anims.currentAnim.frames.length
          : 0;
        const targetCenter = active.target.body.center;
        return {
          chain: active.chain,
          targetIndex: (window.__testZombies || []).findIndex((z) => z === active.target),
          duration: active.duration,
          frames: frameCount,
          playing: active.sprite.anims.isPlaying,
          texture: active.sprite.texture.key,
          blastPoint: { x: active.from.x, y: active.from.y },
          targetCenter: { x: targetCenter.x, y: targetCenter.y },
          radius: bomb.config.radius,
        };
      });
      assert.equal(chainFlight.chain, true);
      assert.equal(chainFlight.targetIndex, 1, 'the split targets the nearest surviving enemy');
      const chainDistance = Math.hypot(
        chainFlight.targetCenter.x - chainFlight.blastPoint.x,
        chainFlight.targetCenter.y - chainFlight.blastPoint.y,
      );
      assert.ok(
        chainDistance > chainFlight.radius,
        `the split must ignore the old blast radius: target is ${chainDistance.toFixed(1)}px away, radius ${chainFlight.radius}`,
      );
      assert.equal(chainFlight.frames, 14, 'the split plays the same full animation');
      assert.equal(chainFlight.duration, (14 / 30) * 1000);
      assert.equal(chainFlight.playing, true);
      assert.equal(chainFlight.texture, 'cherry-bomb');

      await page.waitForFunction(
        () => window.game.scene.getScene('world').weaponInstances.get('bomb').flights.size === 0,
        null,
        { timeout: 5000, polling: 20 },
      );
      await page.waitForTimeout(700);

      const result = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        const bomb = scene.weaponInstances.get('bomb');
        return {
          flights: bomb.flights.size,
          chainChance: bomb.config.chainChance,
          zombies: (window.__testZombies || []).slice(0, 3).map((zombie) => ({
            hp: zombie.hp,
            dead: zombie.dead,
            damageType: zombie.lastDamageType,
          })),
        };
      });
      assert.equal(result.flights, 0, 'the split bomb does not chain again');
      assert.equal(result.chainChance, 0.5);
      assert.deepEqual(result.zombies, [
        { hp: 0, dead: true, damageType: 'explosion' },
        { hp: 70, dead: false, damageType: 'explosion' },
        { hp: 100, dead: false, damageType: null },
      ]);

      await page.evaluate(() => {
        Math.random = window.__originalRandom;
      });
    } finally {
      await H.disposePage(page);
    }
  });

  test('B5 the hover card unlocks the chain line at level 8 and previews 50%', async () => {
    const page = await openWorld(browser);
    try {
      await H.removeAllDarts(page);
      await buyBombDirectly(page);

      const slotPoint = await page.evaluate(() => {
        const slot = window.game.scene.getScene('world').hud.layout.weaponSlots[1];
        return { x: slot.x + slot.size / 2, y: slot.y + slot.size / 2 };
      });
      const canvasPoint = await H.canvasPoint(page, slotPoint.x, slotPoint.y);
      await page.mouse.move(canvasPoint.x, canvasPoint.y);
      await page.waitForFunction(
        () => window.game.scene.getScene('world').hud.tooltip.visible,
        null,
        { timeout: 5000, polling: 50 },
      );

      const level1 = await page.evaluate(() => {
        const tooltip = window.game.scene.getScene('world').hud.tooltip;
        return {
          name: tooltip.itemName,
          text: tooltip.runs.map((run) => run.text).join(''),
          flavor: tooltip.flavor,
        };
      });
      assert.equal(level1.name, '蹦蹦炸弹');
      assert.equal(level1.text, '每隔10秒，投掷炸弹，造成10点范围伤害。');
      assert.equal(level1.flavor, '全都可以炸完~');

      const away = await H.canvasPoint(page, H.GAME_WIDTH / 2, H.GAME_HEIGHT / 2 - 100);
      await page.mouse.move(away.x, away.y);
      await H.frames(page, 2);

      const preview = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        scene.upgradePoints = 6;
        const index = scene.inventory.weapons.indexOf('bomb');
        for (let step = 0; step < 6; step += 1) scene.upgradeWeapon(index);
        scene.upgradePoints = 1;
        scene.hud.refreshItems();
        return {
          level: scene.weaponInstances.get('bomb').level,
          buttonIndex: index,
          sourceLevel: scene.getWeaponLevel('bomb'),
        };
      });
      assert.deepEqual(preview, { level: 7, buttonIndex: 1, sourceLevel: 7 });

      const button = await page.evaluate(() => {
        const entry = window.game.scene.getScene('world').hud.upgradeButtons[1];
        return { x: entry.x, y: entry.y };
      });
      const buttonPoint = await H.canvasPoint(page, button.x, button.y);
      await page.mouse.move(buttonPoint.x, buttonPoint.y);
      await page.waitForFunction(
        () =>
          window.game.scene.getScene('world').hud.tooltip.visible &&
          window.game.scene.getScene('world').hud.tooltip.mode === 'upgrade',
        null,
        { timeout: 5000, polling: 50 },
      );

      const upgrade = await page.evaluate(() => {
        const tooltip = window.game.scene.getScene('world').hud.tooltip;
        return {
          changes: tooltip.upgrade.changes,
          text: tooltip.runs.map((run) => run.text).join(''),
        };
      });
      assert.deepEqual(upgrade.changes, [
        { key: 'chainChance', label: '连锁概率', from: 0, to: 0.5, format: 'percent' },
      ]);
      assert.equal(upgrade.text, '连锁概率 0% → 50%');

      await page.evaluate(() => window.game.scene.getScene('world').upgradeWeapon(1));
      await H.frames(page, 2);
      await page.mouse.move(canvasPoint.x, canvasPoint.y);
      await page.waitForFunction(
        () =>
          window.game.scene.getScene('world').hud.tooltip.visible &&
          window.game.scene.getScene('world').hud.tooltip.mode === 'item',
        null,
        { timeout: 5000, polling: 50 },
      );

      const level8 = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        const tooltip = scene.hud.tooltip;
        return {
          level: scene.getWeaponLevel('bomb'),
          text: tooltip.runs.map((run) => run.text).join(''),
          chanceRun: tooltip.runs.find((run) => run.stat === 'chainChance') || null,
          flavor: tooltip.flavor,
        };
      });
      assert.equal(level8.level, 8);
      assert.equal(
        level8.text,
        '每隔6秒，投掷炸弹，造成30点范围伤害。蹦蹦炸弹爆炸后，有50%概率分裂并弹跳至最近敌人。',
      );
      assert.equal(level8.chanceRun.text, '50%');
      assert.equal(level8.chanceRun.color, '#c3a6ff');
      assert.equal(level8.flavor, '全都可以炸完~');
    } finally {
      await H.disposePage(page);
    }
  });
});
