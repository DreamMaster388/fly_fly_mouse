'use strict';

/**
 * Acceptance suite for the Summoner's Rift inspired map replacement.
 *
 * M1 4000x4000 world, player spawns on the bottom-left plateau and the map is
 *    not empty: obstacles exist outside the bases.
 * M2 each base is a 90-degree fan sealed by an arc wall with three wide gates;
 *    interiors stay free and both bases mirror each other across the centre.
 * M3 boulders carry small round colliders, trees are decoration only, and the
 *    obstacles stay away from the legacy test coordinates and out of water.
 * M4 both lakes slow the player and the zombies by the shared percentage.
 * M5 the bottom-right minimap is fixed, sits above the HUD and projects the
 *    player's world position onto the panel.
 * M6 zombies route through a gate when their target is on the other side of a
 *    base wall.
 * M7 the boulders actually block movement, and the zombie nest is excluded
 *    from regular spawns.
 * M8 trees are walk-through decoration for the real physics body as well.
 * M9 every live zombie shows up on the minimap as a red dot that tracks its
 *    world position and disappears when the zombie is gone.
 * M10 zombies spawn in a ring just outside the camera: never on screen, and no
 *    farther than 280px from the view edge.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness.js');

const PORT = Number(process.env.ACCEPTANCE_MAP_PORT || 5197);
const URL = `http://127.0.0.1:${PORT}/`;

async function openWorld(browser, { pause = true } = {}) {
  const { page, errors } = await H.openGameWithStart(browser, URL);
  await H.clearZombies(page, { pause });
  return { page, errors };
}

async function teleportPlayer(page, x, y) {
  await page.evaluate(
    ([targetX, targetY]) => {
      const player = window.game.scene.getScene('world').player;
      const dx = player.body.center.x - player.gameObject.x;
      const dy = player.body.center.y - player.gameObject.y;
      player.body.reset(targetX - dx, targetY - dy);
      // reset() ignores the body offset; re-sync so the body centre lands on target.
      player.body.updateFromGameObject();
    },
    [x, y],
  );
  await H.frames(page, 2);
}

function readPlayerCenter(page) {
  return page.evaluate(() => {
    const body = window.game.scene.getScene('world').player.body;
    return { x: body.center.x, y: body.center.y };
  });
}

describe('map acceptance', () => {
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

  test('M1 the world is 4000x4000 and the player starts on the bottom-left plateau', async () => {
    const { page, errors } = await openWorld(browser);
    try {
      const view = await page.evaluate(async () => {
        const scene = window.game.scene.getScene('world');
        const { WORLD, SPAWN, BASES, WATER_SLOW } = await import('/src/mapLayout.js');
        const center = scene.player.body.center;
        return {
          world: { ...WORLD },
          map: { width: scene.gameMap.width, height: scene.gameMap.height },
          spawn: { ...SPAWN },
          base: JSON.parse(JSON.stringify(BASES.player)),
          waterSlow: WATER_SLOW,
          player: { x: scene.player.gameObject.x, y: scene.player.gameObject.y },
          center: { x: center.x, y: center.y },
          insideBase: scene.gameMap.isInsideBase('player', center.x, center.y),
          inWater: scene.gameMap.isInWater(center.x, center.y),
          blocked: scene.gameMap.isBlocked(center.x, center.y, 30),
          openSpawn: scene.gameMap.canSpawnAt(1300, 1000),
        };
      });

      assert.deepEqual(view.world, { width: 4000, height: 4000 });
      assert.deepEqual(view.map, { width: 4000, height: 4000 });
      assert.deepEqual(view.spawn, { x: 620, y: 3380 });
      assert.equal(view.player.x, 620);
      assert.equal(view.player.y, 3380);
      assert.equal(view.insideBase, true, 'spawn lies inside the player base');
      assert.equal(view.inWater, false, 'spawn is dry');
      assert.equal(view.blocked, false, 'spawn is clear of obstacles');
      assert.equal(view.openSpawn, true, 'the centre of the map accepts spawns');
      assert.equal(view.waterSlow, 0.55);
      assert.equal(view.base.cx, 0);
      assert.equal(view.base.cy, 4000);
      assert.equal(view.base.radius, 1150);
      assert.equal(view.base.gates.length, 3);
      assert.deepEqual(errors.console, []);
      assert.deepEqual(errors.page, []);
    } finally {
      await H.disposePage(page);
    }
  });

  test('M2 both bases have three wide gates, solid arc walls and mirrored geometry', async () => {
    const { page } = await openWorld(browser);
    try {
      const view = await page.evaluate(async () => {
        const scene = window.game.scene.getScene('world');
        const { BASES, baseGatePoint } = await import('/src/mapLayout.js');
        const map = scene.gameMap;
        const allWallBodies = map.obstacleBodies.filter((body) => body.kind === 'wall');

        const perBase = {};
        for (const base of Object.values(BASES)) {
          const gateOpenings = base.gates.map((gateDeg, index) => {
            const middle = baseGatePoint(base, index, 0);
            const inner = baseGatePoint(base, index, -70);
            const outer = baseGatePoint(base, index, 70);
            return {
              gate: gateDeg,
              midOpen: !map.isBlocked(middle.x, middle.y, 16),
              innerOpen: !map.isBlocked(inner.x, inner.y, 16),
              outerOpen: !map.isBlocked(outer.x, outer.y, 16),
              radius: Math.hypot(middle.x - base.cx, middle.y - base.cy),
            };
          });

          const interior = [];
          for (let step = 0; step < 12; step += 1) {
            const angle = (step / 12) * Math.PI * 2;
            const x = base.cx + Math.cos(angle) * (base.radius - 150);
            const y = base.cy + Math.sin(angle) * (base.radius - 150);
            interior.push(!map.isBlocked(x, y, 10));
          }

          perBase[base.id] = {
            gateOpenings,
            interior,
            wallBodies: allWallBodies
              .map((body) => Math.hypot(body.x - base.cx, body.y - base.cy))
              .filter((distance) => Math.abs(distance - base.radius) <= 1.5),
          };
        }

        return {
          gates: Object.fromEntries(
            Object.entries(BASES).map(([id, base]) => [id, base.gates.slice()]),
          ),
          baseSnapshot: Object.fromEntries(
            Object.entries(BASES).map(([id, base]) => [
              id,
              { cx: base.cx, cy: base.cy, radius: base.radius },
            ]),
          ),
          perBase,
        };
      });

      const { player, enemy } = view.perBase;
      for (const [id, data] of Object.entries(view.perBase)) {
        assert.equal(data.gateOpenings.length, 3, `${id} has three gates`);
        for (const gate of data.gateOpenings) {
          assert.equal(Math.round(gate.radius), 1150, `${id} gate ${gate.gate} sits on the wall`);
          assert.equal(gate.midOpen, true, `${id} gate ${gate.gate} is passable`);
          assert.equal(gate.innerOpen, true, `${id} gate ${gate.gate} is passable from inside`);
          assert.equal(gate.outerOpen, true, `${id} gate ${gate.gate} is passable from outside`);
        }
        assert.ok(data.interior.every(Boolean), `${id} interior is free of colliders`);
        assert.ok(data.wallBodies.length >= 30, `${id} wall is dense`);
        assert.ok(
          data.wallBodies.every((distance) => Math.abs(distance - 1150) <= 1.5),
          `${id} wall colliders follow the 1150 radius`,
        );
        assert.ok(
          Math.max(...data.wallBodies) - Math.min(...data.wallBodies) < 0.001,
          `${id} wall is a true circle`,
        );
      }

      assert.deepEqual(player.gateOpenings.map((g) => g.gate), [-70, -45, -20]);
      assert.deepEqual(enemy.gateOpenings.map((g) => g.gate), [110, 135, 160]);
      assert.equal(view.baseSnapshot.player.cx + view.baseSnapshot.enemy.cx, 4000);
      assert.equal(view.baseSnapshot.player.cy + view.baseSnapshot.enemy.cy, 4000);
      assert.equal(view.baseSnapshot.player.radius, view.baseSnapshot.enemy.radius);

      const openingWidth =
        2 * 1150 * Math.sin((5.5 * Math.PI) / 180);
      assert.ok(openingWidth > 180, 'each passage is wider than 180px');
    } finally {
      await H.disposePage(page);
    }
  });

  test('M3 only boulders collide; trees are painted decoration', async () => {
    const { page } = await openWorld(browser);
    try {
      const view = await page.evaluate(async () => {
        const scene = window.game.scene.getScene('world');
        const { BASES, OBSTACLES } = await import('/src/mapLayout.js');
        const map = scene.gameMap;
        const rockBodies = map.obstacleBodies.filter((body) => body.kind === 'rock');
        const trees = OBSTACLES.filter((obstacle) => obstacle.kind === 'tree');
        const treeSample = trees[0]
          ? {
              x: trees[0].x,
              y: trees[0].y,
              blocked: map.isBlocked(trees[0].x, trees[0].y),
            }
          : null;
        const points = [
          [400, 400],
          [450, 400],
          [500, 400],
          [1300, 1000],
        ];
        return {
          counts: map.obstacleBodies.reduce((acc, body) => {
            acc[body.kind] = (acc[body.kind] || 0) + 1;
            return acc;
          }, {}),
          treeTotal: trees.length,
          treeSample,
          colliders: map.colliders.length,
          bodyCount: map.obstacleBodies.length,
          maxObstacleRadius: Math.max(...rockBodies.map((body) => body.r)),
          outsideBases: rockBodies.every((body) =>
            Object.values(BASES).every(
              (base) => Math.hypot(body.x - base.cx, body.y - base.cy) >= base.radius + 130,
            ),
          ),
          dryObstacles: rockBodies.every((body) => !map.isInWater(body.x, body.y)),
          points: points.map(([x, y]) => ({
            x,
            y,
            blocked: map.isBlocked(x, y, 40),
            water: map.isInWater(x, y),
          })),
        };
      });

      assert.ok(view.treeTotal >= 30, 'the middle band has painted trees');
      assert.equal(view.counts.tree, undefined, 'trees have no collision bodies');
      assert.ok(view.treeSample, 'a tree sample exists');
      assert.equal(view.treeSample.blocked, false, 'the player can walk through a tree');
      assert.ok(view.counts.rock >= 10, 'the middle band has boulders');
      assert.ok(view.counts.wall >= 60, 'both base arcs are collidable');
      assert.equal(view.colliders, view.bodyCount, 'every obstacle body has a static zone');
      assert.ok(view.maxObstacleRadius <= 60, 'obstacles stay small');
      assert.equal(view.outsideBases, true, 'no obstacle intrudes into a base plateau');
      assert.equal(view.dryObstacles, true, 'no boulder sits in a lake');
      for (const point of view.points) {
        assert.equal(point.blocked, false, `legacy test point ${point.x},${point.y} stays open`);
        assert.equal(point.water, false, `legacy test point ${point.x},${point.y} stays dry`);
      }
    } finally {
      await H.disposePage(page);
    }
  });

  test('M4 both lakes slow the player and zombies to 55%', async () => {
    const { page } = await openWorld(browser);
    try {
      const zones = await page.evaluate(() => {
        const map = window.game.scene.getScene('world').gameMap;
        return {
          north: map.speedMultiplierAt(950, 840),
          south: map.speedMultiplierAt(2600, 2280),
          dry: map.speedMultiplierAt(1300, 1000),
          southWater: map.isInWater(2600, 2280),
        };
      });
      assert.equal(zones.north, 0.55);
      assert.equal(zones.south, 0.55);
      assert.equal(zones.dry, 1);
      assert.equal(zones.southWater, true);

      await teleportPlayer(page, 950, 840);
      await page.keyboard.down('ArrowRight');
      await H.frames(page, 12);
      const player = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        return {
          multiplier: scene.player.speedMultiplier,
          velocity: {
            x: scene.player.body.velocity.x,
            y: scene.player.body.velocity.y,
          },
        };
      });
      await page.keyboard.up('ArrowRight');
      assert.equal(player.multiplier, 0.55);
      assert.ok(Math.abs(Math.hypot(player.velocity.x, player.velocity.y) - 165) < 0.5);

      await teleportPlayer(page, 620, 3380);
      const zombieIndex = await H.spawnTestZombie(page, 950, 840, { speed: 100 });
      await H.frames(page, 4);
      const zombie = await page.evaluate((index) => {
        const scene = window.game.scene.getScene('world');
        const body = window.__testZombies[index].body;
        return {
          multiplier: scene.gameMap.speedMultiplierAt(body.center.x, body.center.y),
          speed: Math.hypot(body.velocity.x, body.velocity.y),
        };
      }, zombieIndex);
      assert.equal(zombie.multiplier, 0.55, 'zombie inside the lake is slowed');
      assert.ok(Math.abs(zombie.speed - 55) < 0.5, 'zombie velocity is 100 * 0.55');
    } finally {
      await H.disposePage(page);
    }
  });

  test('M5 the minimap is fixed at the bottom-right and tracks the player', async () => {
    const { page } = await openWorld(browser);
    try {
      const layout = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        const minimap = scene.minimap;
        return {
          screen: { width: scene.scale.width, height: scene.scale.height },
          x: minimap.x,
          y: minimap.y,
          innerX: minimap.innerX,
          innerY: minimap.innerY,
          marker: {
            x: minimap.marker.x,
            y: minimap.marker.y,
            depth: minimap.marker.depth,
            scrollFactorX: minimap.marker.scrollFactorX,
            scrollFactorY: minimap.marker.scrollFactorY,
          },
          glowDepth: minimap.markerGlow.depth,
          viewportDepth: minimap.viewport.depth,
          hudDepth: scene.hud.timeText.depth,
          mapDepth: scene.gameMap.background.depth,
        };
      });

      assert.equal(layout.screen.width, 1280);
      assert.equal(layout.screen.height, 720);
      assert.equal(layout.x, 1048, 'panel hugs the right edge');
      assert.equal(layout.y, 488, 'panel hugs the bottom edge');
      assert.equal(layout.innerX, layout.x + 8);
      assert.equal(layout.innerY, layout.y + 8);
      assert.equal(layout.marker.scrollFactorX, 0);
      assert.equal(layout.marker.scrollFactorY, 0);
      assert.equal(layout.viewportDepth, 1092);
      assert.equal(layout.marker.depth, 1093);
      assert.ok(layout.marker.depth > layout.hudDepth, 'minimap draws above the HUD');
      assert.ok(layout.marker.depth > layout.mapDepth, 'minimap draws above the map');

      await teleportPlayer(page, 1000, 2000);
      const first = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        return {
          marker: { x: scene.minimap.marker.x, y: scene.minimap.marker.y },
          glow: { x: scene.minimap.markerGlow.x, y: scene.minimap.markerGlow.y },
        };
      });
      assert.ok(Math.abs(first.marker.x - (layout.innerX + 50)) < 0.5);
      assert.ok(Math.abs(first.marker.y - (layout.innerY + 100)) < 0.5);
      assert.deepEqual(first.glow, first.marker, 'the glow follows the marker');

      await teleportPlayer(page, 3800, 200);
      const second = await page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        return { x: scene.minimap.marker.x, y: scene.minimap.marker.y };
      });
      assert.ok(Math.abs(second.x - (layout.innerX + 190)) < 0.5);
      assert.ok(Math.abs(second.y - (layout.innerY + 10)) < 0.5);
      assert.ok(second.x > first.marker.x && second.y < first.marker.y);
    } finally {
      await H.disposePage(page);
    }
  });

  test('M6 navigation routes walkers through gates instead of through walls', async () => {
    const { page } = await openWorld(browser);
    try {
      const view = await page.evaluate(async () => {
        const scene = window.game.scene.getScene('world');
        const { BASES } = await import('/src/mapLayout.js');
        const map = scene.gameMap;
        const gateAngle = (base, point) =>
          Math.atan2(point.y - base.cy, point.x - base.cx) / (Math.PI / 180);

        const leaving = map.navigationTarget(1000, 3500, 3000, 1000);
        const entering = map.navigationTarget(3000, 1000, 620, 3380);
        const enteringNest = map.navigationTarget(2000, 2000, 3800, 200);
        const direct = map.navigationTarget(1300, 1000, 2000, 2000);
        const minDelta = (angle, gates) =>
          Math.min(...gates.map((gate) => Math.abs(angle - gate)));

        return {
          leaving: {
            distance: Math.hypot(leaving.x - BASES.player.cx, leaving.y - BASES.player.cy),
            gateDelta: minDelta(gateAngle(BASES.player, leaving), BASES.player.gates),
          },
          entering: {
            distance: Math.hypot(entering.x - BASES.player.cx, entering.y - BASES.player.cy),
            gateDelta: minDelta(gateAngle(BASES.player, entering), BASES.player.gates),
          },
          enteringNest: {
            distance: Math.hypot(
              enteringNest.x - BASES.enemy.cx,
              enteringNest.y - BASES.enemy.cy,
            ),
            gateDelta: minDelta(gateAngle(BASES.enemy, enteringNest), BASES.enemy.gates),
          },
          direct,
        };
      });

      assert.ok(Math.abs(view.leaving.distance - 1190) < 0.5, 'leaving targets just outside');
      assert.ok(view.leaving.gateDelta < 0.01, 'leaving aims at a gate angle');
      assert.ok(Math.abs(view.entering.distance - 1110) < 0.5, 'entering targets just inside');
      assert.ok(view.entering.gateDelta < 0.01, 'entering aims at a gate angle');
      assert.ok(Math.abs(view.enteringNest.distance - 1110) < 0.5, 'nest has a gate route too');
      assert.ok(view.enteringNest.gateDelta < 0.01);
      assert.deepEqual(view.direct, { x: 2000, y: 2000 });
    } finally {
      await H.disposePage(page);
    }
  });

  test('M7 obstacles block the player and the zombie nest rejects spawns', async () => {
    const { page } = await openWorld(browser, { pause: false });
    try {
      const rock = await page.evaluate(() => {
        const map = window.game.scene.getScene('world').gameMap;
        const bodies = map.obstacleBodies;
        const target = bodies.find(
          (body) =>
            body.kind === 'rock' &&
            Math.abs(body.x - 2025) < 1 &&
            Math.abs(body.y - 2466) < 1,
        );
        return target ? { x: target.x, y: target.y, r: target.r } : null;
      });
      assert.ok(rock, 'the isolated test boulder exists');

      const radius = await page.evaluate(
        () => window.game.scene.getScene('world').player.body.halfWidth,
      );
      const startDistance = rock.r + radius + 70;
      await teleportPlayer(page, rock.x - startDistance, rock.y);
      await page.keyboard.down('ArrowRight');
      await page.waitForTimeout(700);
      await page.keyboard.up('ArrowRight');
      await H.frames(page, 2);

      const after = await readPlayerCenter(page);
      const distance = Math.hypot(after.x - rock.x, after.y - rock.y);
      assert.ok(after.x > rock.x - startDistance + 20, 'the player really moved toward the rock');
      assert.ok(
        distance >= rock.r + radius - 6,
        `player stops at the stone surface (distance ${distance.toFixed(1)})`,
      );
      assert.ok(after.x < rock.x, 'the player never passes through the boulder');

      const spawnChecks = await page.evaluate(() => {
        const map = window.game.scene.getScene('world').gameMap;
        return {
          playerNest: map.canSpawnAt(300, 3700),
          enemyNest: map.canSpawnAt(3700, 300),
          openLane: map.canSpawnAt(1300, 1000),
        };
      });
      assert.equal(spawnChecks.playerNest, false);
      assert.equal(spawnChecks.enemyNest, false);
      assert.equal(spawnChecks.openLane, true);
    } finally {
      await H.disposePage(page);
    }
  });

  test('M8 trees are walk-through decoration', async () => {
    const { page } = await openWorld(browser, { pause: false });
    try {
      const tree = await page.evaluate(async () => {
        const scene = window.game.scene.getScene('world');
        const { OBSTACLES } = await import('/src/mapLayout.js');
        const bodies = scene.gameMap.obstacleBodies;
        let best = null;
        for (const obstacle of OBSTACLES) {
          if (obstacle.kind !== 'tree') continue;
          const clearance = Math.min(
            ...bodies.map(
              (body) => Math.hypot(obstacle.x - body.x, obstacle.y - body.y) - body.r,
            ),
          );
          if (!best || clearance > best.clearance) {
            best = { x: obstacle.x, y: obstacle.y, clearance };
          }
        }
        return best;
      });
      assert.ok(tree, 'a tree exists');
      assert.ok(tree.clearance > 200, 'the chosen tree has a rock-free approach');

      await teleportPlayer(page, tree.x - 140, tree.y);
      await page.keyboard.down('ArrowRight');
      await page.waitForTimeout(900);
      await page.keyboard.up('ArrowRight');
      await H.frames(page, 2);

      const after = await readPlayerCenter(page);
      assert.ok(
        after.x > tree.x + 60,
        `the player walks through the tree (x ${after.x.toFixed(1)} vs ${tree.x})`,
      );
    } finally {
      await H.disposePage(page);
    }
  });

  test('M9 live zombies appear as red dots on the minimap', async () => {
    const { page } = await openWorld(browser);
    try {
      await teleportPlayer(page, 2000, 2000);
      const zombieIndex = await H.spawnTestZombie(page, 1000, 2000, { speed: 0 });
      await H.frames(page, 2);

      const readDots = () =>
        page.evaluate((index) => {
          const scene = window.game.scene.getScene('world');
          const minimap = scene.minimap;
          const zombie = (window.__testZombies || [])[index];
          const body = zombie && zombie.body;
          return {
            innerX: minimap.innerX,
            innerY: minimap.innerY,
            blips: minimap.zombieBlips.map((blip) => ({ ...blip })),
            expected: body
              ? {
                  x: minimap.innerX + (body.center.x / 4000) * 200,
                  y: minimap.innerY + (body.center.y / 4000) * 200,
                }
              : null,
            depth: minimap.zombieDots.depth,
            markerDepth: minimap.marker.depth,
            mapDepth: minimap.mapImage.depth,
            scrollFactor: [
              minimap.zombieDots.scrollFactorX,
              minimap.zombieDots.scrollFactorY,
            ],
            fadesWithPanel: minimap.fadeObjects.includes(minimap.zombieDots),
          };
        }, zombieIndex);

      const first = await readDots();
      assert.equal(first.blips.length, 1, 'one live zombie means one dot');
      assert.ok(Math.abs(first.blips[0].x - first.expected.x) < 0.5);
      assert.ok(Math.abs(first.blips[0].y - first.expected.y) < 0.5);
      assert.deepEqual(first.scrollFactor, [0, 0], 'the dot layer is screen-fixed');
      assert.ok(first.depth > first.mapDepth, 'dots draw above the map image');
      assert.ok(first.depth < first.markerDepth, 'the player marker stays on top');
      assert.equal(first.fadesWithPanel, true, 'dots fade together with the minimap');

      await H.moveTestZombieBody(page, zombieIndex, 3000, 500);
      await H.frames(page, 2);
      const moved = await readDots();
      assert.equal(moved.blips.length, 1);
      assert.ok(Math.abs(moved.blips[0].x - moved.expected.x) < 0.5);
      assert.ok(Math.abs(moved.blips[0].y - moved.expected.y) < 0.5);
      assert.ok(first.blips[0].x < moved.blips[0].x, 'the dot follows the zombie');
      assert.ok(first.blips[0].y > moved.blips[0].y);

      await H.clearZombies(page, { pause: true });
      const cleared = await readDots();
      assert.deepEqual(cleared.blips, [], 'the dot disappears with the zombie');
    } finally {
      await H.disposePage(page);
    }
  });

  test('M10 zombies spawn just outside the camera view, never far away', async () => {
    const { page } = await openWorld(browser);
    try {
      const config = await page.evaluate(() => {
        const manager = window.game.scene.getScene('world').zombieManager;
        return {
          margin: manager.config.cameraMargin,
          maxMargin: manager.config.spawnMaxMargin,
        };
      });
      assert.equal(config.margin, 80);
      assert.equal(config.maxMargin, 280);

      const spawnWave = (count) =>
        page.evaluate((n) => {
          const scene = window.game.scene.getScene('world');
          const manager = scene.zombieManager;
          const cam = scene.cameras.main;
          const bounds = scene.physics.world.bounds;
          const spawned = [];
          for (let i = 0; i < n; i += 1) {
            const zombie = manager.spawn();
            if (zombie) spawned.push({ x: zombie.gameObject.x, y: zombie.gameObject.y });
          }
          return {
            spawned,
            view: { x: cam.scrollX, y: cam.scrollY, width: cam.width, height: cam.height },
            bounds: {
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              height: bounds.height,
            },
          };
        }, count);

      const gapToView = (point, view) => {
        const dx = Math.max(view.x - point.x, 0, point.x - (view.x + view.width));
        const dy = Math.max(view.y - point.y, 0, point.y - (view.y + view.height));
        return Math.hypot(dx, dy);
      };

      const checkWave = (label, wave) => {
        assert.ok(wave.spawned.length >= 8, `${label}: expected 8 spawns, got ${wave.spawned.length}`);
        for (const [index, point] of wave.spawned.entries()) {
          const gap = gapToView(point, wave.view);
          const b = wave.bounds;
          assert.ok(
            point.x >= b.x && point.x <= b.x + b.width && point.y >= b.y && point.y <= b.y + b.height,
            `${label} #${index}: inside the map bounds, got (${point.x}, ${point.y})`,
          );
          assert.ok(
            gap >= 79.5,
            `${label} #${index}: at least 80px off screen, got ${gap.toFixed(1)}px`,
          );
          assert.ok(
            gap <= 280.5,
            `${label} #${index}: at most 280px off screen, got ${gap.toFixed(1)}px`,
          );
        }
      };

      checkWave('bottom-left spawn', await spawnWave(8));

      await teleportPlayer(page, 2000, 2000);
      await page.waitForTimeout(300);
      await H.clearZombies(page, { pause: true });
      checkWave('centre', await spawnWave(8));
    } finally {
      await H.disposePage(page);
    }
  });
});
