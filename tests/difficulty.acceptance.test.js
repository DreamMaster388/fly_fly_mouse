'use strict';

/**
 * Independent acceptance suite for feat/difficulty-system.
 * Requirements are taken from docs/sdlc/feat/difficulty-system/spec.md (R1-R7),
 * narrowed by the fixed-loadout change: tiers now only carry identity (name/colour).
 *
 * Tier boundaries and rewards are checked against the exported difficulty module;
 * HUD wiring is checked against the running scene.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness.js');

const PORT = Number(process.env.ACCEPTANCE_DIFFICULTY_PORT || 5192);
const URL = `http://127.0.0.1:${PORT}/`;

const EXPECTED = [
  ['青铜', '#9C6B30'],
  ['白银', '#8C8F94'],
  ['黄金', '#B8860B'],
  ['翡翠', '#14915B'],
  ['钻石', '#2F7FD1'],
  ['大师', '#7B3FBF'],
  ['王者', '#D02B2B'],
];

async function openWorld(browser) {
  const { page } = await H.openGameWithStart(browser, URL);
  await H.clearZombies(page, { pause: true });
  return page;
}

describe('difficulty-system acceptance', () => {
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

  test('R1/R2 seven tiers switch every 60s, clamp at 王者 after 6 minutes and carry name/colour', async () => {
    const page = await openWorld(browser);
    try {
      const data = await page.evaluate(async () => {
        const mod = await import('/src/Difficulty.js');
        const difficulty = new mod.default();
        return {
          count: mod.DIFFICULTY_TIERS.length,
          tiers: mod.DIFFICULTY_TIERS.map((tier) => ({ ...tier })),
          boundaries: [
            -1,
            0,
            59999,
            60000,
            119999,
            120000,
            179999,
            180000,
            239999,
            240000,
            299999,
            300000,
            359999,
            360000,
            999999,
          ].map((ms) => difficulty.tierAt(ms).name),
        };
      });

      assert.equal(data.count, 7);
      assert.deepEqual(
        data.boundaries,
        [
          '青铜',
          '青铜',
          '青铜',
          '白银',
          '白银',
          '黄金',
          '黄金',
          '翡翠',
          '翡翠',
          '钻石',
          '钻石',
          '大师',
          '大师',
          '王者',
          '王者',
        ],
      );

      data.tiers.forEach((tier, index) => {
        const [name, color] = EXPECTED[index];
        assert.deepEqual(Object.keys(tier).sort(), ['color', 'name']);
        assert.equal(tier.name, name);
        assert.equal(tier.color, color);
      });
    } finally {
      await H.disposePage(page);
    }
  });

  test('R3 kill rewards stay fixed per enemy type regardless of the active tier', async () => {
    const page = await openWorld(browser);
    try {
      for (let index = 0; index < EXPECTED.length; index += 1) {
        await H.setTierByElapsed(page, index * 60000 + 1000);
        const result = await page.evaluate(async () => {
          const scene = window.game.scene.getScene('world');
          const { ZOMBIES } = await import('/src/config.js');
          scene.gold = 0;
          scene.xp = 0;
          scene.level = 1;
          scene.xpToNext = 280;
          scene.hud.setGold(0);
          scene.hud.setXp(1, 0, 280);
          scene.handleZombieKilled({ config: ZOMBIES.normal });
          return {
            gold: scene.gold,
            xp: scene.xp,
            hudGold: scene.hud.goldText.text,
            tier: scene.difficulty.tier.name,
          };
        });
        assert.equal(result.tier, EXPECTED[index][0]);
        assert.equal(result.gold, 21, `${EXPECTED[index][0]} kill gold`);
        assert.equal(result.xp, 60, `${EXPECTED[index][0]} kill XP`);
        assert.equal(result.hudGold, '21');
      }
    } finally {
      await H.disposePage(page);
    }
  });

  test('R4/R5 the HUD shows the tier name under the timer with the tier colour', async () => {
    const page = await openWorld(browser);
    try {
      for (let index = 0; index < EXPECTED.length; index += 1) {
        await H.setTierByElapsed(page, index * 60000 + 1000);
        const hud = await page.evaluate(() => {
          const scene = window.game.scene.getScene('world');
          const text = scene.hud.difficultyText;
          return {
            text: text.text,
            color: text.style.color.toLowerCase(),
            x: text.x,
            y: text.y,
            fontSize: text.style.fontSize,
            fixed: text.scrollFactorX === 0 && text.scrollFactorY === 0,
            timeText: scene.hud.timeText.text,
            goldText: scene.hud.goldText.text,
            hpText: scene.hud.hpText.text,
            levelText: scene.hud.levelText.text,
          };
        });
        const [name, color] = EXPECTED[index];
        assert.equal(hud.text, `难度 ${name}`);
        assert.equal(hud.color, color.toLowerCase());
        assert.equal(hud.x, 24);
        assert.equal(hud.y, 54, 'difficulty sits 34px under the timer');
        assert.equal(hud.fontSize, '20px');
        assert.equal(hud.fixed, true);
        assert.match(hud.timeText, /^\d+:\d{2}$/);
        assert.match(hud.goldText, /^\d+$/);
        assert.match(hud.hpText, /^\d+ \/ 648$/);
        assert.match(hud.levelText, /^\d+$/);
      }
    } finally {
      await H.disposePage(page);
    }
  });
});
