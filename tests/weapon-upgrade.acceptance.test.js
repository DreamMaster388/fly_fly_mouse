'use strict';

/**
 * Acceptance suite for the weapon upgrade system.
 *
 * U1 the dart exposes eight levels, an absolute upgrade ladder and a damage type.
 * U2 every player level-up grants one upgrade point and reveals the XP button
 *    above the weapon row, outside the middle frame.
 * U3 clicking the button spends one point, applies the next stat and lights a
 *    weapon-level pip; max level and empty points disable the button.
 * U4 hovering the button previews only the numeric change of that upgrade.
 * U5 the full ladder reaches damage 4/6/8, refill 800/600 ms, double orbit speed
 *    and a 16-dart two-ring layout that refills the inner ring first.
 * U6 dart hits are classified as normal damage.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness.js');

const PORT = Number(process.env.ACCEPTANCE_UPGRADE_PORT || 5189);
const URL = `http://127.0.0.1:${PORT}/`;

async function openWorld(browser) {
  const { page } = await H.openGameWithStart(browser, URL);
  await H.clearZombies(page, { pause: false });
  return page;
}

async function grantLevels(page, count) {
  await page.evaluate((levels) => {
    const scene = window.game.scene.getScene('world');
    for (let i = 0; i < levels && scene.level < 18; i += 1) {
      scene.addXp(scene.xpToNext - scene.xp);
    }
  }, count);
  await H.frames(page, 2);
}

function readUpgradeState(page) {
  return page.evaluate(() => {
    const scene = window.game.scene.getScene('world');
    const hud = scene.hud;
    const orbit = scene.weaponOrbit;
    const tooltip = hud.tooltip;
    return {
      playerLevel: scene.level,
      points: scene.upgradePoints,
      weaponLevels: { ...scene.weaponLevels },
      orbit: {
        level: orbit.level,
        damage: orbit.config.damage,
        damageType: orbit.config.damageType,
        refillIntervalMs: orbit.config.refillIntervalMs,
        timerDelay: orbit.refillTimer ? orbit.refillTimer.delay : null,
        orbitDegreesPerSecond: orbit.config.orbitDegreesPerSecond,
        slotCount: orbit.config.slotCount,
        ringCount: orbit.config.ringCount,
        ringSize: orbit.config.ringSize,
        orbitRadius: orbit.config.orbitRadius,
        outerOrbitRadius: orbit.config.outerOrbitRadius,
        slotLength: orbit.slots.length,
        active: orbit.getActiveDarts().length,
      },
      layout: {
        middle: { ...hud.layout.middle },
        upgradeButton: { ...hud.layout.upgradeButton },
        slot0: { ...hud.layout.weaponSlots[0] },
        pips: hud.layout.levelPips[0] ? { ...hud.layout.levelPips[0] } : null,
      },
      buttons: hud.upgradeButtons.map((button) => ({
        index: button.index,
        active: button.active,
        visible: button.image.visible,
        enabled: !!(button.zone.input && button.zone.input.enabled),
        x: button.x,
        y: button.y,
        width: button.image.displayWidth,
        height: button.image.displayHeight,
        texture: button.image.texture.key,
        scrollFactor: [button.image.scrollFactorX, button.image.scrollFactorY],
        depth: button.image.depth,
      })),
      pips: hud.pipStates.map((state) => ({ ...state })),
      tooltip: {
        visible: tooltip.visible,
        mode: tooltip.mode,
        name: tooltip.itemName,
        runs: tooltip.runs.map((run) => ({
          text: run.text,
          color: run.color,
          bold: !!run.bold,
        })),
        flavor: tooltip.flavor,
        upgrade: tooltip.upgrade,
        bounds: tooltip.bounds,
        depth: tooltip.container.depth,
      },
    };
  });
}

async function pointOf(page, gameX, gameY) {
  return H.canvasPoint(page, gameX, gameY);
}

async function hoverButton(page, index, { expectTooltip = true } = {}) {
  const button = await page.evaluate((i) => {
    const entry = window.game.scene.getScene('world').hud.upgradeButtons[i];
    return { x: entry.x, y: entry.y };
  }, index);
  const point = await pointOf(page, button.x, button.y);
  await page.mouse.move(point.x, point.y);
  await H.frames(page, 2);
  if (expectTooltip) {
    await page.waitForFunction(
      () => window.game.scene.getScene('world').hud.tooltip.visible === true,
      null,
      { timeout: 5000, polling: 50 },
    );
  }
}

async function moveAway(page) {
  const point = await pointOf(page, H.GAME_WIDTH / 2, H.GAME_HEIGHT / 2 - 100);
  await page.mouse.move(point.x, point.y);
  await H.frames(page, 2);
}

async function clickButton(page, index) {
  const button = await page.evaluate((i) => {
    const entry = window.game.scene.getScene('world').hud.upgradeButtons[i];
    return { x: entry.x, y: entry.y };
  }, index);
  const point = await pointOf(page, button.x, button.y);
  await page.mouse.click(point.x, point.y);
  await H.frames(page, 3);
}

describe('weapon upgrade acceptance', () => {
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

  test('U1 the dart defines eight levels, an upgrade ladder and normal damage', async () => {
    const page = await openWorld(browser);
    try {
      const data = await page.evaluate(async () => {
        const config = await import('/src/config.js');
        const dart = config.WEAPONS.dart;
        return {
          damageTypes: config.DAMAGE_TYPES,
          maxWeaponLevel: config.MAX_WEAPON_LEVEL,
          damageType: dart.damageType,
          maxLevel: dart.maxLevel,
          labels: { ...dart.upgradeLabels },
          steps: dart.upgradeSteps.map((step) => ({ ...step })),
          base: {
            damage: dart.damage,
            refillIntervalMs: dart.refillIntervalMs,
            orbitDegreesPerSecond: dart.orbitDegreesPerSecond,
            slotCount: dart.slotCount,
            ringSize: dart.ringSize,
            ringCount: dart.ringCount,
          },
        };
      });

      assert.deepEqual(data.damageTypes, { normal: 'normal', explosion: 'explosion' });
      assert.equal(data.maxWeaponLevel, 8);
      assert.equal(data.maxLevel, 8);
      assert.equal(data.damageType, 'normal', 'the spinning dart deals normal damage');
      assert.deepEqual(data.labels, {
        damage: '伤害',
        refillIntervalMs: '补充间隔',
        orbitDegreesPerSecond: '旋转速度',
        slotCount: '飞镖上限',
      });
      assert.deepEqual(data.steps, [
        { damage: 4 },
        { refillIntervalMs: 800 },
        { damage: 6 },
        { orbitDegreesPerSecond: 180 },
        { damage: 8 },
        { refillIntervalMs: 600 },
        { slotCount: 16, ringCount: 2 },
      ]);
      assert.deepEqual(data.base, {
        damage: 2,
        refillIntervalMs: 1000,
        orbitDegreesPerSecond: 90,
        slotCount: 8,
        ringSize: 8,
        ringCount: 1,
      });
    } finally {
      await H.disposePage(page);
    }
  });

  test('U2 each player level grants a point and shows one button above the weapon row', async () => {
    const page = await openWorld(browser);
    try {
      const initial = await readUpgradeState(page);
      assert.equal(initial.points, 0, 'the run starts without upgrade points');
      assert.equal(initial.orbit.level, 1);
      assert.deepEqual(initial.pips[0], { level: 1, count: 8, lit: 1 }, 'level 1 lights one pip');
      assert.equal(initial.pips[1].level, 0, 'empty weapon slots show no pips');
      for (const button of initial.buttons) {
        assert.equal(button.active, false);
        assert.equal(button.visible, false);
        assert.equal(button.enabled, false);
      }

      await grantLevels(page, 1);
      const after = await readUpgradeState(page);
      assert.equal(after.playerLevel, 2, 'one level-up happened');
      assert.equal(after.points, 1, 'one upgrade point was granted');
      assert.equal(after.orbit.level, 1, 'the weapon itself is unchanged');

      const button = after.buttons[0];
      assert.equal(button.active, true);
      assert.equal(button.visible, true);
      assert.equal(button.enabled, true);
      assert.equal(button.texture, 'upgrade-button', 'the XP.png asset is the button');
      assert.deepEqual(button.scrollFactor, [0, 0]);
      assert.equal(button.depth, 1002);
      assert.equal(
        button.x,
        after.layout.slot0.x + after.layout.slot0.size / 2,
        'the button is centred over the weapon frame',
      );
      assert.ok(
        button.y + button.height / 2 <= after.layout.middle.y - 4,
        'the button sits fully above the middle frame',
      );
      assert.ok(
        button.y - button.height / 2 > 0,
        'the button stays below the top of the canvas',
      );
      assert.equal(after.buttons.slice(1).filter((entry) => entry.active).length, 0);
    } finally {
      await H.disposePage(page);
    }
  });

  test('U3 clicking spends a point, applies the stat and lights the next pip', async () => {
    const page = await openWorld(browser);
    try {
      await grantLevels(page, 1);
      await clickButton(page, 0);

      const after = await readUpgradeState(page);
      assert.equal(after.points, 0, 'the upgrade costs one point');
      assert.equal(after.weaponLevels.dart, 2);
      assert.equal(after.orbit.level, 2);
      assert.equal(after.orbit.damage, 4, 'level 2 upgrades damage 2 -> 4');
      assert.deepEqual(after.pips[0], { level: 2, count: 8, lit: 2 });
      assert.equal(after.buttons[0].active, false, 'no points left, no button');
      assert.equal(after.buttons[0].visible, false);
      assert.equal(
        await page.evaluate(() => window.game.scene.getScene('world').upgradeWeapon(0)),
        false,
        'upgrading without a point is rejected',
      );

      const slot = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        const slot0 = scene.hud.layout.weaponSlots[0];
        return { x: slot0.x + slot0.size / 2, y: slot0.y + slot0.size / 2 };
      });
      const point = await pointOf(page, slot.x, slot.y);
      await page.mouse.move(point.x, point.y);
      await page.waitForFunction(
        () => window.game.scene.getScene('world').hud.tooltip.visible === true,
        null,
        { timeout: 5000, polling: 50 },
      );
      const tip = await readUpgradeState(page);
      const damageRun = tip.tooltip.runs.find((run) => run.text === '4' && run.color === '#ff8a7a');
      assert.ok(damageRun, 'the item tooltip re-reads the upgraded damage');
    } finally {
      await H.disposePage(page);
    }
  });

  test('U4 the button hover card previews only the numeric change', async () => {
    const page = await openWorld(browser);
    try {
      await grantLevels(page, 1);
      await hoverButton(page, 0);

      let state = await readUpgradeState(page);
      assert.equal(state.tooltip.visible, true);
      assert.equal(state.tooltip.mode, 'upgrade');
      assert.equal(state.tooltip.name, '旋转飞镖');
      assert.equal(state.tooltip.flavor, '', 'the preview has no flavour text');
      assert.equal(state.tooltip.depth, 1200);
      assert.deepEqual(state.tooltip.upgrade.level, 1);
      assert.deepEqual(state.tooltip.upgrade.changes, [
        { key: 'damage', label: '伤害', from: 2, to: 4, format: null },
      ]);
      assert.equal(state.tooltip.runs.map((run) => run.text).join(''), '伤害 2 → 4');
      assert.ok(state.tooltip.bounds.width <= 300, 'the preview card is compact');
      assert.ok(state.tooltip.bounds.height < 110, 'the preview card is one line tall');

      await clickButton(page, 0);
      await moveAway(page);
      await grantLevels(page, 1);
      await hoverButton(page, 0);

      state = await readUpgradeState(page);
      assert.equal(state.tooltip.mode, 'upgrade');
      assert.equal(state.tooltip.upgrade.level, 2);
      assert.deepEqual(state.tooltip.upgrade.changes, [
        { key: 'refillIntervalMs', label: '补充间隔', from: 1000, to: 800, format: 'seconds' },
      ]);
      assert.equal(state.tooltip.runs.map((run) => run.text).join(''), '补充间隔 1秒 → 0.8秒');
    } finally {
      await H.disposePage(page);
    }
  });

  test('U5 the full ladder reaches the two-ring 16-dart layout and refills it inside-out', async () => {
    const page = await openWorld(browser);
    try {
      await grantLevels(page, 7);
      assert.equal((await readUpgradeState(page)).points, 7);

      const seen = [];
      for (let level = 2; level <= 8; level += 1) {
        const ok = await page.evaluate(() => window.game.scene.getScene('world').upgradeWeapon(0));
        assert.equal(ok, true, `upgrade to level ${level} must succeed`);
        const state = await readUpgradeState(page);
        seen.push({
          level: state.orbit.level,
          damage: state.orbit.damage,
          interval: state.orbit.refillIntervalMs,
          timer: state.orbit.timerDelay,
          speed: state.orbit.orbitDegreesPerSecond,
          slots: state.orbit.slotCount,
          rings: state.orbit.ringCount,
          lit: state.pips[0].lit,
        });
      }

      assert.deepEqual(seen, [
        { level: 2, damage: 4, interval: 1000, timer: 1000, speed: 90, slots: 8, rings: 1, lit: 2 },
        { level: 3, damage: 4, interval: 800, timer: 800, speed: 90, slots: 8, rings: 1, lit: 3 },
        { level: 4, damage: 6, interval: 800, timer: 800, speed: 90, slots: 8, rings: 1, lit: 4 },
        { level: 5, damage: 6, interval: 800, timer: 800, speed: 180, slots: 8, rings: 1, lit: 5 },
        { level: 6, damage: 8, interval: 800, timer: 800, speed: 180, slots: 8, rings: 1, lit: 6 },
        { level: 7, damage: 8, interval: 600, timer: 600, speed: 180, slots: 8, rings: 1, lit: 7 },
        { level: 8, damage: 8, interval: 600, timer: 600, speed: 180, slots: 16, rings: 2, lit: 8 },
      ]);

      let maxed = await readUpgradeState(page);
      assert.equal(maxed.points, 0);
      assert.equal(maxed.orbit.slotLength, 16, 'the slot array grew to sixteen darts');
      assert.equal(maxed.buttons[0].active, false, 'level 8 hides the upgrade button');

      await grantLevels(page, 1);
      maxed = await readUpgradeState(page);
      assert.equal(maxed.points, 1, 'the player can still gain points');
      assert.equal(maxed.buttons[0].active, false, 'max-level weapons cannot be upgraded further');
      assert.equal(
        await page.evaluate(() => window.game.scene.getScene('world').upgradeWeapon(0)),
        false,
      );

      await H.stopRefill(page);
      await H.fillDarts(page, 16);
      const rings = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        const orbit = scene.weaponOrbit;
        const center = scene.player.gameObject;
        const radii = orbit.slots
          .filter(Boolean)
          .map((dart) => Math.hypot(dart.x - center.x, dart.y - center.y));
        return {
          count: radii.length,
          inner: radii.filter((radius) => Math.abs(radius - 90) < 1.5).length,
          outer: radii.filter((radius) => Math.abs(radius - 150) < 1.5).length,
        };
      });
      assert.deepEqual(rings, { count: 16, inner: 8, outer: 8 }, 'two rings of eight darts');

      const priority = await page.evaluate(() => {
        const orbit = window.game.scene.getScene('world').weaponOrbit;
        orbit.consume(orbit.slots[3]);
        orbit.consume(orbit.slots[8]);
        orbit.refillOne();
        const firstInner = orbit.slots[3] !== null && orbit.slots[8] === null;
        orbit.refillOne();
        return { firstInner, secondOuter: orbit.slots[8] !== null };
      });
      assert.deepEqual(priority, { firstInner: true, secondOuter: true }, 'inner ring refills first');
    } finally {
      await H.disposePage(page);
    }
  });

  test('U6 dart damage reaches zombies as normal damage', async () => {
    const page = await openWorld(browser);
    try {
      await H.fillDarts(page);
      await H.stopRefill(page);
      const index = await H.spawnTestZombie(page, 400, 400, { maxHp: 10 });
      const point = await H.placeTestZombieAtDart(page, index, 0);
      assert.ok(point, 'dart slot 0 must be occupied');
      await H.frames(page, 2);

      const hit = await page.evaluate((i) => {
        const zombie = window.__testZombies[i];
        return { hp: zombie.hp, lastDamageType: zombie.lastDamageType };
      }, index);
      assert.equal(hit.hp, 8, 'the dart still deals its configured damage');
      assert.equal(hit.lastDamageType, 'normal', 'dart hits are classified as normal damage');
    } finally {
      await H.disposePage(page);
    }
  });
});
