'use strict';

/**
 * Independent acceptance suite for feat/base-game-framework.
 * Requirements are taken from docs/sdlc/feat/base-game-framework/spec.md (R1-R11).
 *
 * The game is driven through a real browser against a Vite dev server; runtime
 * state is read through the dev-only `window.game` handle. Every scenario gets a
 * fresh page so that scene restarts and audio state cannot leak between tests.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness.js');

const PORT = Number(process.env.ACCEPTANCE_BASE_PORT || 5190);
const URL = `http://127.0.0.1:${PORT}/`;

describe('base-game-framework acceptance', () => {
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

  test('R1 the start scene is the default entry with one 开始游戏 button on a white canvas', async () => {
    const page = await H.openStartScreen(browser, URL);
    try {
      const view = await page.evaluate(() => {
        const game = window.game;
        const start = game.scene.getScene('start');
        return {
          order: game.scene.scenes.map((scene) => scene.sys.settings.key),
          active: game.scene.scenes
            .filter((scene) => scene.sys.isActive())
            .map((scene) => scene.sys.settings.key),
          background: start.cameras.main.backgroundColor.color,
          objects: start.children.list.map((obj) => ({
            type: obj.type,
            text: obj.text,
            interactive: !!(obj.input && obj.input.enabled),
          })),
        };
      });

      assert.deepEqual(view.order, ['start', 'world', 'shop']);
      assert.deepEqual(view.active, ['start'], 'the shop stays stopped until the gold button opens it');
      assert.equal(view.background, 0xffffff);
      assert.equal(view.objects.length, 1, 'start scene must only contain the start button');
      assert.equal(view.objects[0].type, 'Text');
      assert.equal(view.objects[0].text, '开始游戏');
      assert.equal(view.objects[0].interactive, true);

      const centre = await H.canvasPoint(page, H.GAME_WIDTH / 2, H.GAME_HEIGHT / 2);
      await page.mouse.click(centre.x, centre.y);
      await H.waitForWorld(page);
      const entered = await page.evaluate(
        () => window.game.scene.getScene('world').sys.isActive(),
      );
      assert.equal(entered, true, 'clicking the button must enter the world scene');
    } finally {
      await H.disposePage(page);
    }
  });

  test('R2 chomp.mp3 and 2.75.mp3 are served from resource/audio and decoded by the game', async () => {
    const { page, errors } = await H.openGameWithStart(browser, URL, { collectNetwork: true });
    try {
      const mp3 = errors.responses.filter((res) => /\.mp3(\?|$)/.test(res.url));
      const target = (name) => mp3.find((res) => res.url.includes(name));
      const chomp = target('chomp');
      const bgm = target('2.75');
      assert.ok(chomp, 'chomp.mp3 must be requested');
      assert.ok(bgm, '2.75.mp3 must be requested');
      assert.equal(chomp.status, 200);
      assert.equal(bgm.status, 200);
      assert.ok(
        mp3.some((res) => /audio|mpeg/i.test(res.contentType)),
        'at least one mp3 response must be served as audio',
      );
      assert.ok(chomp.url.includes('/resource/audio/'), 'chomp.mp3 must come from resource/audio');
      assert.ok(bgm.url.includes('/resource/audio/'), '2.75.mp3 must come from resource/audio');

      const decoded = await page.evaluate(() => {
        const start = window.game.scene.getScene('start');
        return {
          chomp: start.cache.audio.exists('chomp'),
          bgm: start.cache.audio.exists('bgm'),
        };
      });
      assert.deepEqual(decoded, { chomp: true, bgm: true });
    } finally {
      await H.disposePage(page);
    }
  });

  test('R3 BGM loops as a single playing instance after the start click', async () => {
    const { page } = await H.openGameWithStart(browser, URL);
    try {
      const state = await H.readGameState(page);
      assert.equal(state.bgm.count, 1, 'exactly one bgm instance must exist');
      assert.equal(state.bgm.loop, true);
      assert.equal(state.bgm.playing, true);
      assert.ok(Math.abs(state.bgm.volume - 0.4) < 0.01);
    } finally {
      await H.disposePage(page);
    }
  });

  test('R4/R5 the HUD starts at 648 HP, level 1, 0 gold, 0:00 and stays fixed with mm:ss time', async () => {
    const { page } = await H.openGameWithStart(browser, URL);
    try {
      const state = await H.readGameState(page);
      assert.equal(state.hp, 648);
      assert.equal(state.maxHp, 648);
      assert.equal(state.gold, 0);
      assert.equal(state.level, 1);
      assert.equal(state.xp, 0);
      assert.equal(state.xpToNext, 280);
      assert.ok(state.elapsedMs < 2000, 'timer starts at zero when the world starts');
      assert.equal(state.hud.time, '0:00');
      assert.equal(state.hud.gold, '0');
      assert.equal(state.hud.level, '1');
      assert.equal(state.hud.hp, '648 / 648');
      assert.equal(state.hud.xpRatio, 0);
      assert.deepEqual(state.hud.scrollFactor, [0, 0, 0], 'HUD must not scroll with the camera');
      assert.equal(state.hud.depth, 1000);

      const layout = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        const { width } = scene.scale;
        const hud = scene.hud;
        return {
          width,
          timeX: hud.timeText.x,
          timeY: hud.timeText.y,
          hpX: hud.hpText.x,
          hpOrigin: hud.hpText.originX,
          hpBar: { ...hud.layout.hpBar },
          goldX: hud.goldText.x,
          goldY: hud.goldText.y,
          goldButton: { ...hud.layout.goldButton },
          avatarRadius: hud.layout.avatar.radius,
        };
      });
      assert.equal(layout.timeX, 24);
      assert.equal(layout.timeY, 20);
      assert.equal(layout.hpX, layout.hpBar.x + layout.hpBar.width / 2);
      assert.equal(layout.hpOrigin, 0.5);
      assert.ok(
        layout.goldX > layout.goldButton.x &&
          layout.goldX < layout.goldButton.x + layout.goldButton.width,
        'the gold counter sits inside the gold button',
      );
      assert.equal(
        layout.goldY,
        layout.goldButton.y + layout.goldButton.height / 2,
        'the gold counter is vertically centred in its button',
      );

      const formatted = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        return [0, 7000, 155000, 3599000].map((ms) => scene.formatTime(ms));
      });
      assert.deepEqual(formatted, ['0:00', '0:07', '2:35', '59:59']);

      await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        scene.elapsedMs = 155000;
        scene.hud.setTime(scene.formatTime(155000));
      });
      assert.equal((await H.readGameState(page)).hud.time, '2:35');
    } finally {
      await H.disposePage(page);
    }
  });

  test('R6 a touching zombie keeps attacking for its contact damage and stays alive', async () => {
    const { page } = await H.openGameWithStart(browser, URL);
    try {
      await H.spyOnSounds(page);
      const before = await H.readGameState(page);
      assert.equal(before.hp, 648);
      assert.ok(before.aliveZombies >= 1);

      const placed = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        const zombie = scene.zombieManager.getLiveZombies()[0];
        const body = scene.player.body;
        window.__contactZombie = zombie;
        zombie.body.reset(body.center.x, body.center.y);
        return { x: zombie.gameObject.x, y: zombie.gameObject.y };
      });
      assert.ok(Number.isFinite(placed.x));

      await page.waitForFunction(
        () => window.game.scene.getScene('world').hp <= 638,
        null,
        { timeout: 5000, polling: 30 },
      );
      const first = await H.readGameState(page);
      assert.equal(first.hp, 638, 'the first attack tick deals the configured 10 damage');
      assert.equal(first.hud.hp, '638 / 648');

      await page.waitForFunction(
        () => window.game.scene.getScene('world').hp <= 628,
        null,
        { timeout: 5000, polling: 30 },
      );
      const second = await H.readGameState(page);
      assert.ok(second.hp <= 628, `the second tick lands later (${second.hp})`);
      assert.equal((638 - second.hp) % 10, 0, 'every tick deals the same 10 damage');

      const contact = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        const zombie = window.__contactZombie;
        return {
          active: zombie.gameObject.active,
          dead: zombie.dead,
          attacking: zombie.attacking,
          anim: zombie.art.animationName,
          tracked: scene.zombieManager.zombies.has(zombie),
        };
      });
      assert.deepEqual(contact, {
        active: true,
        dead: false,
        attacking: true,
        anim: 'eat',
        tracked: true,
      }, 'contact must not destroy the zombie; it switches to the attack animation');

      const sounds = await H.readSoundLog(page);
      assert.ok(
        sounds.filter((entry) => entry.key === 'chomp').length >= 2,
        'each contact tick plays chomp',
      );
      assert.equal(
        sounds.filter((entry) => entry.key === 'zombie-hit' || entry.key === 'zombie-die').length,
        0,
        'attacking the player must not damage the zombie',
      );
    } finally {
      await H.disposePage(page);
    }
  });

  test('R7 dart kills add fixed gold and XP while contact damage adds neither', async () => {
    const { page } = await H.openGameWithStart(browser, URL);
    try {
      const initial = await H.readGameState(page);
      assert.equal(initial.gold, 0);
      assert.equal(initial.xp, 0);

      const reward = await page.evaluate(async () => {
        const scene = window.game.scene.getScene('world');
        const { ZOMBIES } = await import('/src/config.js');
        const zombie = scene.zombieManager.getLiveZombies()[0];
        if (!zombie) return null;
        zombie.takeDamage(zombie.hp);
        return { ...ZOMBIES.normal.reward };
      });
      assert.deepEqual(reward, { gold: 21, xp: 60 });
      await page.waitForFunction(
        () => {
          const scene = window.game.scene.getScene('world');
          return scene.gold === 21 && scene.xp === 60;
        },
        null,
        { timeout: 3000, polling: 50 },
      );
      const afterKill = await H.readGameState(page);
      assert.equal(afterKill.hud.gold, '21');
      assert.equal(afterKill.level, 1);
      assert.ok(Math.abs(afterKill.hud.xpRatio - 60 / 280) < 1e-9);

      const contact = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        scene.zombieManager.spawn();
        const zombie = scene.zombieManager.getLiveZombies().slice(-1)[0];
        if (!zombie) return false;
        zombie.body.reset(scene.player.body.center.x, scene.player.body.center.y);
        return true;
      });
      assert.equal(contact, true);
      await page.waitForFunction(
        () => window.game.scene.getScene('world').hp < 648,
        null,
        { timeout: 5000, polling: 30 },
      );
      await page.waitForTimeout(300);
      const afterContact = await H.readGameState(page);
      assert.equal(afterContact.gold, 21, 'contact damage must not award gold');
      assert.equal(afterContact.xp, 60, 'contact damage must not award XP');
      assert.equal(afterContact.hud.gold, '21');
      const stillAlive = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        return scene.zombieManager.getLiveZombies().length >= 1;
      });
      assert.equal(stillAlive, true, 'the attacking zombie stays in the world');
    } finally {
      await H.disposePage(page);
    }
  });

  test('R8/R9 game over freezes the run and shows the result overlay', async () => {
    const { page } = await H.openGameWithStart(browser, URL);
    try {
      await H.spyOnSounds(page);
      await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        scene.gold = 7;
        scene.hud.setGold(7);
        scene.hp = 1;
        scene.hud.setHp(1, scene.maxHp);
        const zombie = scene.zombieManager.getLiveZombies()[0];
        zombie.body.reset(scene.player.body.center.x, scene.player.body.center.y);
      });

      await page.waitForFunction(
        () => window.game.scene.getScene('world').gameOver === true,
        null,
        { timeout: 5000, polling: 50 },
      );
      await H.frames(page, 3);
      const frozen = await H.readGameState(page);
      await page.waitForTimeout(600);
      const later = await H.readGameState(page);

      assert.equal(frozen.gameOver, true);
      assert.equal(frozen.paused, true, 'physics must pause after game over');
      assert.equal(frozen.spawnTimerActive, false, 'zombie spawning must stop');
      assert.equal(later.elapsedMs, frozen.elapsedMs, 'timer must freeze after game over');
      assert.equal(later.hud.time, frozen.hud.time);

      assert.ok(frozen.overlay.includes('本局结束'));
      assert.ok(frozen.overlay.includes('金钱 7'));
      assert.ok(frozen.overlay.some((text) => text.startsWith('存活时间 ')));
      assert.ok(frozen.overlay.includes('再来一局'));
      assert.equal(frozen.overlayAllFixed, true, 'overlay elements must ignore camera scroll');

      const sounds = await H.readSoundLog(page);
      assert.ok(sounds.some((entry) => entry.key === 'chomp'), 'lethal contact still plays chomp');
    } finally {
      await H.disposePage(page);
    }
  });

  test('R10 再来一局 restarts directly, resets state and keeps the same BGM playing', async () => {
    const { page } = await H.openGameWithStart(browser, URL);
    try {
      const before = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        window.__bgmBefore = scene.sound.get('bgm');
        scene.gold = 5;
        scene.hud.setGold(5);
        scene.level = 3;
        scene.xp = 120;
        scene.xpToNext = 460;
        scene.hud.setXp(3, 120, 460);
        scene.hp = 1;
        scene.hud.setHp(1, scene.maxHp);
        scene.handlePlayerHit(scene.maxHp);
        return {
          gameOver: scene.gameOver,
          bgmId: window.__bgmBefore ? window.__bgmBefore.id : null,
        };
      });
      assert.equal(before.gameOver, true);
      await H.frames(page, 2);

      const button = await H.canvasPoint(page, H.GAME_WIDTH / 2, H.GAME_HEIGHT / 2 + 90);
      await page.mouse.click(button.x, button.y);
      await H.waitForWorld(page);

      const after = await H.readGameState(page);
      assert.equal(after.gameOver, false);
      assert.equal(after.paused, false);
      assert.equal(after.hp, 648);
      assert.equal(after.gold, 0);
      assert.equal(after.level, 1);
      assert.equal(after.xp, 0);
      assert.ok(after.elapsedMs < 2000, 'timer restarts from zero');
      assert.equal(after.hud.hp, '648 / 648');
      assert.equal(after.hud.gold, '0');
      assert.equal(after.hud.level, '1');
      assert.equal(after.hud.xpRatio, 0);
      assert.equal(after.hud.time, '0:00');
      assert.ok(!after.overlay.includes('本局结束'), 'result overlay must be gone');
      assert.equal(after.bgm.count, 1, 'restart must not create a second BGM instance');
      assert.equal(after.bgm.playing, true);
      const sameInstance = await page.evaluate(
        () => window.game.scene.getScene('world').sound.get('bgm') === window.__bgmBefore,
      );
      assert.equal(sameInstance, true, 'restart must reuse the same BGM instance');
    } finally {
      await H.disposePage(page);
    }
  });
});
