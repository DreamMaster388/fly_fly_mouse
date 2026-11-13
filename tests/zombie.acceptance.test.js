'use strict';

/**
 * Independent acceptance suite for feat/add-zombie.
 *
 * Every expectation below is derived from docs/sdlc/feat/add-zombie/spec.md (R1-R10).
 * The spec's "证明方式" hints are only a starting point; boundary conditions are added
 * here: 5 (not 4/6) alive, spawn times on the 2000ms grid, spawn points just inside the
 * map and 80-280px outside the camera rect, vx ~ 0 mirroring (both starting facings),
 * destruction on body overlap (and survival just outside it), 22 frames with alternating
 * 90/180ms delays summing to 2.97s, loop wrap, undistorted 110px display height, render
 * order, circular body inside the display footprint, and no zombie-zombie collider.
 *
 * Black box only: a real Edge instance (playwright-core) drives the app served by a
 * programmatically started Vite dev server. Runtime state is read through the dev-only
 * `window.game` handle, the display list and the page's network responses. Zombies are
 * discovered without knowing the implementation: sprites whose texture frame is exactly
 * 166x144 (the spec's frame size), excluding the player and the `dart` texture.
 *
 * Test-only techniques used to make timing deterministic: pausing Arcade physics for
 * spawn-cadence observations (positions freeze, the time driven spawner keeps running)
 * and repositioning bodies through `body.reset(...)`. Assertions themselves stay tied to
 * the spec's numbers.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const DEV_PORT = Number(process.env.ZOMBIE_DEV_PORT || 5198);
const DEV_URL = `http://127.0.0.1:${DEV_PORT}/`;

const SHEET_PATH = path.join(PROJECT_ROOT, 'resource', 'enemy', 'zombie-walk-spritesheet.png');

/* ---- values straight from the spec ---- */
const FRAME_W = 166; // R1
const FRAME_H = 144; // R1
const FRAME_COUNT = 22; // R1/R2
const SHEET_W = FRAME_W * FRAME_COUNT; // 3652 (R1 "横向 spritesheet")
const SHEET_H = FRAME_H;
const FRAME_DELAYS = [90, 180]; // R2
const CYCLE_MS = (FRAME_COUNT / 2) * (90 + 180); // 2970 (R2 "整轮约 2.97 秒")
const MAX_ALIVE = 5; // R3
const SPAWN_INTERVAL = 2000; // R3
const CAMERA_MARGIN = 80; // R4
const SPAWN_MAX_MARGIN = 280; // R4: spawns must stay close to the screen edge
const SPEED = 150; // R5/R6 (300 / 2)
const PLAYER_SPEED = 300; // R5 ("主角 300 的一半")
const DISPLAY_HEIGHT = 110; // R8
const DISPLAY_WIDTH = (DISPLAY_HEIGHT * FRAME_W) / FRAME_H; // 126.805... (R8 "宽约 127px")

/* ---- tolerances: sampling / physics-step slack, not spec values ---- */
const CANVAS = { width: 1280, height: 720 };

let viteServer = null;
let browser = null;

/* ------------------------------------------------------------------ *
 * Infrastructure
 * ------------------------------------------------------------------ */

before(async () => {
  const { createServer } = await import('vite');
  viteServer = await createServer({
    root: PROJECT_ROOT,
    logLevel: 'error',
    server: { port: DEV_PORT, host: '127.0.0.1', strictPort: true },
  });
  await viteServer.listen();

  const { chromium } = require('playwright-core');
  browser = await chromium.launch({ executablePath: EDGE_PATH, headless: true });
});

after(async () => {
  if (browser) await browser.close().catch(() => {});
  if (viteServer) await viteServer.close().catch(() => {});
});

function frames(page, count = 2) {
  return page.evaluate(
    (n) =>
      new Promise((resolve) => {
        let i = 0;
        const step = () => {
          i += 1;
          if (i >= n) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    count,
  );
}

const BOOT_PREDICATE = () => {
  const g = window.game;
  if (!g || !g.scene) return false;
  const scene = g.scene.getScene('world');
  if (!scene || !scene.children || !scene.cameras || !scene.cameras.main) return false;
  const p = scene.player;
  return !!(p && p.gameObject);
};

async function openGame(t, { initScript = null, viewport = CANVAS } = {}) {
  const page = await browser.newPage({ viewport });
  const errors = { console: [], page: [], failed: [], responses: [] };
  if (initScript) await page.addInitScript(initScript);

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const location = typeof msg.location === 'function' ? msg.location() : {};
    errors.console.push({ text: msg.text(), url: (location && location.url) || '' });
  });
  page.on('pageerror', (err) => errors.page.push(String((err && err.stack) || err)));
  page.on('requestfailed', (req) => {
    const failure = req.failure();
    errors.failed.push(`${req.url()} :: ${(failure && failure.errorText) || 'failed'}`);
  });
  page.on('response', (res) => {
    let headers = {};
    try {
      headers = res.headers();
    } catch {
      headers = {};
    }
    errors.responses.push({
      url: res.url(),
      status: res.status(),
      contentType: headers['content-type'] || '',
      contentLength: headers['content-length'] || null,
    });
  });

  await page.goto(DEV_URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 30000 });
  await page.waitForFunction(BOOT_PREDICATE, null, { timeout: 60000, polling: 50 });
  await frames(page, 2);
  return { page, errors };
}

async function withGame(t, opts, fn) {
  const { page, errors } = await openGame(t, opts);
  try {
    return await fn(page, errors);
  } finally {
    await page.close().catch(() => {});
  }
}

async function focusCanvas(page) {
  const box = await page.evaluate(() => {
    const r = document.querySelector('canvas').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2);
  await frames(page, 2);
}

/** Pauses/resumes the Arcade world (spawns are time driven, so they keep coming). */
async function setPhysics(page, paused) {
  await page.evaluate((p) => {
    const scene = window.game.scene.getScene('world');
    if (p) scene.physics.pause();
    else scene.physics.resume();
  }, paused);
  await frames(page, 2);
}

/* ------------------------------------------------------------------ *
 * Shared page-side helpers (injected as source so they can be reused)
 * ------------------------------------------------------------------ */

const ZLIB = `
function zlist(scene) {
  const pg = scene.player && scene.player.gameObject ? scene.player.gameObject : null;
  return scene.children.list.filter(function (o) {
    if (!o || !o.frame || !o.texture) return false;
    if (o === pg) return false;
    if (o.texture.key === 'dart') return false;
    if (o.frame.realWidth !== ${FRAME_W} || o.frame.realHeight !== ${FRAME_H}) return false;
    return o.active !== false;
  });
}
function findManager(scene) {
  const zs = zlist(scene);
  if (scene.zombieManager && typeof scene.zombieManager === 'object') {
    return { name: 'zombieManager', via: 'direct', obj: scene.zombieManager };
  }
  const keys = Object.keys(scene);
  for (let i = 0; i < keys.length; i += 1) {
    const k = keys[i];
    let v;
    try { v = scene[k]; } catch (e) { continue; }
    if (!v || typeof v !== 'object') continue;
    const props = Object.keys(v);
    for (let j = 0; j < props.length; j += 1) {
      const p = props[j];
      let c;
      try { c = v[p]; } catch (e) { continue; }
      if (!c || typeof c !== 'object' || typeof c.getChildren !== 'function') continue;
      let kids = [];
      try { kids = c.getChildren() || []; } catch (e) { kids = []; }
      if (zs.some(function (z) { return kids.indexOf(z) !== -1; })) {
        return { name: k, via: p, obj: v, kids: kids.length };
      }
    }
  }
  return null;
}
function zinfo(scene, z) {
  const b = z.body || null;
  const f = z.frame || null;
  const ca = z.anims && z.anims.currentAnim ? z.anims.currentAnim : null;
  const cf = z.anims && z.anims.currentFrame ? z.anims.currentFrame : null;
  return {
    x: z.x, y: z.y,
    depth: z.depth,
    listIndex: scene.children.list.indexOf(z),
    displayWidth: z.displayWidth,
    displayHeight: z.displayHeight,
    scaleX: z.scaleX,
    scaleY: z.scaleY,
    flipX: !!z.flipX,
    flipY: !!z.flipY,
    originX: z.originX,
    originY: z.originY,
    textureKey: z.texture ? z.texture.key : null,
    frameName: f ? String(f.name) : null,
    frameW: f ? f.realWidth : null,
    frameH: f ? f.realHeight : null,
    animKey: ca ? ca.key : null,
    animPlaying: !!(z.anims && z.anims.isPlaying),
    body: b ? {
      wx: b.x, wy: b.y,
      cx: b.center.x, cy: b.center.y,
      width: b.width, height: b.height,
      halfWidth: b.halfWidth, halfHeight: b.halfHeight,
      radius: b.radius,
      isCircle: !!b.isCircle,
      enable: b.enable !== false,
      vx: b.velocity.x, vy: b.velocity.y,
      allowGravity: !!b.allowGravity,
      inSceneWorld: !!(b.world && z.scene.physics && b.world === z.scene.physics.world),
    } : null,
  };
}
function pinfo(scene) {
  const p = scene.player.gameObject;
  const b = p.body || null;
  return {
    x: p.x, y: p.y,
    depth: p.depth,
    listIndex: scene.children.list.indexOf(p),
    flipX: !!p.flipX,
    displayWidth: p.displayWidth,
    displayHeight: p.displayHeight,
    body: b ? {
      cx: b.center.x, cy: b.center.y,
      halfWidth: b.halfWidth, halfHeight: b.halfHeight,
      isCircle: !!b.isCircle,
      vx: b.velocity.x, vy: b.velocity.y,
    } : null,
  };
}
`;

function evalPage(page, body) {
  return page.evaluate(`(() => { ${ZLIB}; ${body} })()`);
}

const snapshot = (page) => evalPage(page, `const scene = window.game.scene.getScene('world');
  return { t: performance.now(), sceneTime: scene.time ? scene.time.now : null, player: pinfo(scene), zombies: zlist(scene).map(function (z) { return zinfo(scene, z); }) };`);

async function waitForZombies(page, count = 1, timeout = 8000) {
  const started = Date.now();
  let last = 0;
  while (Date.now() - started < timeout) {
    last = await evalPage(page, `return zlist(window.game.scene.getScene('world')).length;`);
    if (last >= count) return last;
    await page.waitForTimeout(100);
  }
  return last;
}

/**
 * Repositions a zombie so that its *sprite centre* sits at (sx, sy). Setting the sprite
 * position is enough: the Arcade body is re-derived from the game object on the next
 * physics step.
 */
async function placeZombie(page, index, sx, sy) {
  await evalPage(page, `
    const scene = window.game.scene.getScene('world');
    const z = zlist(scene)[${index}];
    if (!z) return null;
    z.setPosition(${sx}, ${sy});
    return { x: z.x, y: z.y };`);
  await frames(page, 3);
  return evalPage(page, `
    const scene = window.game.scene.getScene('world');
    const z = zlist(scene)[${index}];
    return z ? zinfo(scene, z) : null;`);
}

async function resetPlayer(page, x, y) {
  await page.evaluate(
    ([px, py]) => {
      const scene = window.game.scene.getScene('world');
      scene.player.body.reset(px, py);
    },
    [x, y],
  );
  await frames(page, 4);
}

/* ------------------------------------------------------------------ *
 * Geometry helpers
 * ------------------------------------------------------------------ */

const DEG = 180 / Math.PI;

function pointRectDistance(px, py, rect) {
  const dx = Math.max(rect.x - px, 0, px - (rect.x + rect.width));
  const dy = Math.max(rect.y - py, 0, py - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

function rectsOverlap(a, b) {
  return !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
}

/** Unit vector from origin (zombie) to target (player display centre) times 150. */
function expectedVelocity(originX, originY, target, speed = SPEED) {
  const dx = target.x - originX;
  const dy = target.y - originY;
  const len = Math.hypot(dx, dy) || 1;
  return { vx: (dx / len) * speed, vy: (dy / len) * speed, len };
}

const norm = (v) => Math.hypot(v.vx, v.vy);

/** Smallest angular error (deg) between an actual velocity and a set of candidates. */
function bestDirectionMatch(actual, candidates) {
  let best = { err: Infinity, index: -1 };
  candidates.forEach((c, index) => {
    const a = Math.atan2(actual.vy, actual.vx);
    const b = Math.atan2(c.vy, c.vx);
    let d = Math.abs((a - b) * DEG);
    while (d > 180) d = Math.abs(d - 360);
    if (d < best.err) best = { err: d, index };
  });
  return best;
}

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
const within = (actual, expected, tolerance) => Math.abs(actual - expected) <= tolerance;

/** Nearest multiple of `step`, used to place spawn times on the 2000ms grid. */
const gridDistance = (t, step) => Math.abs(t - Math.round(t / step) * step);

/* ------------------------------------------------------------------ *
 * R1 - spritesheet asset: 22 frames x 166x144, Vite URL import, no GIF
 * ------------------------------------------------------------------ */

test('R1 zombie spritesheet: resource/enemy/zombie-walk-spritesheet.png served by Vite, 22 frames of 166x144, no GIF at runtime', { timeout: 90000 }, async (t) => {
  const sheet = fs.readFileSync(SHEET_PATH);
  const fileW = sheet.readUInt32BE(16);
  const fileH = sheet.readUInt32BE(20);
  t.diagnostic(`spritesheet file ${fileW}x${fileH}, ${sheet.length} bytes, sha1 ${sha1(sheet)}`);
  assert.equal(fileW, SHEET_W, `the spritesheet must be ${FRAME_COUNT} frames of ${FRAME_W}px side by side (${SHEET_W}px wide)`);
  assert.equal(fileH, SHEET_H, `the spritesheet height must be one frame (${SHEET_H}px)`);

  // "不新增依赖": no GIF decoder may have been added for this feature.
  const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
  const deps = Object.keys(pkg.dependencies || {}).sort();
  const devDeps = Object.keys(pkg.devDependencies || {}).sort();
  t.diagnostic(`dependencies: ${deps.join(', ')} | devDependencies: ${devDeps.join(', ')}`);
  assert.deepEqual(deps, ['phaser', 'sharp'], 'the feature must not add runtime dependencies (pre-split with the existing sharp)');
  assert.deepEqual(devDeps, ['playwright-core', 'vite'], 'the feature must not add development dependencies');
  const gifish = [...deps, ...devDeps].filter((d) => /gif/i.test(d));
  assert.deepEqual(gifish, [], 'no GIF decoding dependency may be introduced');

  await withGame(t, {}, async (page, errors) => {
    const info = await evalPage(page, `
      const scene = window.game.scene.getScene('world');
      const zs = zlist(scene);
      const z = zs[0] || null;
      const tex = z ? z.texture : null;
      const frames = tex ? Object.keys(tex.frames).filter(function (k) { return k !== '__BASE'; }).map(function (k) {
        const f = tex.frames[k];
        return { name: k, w: f.realWidth, h: f.realHeight, cw: f.cutWidth, ch: f.cutHeight, x: f.cutX, y: f.cutY };
      }) : [];
      const src = tex && tex.source ? tex.source.map(function (s) { return { w: s.width, h: s.height }; }) : [];
      return {
        zombieCount: zs.length,
        textureKeys: Array.from(new Set(zs.map(function (q) { return q.texture ? q.texture.key : null; }))),
        sceneTextureKeys: Object.keys(scene.textures.list),
        frames: frames,
        sources: src,
        frameTotal: tex && typeof tex.frameTotal === 'number' ? tex.frameTotal : null,
      };`);
    t.diagnostic(`zombies on screen: ${info.zombieCount}, texture keys in use: ${info.textureKeys.join(', ')}`);
    t.diagnostic(`scene textures: ${info.sceneTextureKeys.join(', ')}`);
    assert.ok(info.zombieCount >= 1, 'the scene must spawn at least one zombie immediately (R3) so R1 can inspect its texture');
    assert.equal(info.textureKeys.length, 1, 'all zombies must share a single texture');
    assert.ok(info.sources.length >= 1, 'the zombie texture must come from an image source');
    const src = info.sources[0];
    assert.deepEqual(
      { w: src.w, h: src.h },
      { w: SHEET_W, h: SHEET_H },
      `the zombie texture must be the ${SHEET_W}x${SHEET_H} spritesheet, got ${src.w}x${src.h}`,
    );
    t.diagnostic(`texture ${info.textureKeys[0]}: frames=${info.frames.length}, sources=${JSON.stringify(info.sources)}, frameTotal=${info.frameTotal}`);

    assert.equal(info.frames.length, FRAME_COUNT, `the spritesheet must be sliced into exactly ${FRAME_COUNT} frames`);
    const sorted = info.frames.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    sorted.forEach((f, i) => {
      assert.deepEqual({ w: f.w, h: f.h }, { w: FRAME_W, h: FRAME_H }, `frame #${i} (${f.name}) must be ${FRAME_W}x${FRAME_H}, got ${f.w}x${f.h}`);
      assert.equal(f.x, i * FRAME_W, `frame #${i} must sit at x=${i * FRAME_W} in the horizontal strip, got ${f.x}`);
      assert.equal(f.y, 0, `frame #${i} must sit on the single row (y=0), got y=${f.y}`);
    });

    // the browser really fetched that PNG through the Vite URL pipeline, byte for byte
    const pngResponses = errors.responses.filter((r) => {
      const url = decodeURIComponent(r.url.split('?')[0]);
      return /\.png$/i.test(url) && /image\/png/i.test(r.contentType);
    });
    t.diagnostic(`PNG responses: ${pngResponses.map((r) => `${r.status} ${decodeURIComponent(r.url)}`).join(' | ') || 'none'}`);
    const zombieAsset = pngResponses.find((r) => decodeURIComponent(r.url).includes('zombie-walk-spritesheet.png'));
    assert.ok(zombieAsset, 'the page must load resource/enemy/zombie-walk-spritesheet.png through a Vite URL import');
    assert.equal(zombieAsset.status, 200, 'the spritesheet must be served with 200');
    const served = Buffer.from(await (await fetch(zombieAsset.url)).arrayBuffer());
    assert.equal(sha1(served), sha1(sheet), 'the served spritesheet must be byte-identical to resource/enemy/zombie-walk-spritesheet.png');

    const gifRequests = errors.responses.filter((r) => /\.gif(\?|$)/i.test(r.url));
    t.diagnostic(`GIF requests: ${gifRequests.map((r) => r.url).join(', ') || 'none'}`);
    assert.deepEqual(gifRequests, [], 'the runtime must not fetch or decode any GIF');

    t.diagnostic(`console errors: ${errors.console.length}, page errors: ${errors.page.length}`);
    assert.deepEqual(errors.page, [], 'the page must not throw while loading the spritesheet');
  });
});

/* ------------------------------------------------------------------ *
 * R2 - 22 frame loop, alternating 90/180ms, 2.97s cycle, keeps playing
 * ------------------------------------------------------------------ */

test('R2 walk animation: 22 frames with alternating 90/180ms delays (2970ms cycle), looping while the zombie lives', { timeout: 120000 }, async (t) => {
  await withGame(t, {}, async (page) => {
    const count = await waitForZombies(page, 1, 8000);
    assert.ok(count >= 1, 'no zombie was spawned (R3)');

    const anim = await evalPage(page, `
      const scene = window.game.scene.getScene('world');
      const z = zlist(scene)[0];
      const key = z.anims && z.anims.currentAnim ? z.anims.currentAnim.key : null;
      const a = key && scene.anims ? (scene.anims.get ? scene.anims.get(key) : scene.anims.anims.get(key)) : null;
      return {
        key: key,
        playing: !!(z.anims && z.anims.isPlaying),
        repeat: a ? a.repeat : null,
        frameRate: a ? a.frameRate : null,
        msPerFrame: a ? a.msPerFrame : null,
        frames: a ? a.frames.map(function (f) { return { index: f.index, duration: f.duration, key: f.textureKey, frame: String(f.textureFrame) }; }) : [],
      };`);
    assert.ok(anim.key, 'the zombie must be playing a registered animation');
    t.diagnostic(`animation '${anim.key}': repeat=${anim.repeat}, frameRate=${anim.frameRate}, msPerFrame=${anim.msPerFrame}, playing=${anim.playing}`);
    assert.equal(anim.frames.length, FRAME_COUNT, `the animation must contain ${FRAME_COUNT} frames`);
    assert.equal(anim.repeat, -1, 'the animation must loop forever (repeat -1)');

    const durations = anim.frames.map((f) => f.duration);
    t.diagnostic(`frame durations: ${durations.join(',')}`);
    durations.forEach((d, i) => {
      assert.ok(FRAME_DELAYS.includes(d), `frame #${i} delay must be 90ms or 180ms (the GIF timing), got ${d}ms`);
      if (i > 0) assert.notEqual(d, durations[i - 1], `frame delays must alternate 90/180ms; frames #${i - 1}/#${i} both use ${d}ms`);
    });
    assert.equal(durations.filter((d) => d === 90).length, FRAME_COUNT / 2, '11 frames must use a 90ms delay');
    assert.equal(durations.filter((d) => d === 180).length, FRAME_COUNT / 2, '11 frames must use a 180ms delay');
    const sum = durations.reduce((a, b) => a + b, 0);
    t.diagnostic(`cycle length from frame delays: ${sum}ms`);
    assert.equal(sum, CYCLE_MS, `one full cycle must take ${CYCLE_MS}ms (2.97s), got ${sum}ms`);
    anim.frames.forEach((f, i) => {
      assert.equal(f.frame, String(i), `animation frame #${i} must sample spritesheet frame ${i}, got '${f.frame}'`);
    });

    // the animation really advances at that pace and wraps around
    const samples = await evalPage(page, `
      const scene = window.game.scene.getScene('world');
      const z = zlist(scene)[0];
      if (!z) return [];
      const out = [];
      const t0 = performance.now();
      return new Promise(function (resolve) {
        const iv = setInterval(function () {
          const cf = z.anims && z.anims.currentFrame ? z.anims.currentFrame : null;
          out.push({
            t: performance.now() - t0,
            frame: z.frame ? String(z.frame.name) : null,
            index: cf ? cf.index : null,
            textureFrame: cf ? String(cf.textureFrame) : null,
            playing: !!(z.anims && z.anims.isPlaying),
            alive: z.active !== false,
          });
          if (performance.now() - t0 >= 3300) { clearInterval(iv); resolve(out); }
        }, 55);
      });`);
    assert.ok(samples.length > 30, `the animation sampler collected only ${samples.length} samples`);

    const frameNumber = (s) => {
      const n = Number(s.frame);
      if (Number.isFinite(n)) return n;
      const m = Number(s.textureFrame);
      return Number.isFinite(m) ? m : null;
    };
    const series = samples.map((s) => ({ t: s.t, f: frameNumber(s), playing: s.playing, alive: s.alive }));
    t.diagnostic(`sampled ${series.length} animation frames over ${(series[series.length - 1].t || 0).toFixed(0)}ms; first=${series[0].f}`);
    assert.ok(series.every((s) => s.alive), 'the zombie must stay alive for the whole animation observation');
    assert.ok(series.every((s) => s.playing), 'the walk animation must play continuously while the zombie lives');

    const transitions = [];
    for (let i = 1; i < series.length; i += 1) {
      if (series[i].f !== series[i - 1].f) transitions.push({ t: series[i].t, from: series[i - 1].f, to: series[i].f, dt: series[i].t - series[i - 1].t });
    }
    const startedAt = series[0].f;
    const last = series[series.length - 1];
    const advanced = (last.f - startedAt + FRAME_COUNT) % FRAME_COUNT + FRAME_COUNT * Math.floor(transitions.filter((x) => x.to < x.from).length);
    t.diagnostic(`frame transitions: ${transitions.length}, wraps: ${transitions.filter((x) => x.to < x.from).length}, net frames advanced: ${advanced}`);
    assert.ok(transitions.length >= FRAME_COUNT, `the animation must advance at least ${FRAME_COUNT} frames in 3.3s, saw ${transitions.length}`);
    transitions.forEach((tr) => {
      assert.equal(tr.to, (tr.from + 1) % FRAME_COUNT, `the animation must step +1 frame (loop 21 -> 0); saw ${tr.from} -> ${tr.to}`);
    });
    assert.ok(transitions.some((x) => x.to < x.from), 'the animation must wrap around (21 -> 0) within 3.3s, i.e. it loops');
    const single = transitions.filter((x) => x.dt > 50);
    const badTiming = single.filter((x) => ![90, 180].some((d) => within(x.dt, d, 45)));
    t.diagnostic(`observed frame hold times: ${single.map((x) => x.dt.toFixed(0)).join(',')}`);
    assert.deepEqual(badTiming.map((x) => `${x.from}->${x.to}:${x.dt.toFixed(0)}ms`), [], 'each frame must be held ~90ms or ~180ms (GIF timing), within 45ms sampling slack');
    const distinct = new Set(series.map((s) => s.f)).size;
    t.diagnostic(`distinct frames observed: ${distinct}/${FRAME_COUNT}`);
    assert.ok(distinct >= FRAME_COUNT - 2, `the loop must visit (nearly) every frame; saw ${distinct}`);
  });
});

/* ------------------------------------------------------------------ *
 * R3 - immediate first spawn, 2000ms attempts, cap 5, no queue
 * ------------------------------------------------------------------ */

const SPAWN_RECORDER = () => {
  window.__rec = { events: [], maxAlive: 0, frames: 0, firstFrame: null, createAt: null, atCreate: null, error: null };
  let prev = [];
  let createHooked = false;
  const countZombies = (sc) => sc.children.list.filter(
    (o) => o && o.frame && o.texture && o.texture.key !== 'dart' && o.frame.realWidth === 166 && o.frame.realHeight === 144 && o.active !== false,
  ).length;
  const tick = () => {
    try {
      const g = window.game;
      const sc = g && g.scene ? g.scene.getScene('world') : null;
      if (sc && sc.children && sc.time && sc.cameras && sc.cameras.main) {
        const R = window.__rec;
        if (!createHooked) {
          createHooked = true;
          sc.events.once('create', () => {
            R.createAt = sc.time.now;
            R.atCreate = countZombies(sc);
          });
        }
        const zs = sc.children.list.filter(
          (o) => o && o.frame && o.texture && o.texture.key !== 'dart' && o.frame.realWidth === 166 && o.frame.realHeight === 144 && o.active !== false,
        );
        R.frames += 1;
        if (R.firstFrame === null) R.firstFrame = { t: sc.time.now, n: zs.length };
        if (zs.length > R.maxAlive) R.maxAlive = zs.length;
        const cam = sc.cameras.main;
        const bounds = sc.physics && sc.physics.world && sc.physics.world.bounds
          ? { x: sc.physics.world.bounds.x, y: sc.physics.world.bounds.y, width: sc.physics.world.bounds.width, height: sc.physics.world.bounds.height }
          : null;
        // The visible world rect of an unrotated, unzoomed camera is its scroll rect.
        // `worldView` is only refreshed during preRender and is still the boot value
        // (0,0,w,h) on the frame the scene is created, so it is recorded for diagnostics.
        const view = { x: cam.scrollX, y: cam.scrollY, width: cam.width, height: cam.height };
        const stored = cam.worldView ? { x: cam.worldView.x, y: cam.worldView.y, width: cam.worldView.width, height: cam.worldView.height } : null;
        zs.forEach((z) => {
          if (prev.indexOf(z) !== -1) return;
          R.events.push({
            t: sc.time.now,
            x: z.x,
            y: z.y,
            displayW: z.displayWidth,
            displayH: z.displayHeight,
            alive: zs.length,
            view: view,
            worldView: stored,
            zoom: cam.zoom,
            bounds,
          });
        });
        prev = zs;
      }
    } catch (err) {
      window.__rec.error = String((err && err.stack) || err);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

test('R3 spawn rhythm: first spawn immediately, one attempt every 2000ms, at most 5 alive, skipped while full and never queued', { timeout: 150000 }, async (t) => {
  await withGame(t, { initScript: SPAWN_RECORDER }, async (page) => {
    await setPhysics(page, true); // freeze zombies so the cap can be observed; the spawner is time driven

    // 5 spawns need 5 attempts: 0, 2000, 4000, 6000, 8000 ms
    await page.waitForTimeout(13200);
    const phase1 = await evalPage(page, `
      const R = window.__rec;
      return { events: R.events, maxAlive: R.maxAlive, frames: R.frames, firstFrame: R.firstFrame, createAt: R.createAt, atCreate: R.atCreate, error: R.error };`);
    assert.equal(phase1.error, null, `the recorder threw: ${phase1.error}`);
    assert.ok(phase1.frames > 300, `the recorder captured only ${phase1.frames} frames`);
    const events = phase1.events;
    const t0 = events.length ? events[0].t : 0;
    t.diagnostic(`spawn times (scene clock ms): ${events.map((e) => e.t.toFixed(0)).join(', ')} | max alive ${phase1.maxAlive} | recorder frames ${phase1.frames}`);
    t.diagnostic(`scene create at t=${phase1.createAt === null ? 'n/a' : phase1.createAt.toFixed(1)}ms with ${phase1.atCreate} zombie(s); first observable scene frame t=${phase1.firstFrame.t.toFixed(1)}ms`);

    assert.ok(events.length >= 5, `expected at least 5 spawns in 13.2s (one per 2000ms attempt), saw ${events.length}`);
    assert.ok(phase1.createAt !== null, 'the recorder must observe the scene create event (R3 measures the first spawn from create, not from asset loading)');
    assert.ok(phase1.atCreate >= 1, `the first zombie must already exist when create() completes, it had ${phase1.atCreate}`);
    assert.ok(
      events[0].t - phase1.createAt <= 50,
      `the first spawn must happen during scene create, first event at ${events[0].t.toFixed(1)}ms vs create at ${phase1.createAt.toFixed(1)}ms`,
    );

    const offGrid = events.filter((e) => gridDistance(e.t - t0, SPAWN_INTERVAL) > 300);
    t.diagnostic(`spawn phase error (ms): ${events.map((e) => (e.t - t0 - Math.round((e.t - t0) / SPAWN_INTERVAL) * SPAWN_INTERVAL).toFixed(0)).join(', ')}`);
    assert.deepEqual(offGrid.map((e) => e.t.toFixed(0)), [], `every spawn must follow an attempt on the 2000ms grid (+/-300ms sampling), off-grid: ${offGrid.map((e) => e.t.toFixed(0)).join(',')}`);
    const gaps = events.slice(1).map((e, i) => e.t - events[i].t);
    t.diagnostic(`spawn gaps (ms): ${gaps.map((g) => g.toFixed(0)).join(', ')}`);
    gaps.forEach((g, i) => {
      assert.ok(gridDistance(g, SPAWN_INTERVAL) <= 300 && g >= SPAWN_INTERVAL - 300, `spawn gap #${i} must be one 2000ms attempt period (+/-300ms), got ${g.toFixed(0)}ms`);
    });

    assert.equal(phase1.maxAlive, MAX_ALIVE, `alive count must top out at exactly ${MAX_ALIVE} (5 spawns, then skips), saw ${phase1.maxAlive}`);
    assert.ok(phase1.maxAlive <= MAX_ALIVE, `the alive count must never exceed ${MAX_ALIVE}, saw ${phase1.maxAlive}`);
    assert.equal(events.length, MAX_ALIVE, `exactly ${MAX_ALIVE} spawns must happen in 13.2s while the field stays full (the attempts after the cap are skipped), saw ${events.length}`);

    const buckets = events.map((e) => Math.round((e.t - t0) / SPAWN_INTERVAL));
    assert.equal(new Set(buckets).size, buckets.length, `spawns must not be queued: at most one per 2000ms attempt, buckets ${buckets.join(',')}`);

    // free exactly one slot through the real contact path, then wait for the next attempt only
    const phaseCheck = async () => evalPage(page, `const sc = window.game.scene.getScene('world'); return { t: sc.time.now, n: zlist(sc).length };`);
    let state = await phaseCheck();
    for (let i = 0; i < 60; i += 1) {
      const toBoundary = SPAWN_INTERVAL - (state.t % SPAWN_INTERVAL);
      if (toBoundary >= 700 && toBoundary <= 1800) break;
      await page.waitForTimeout(80);
      state = await phaseCheck();
    }
    const killAt = state.t;
    t.diagnostic(`freeing one slot at scene t=${killAt.toFixed(0)}ms (${(SPAWN_INTERVAL - (killAt % SPAWN_INTERVAL)).toFixed(0)}ms before the next attempt)`);

    await evalPage(page, `
      const sc = window.game.scene.getScene('world');
      sc.physics.resume();
      const z = zlist(sc)[0];
      window.__freedZombie = z;
      sc.player.body.reset(z.x, z.y);
      return true;`);
    const started = Date.now();
    let alive = await evalPage(page, `return zlist(window.game.scene.getScene('world')).length;`);
    while (alive >= MAX_ALIVE && Date.now() - started < 1500) {
      await page.waitForTimeout(80);
      alive = await evalPage(page, `return zlist(window.game.scene.getScene('world')).length;`);
    }
    t.diagnostic(`alive count after freeing a slot: ${alive}`);
    assert.ok(alive < MAX_ALIVE, `the contact must remove a zombie so a slot is free (R9), alive count ${alive}`);

    await page.waitForTimeout(2600);
    const phase2 = await evalPage(page, `
      const R = window.__rec;
      return { events: R.events, maxAlive: R.maxAlive };`);
    const later = phase2.events;
    t.diagnostic(`spawn times after freeing a slot: ${later.map((e) => e.t.toFixed(0)).join(', ')} | max alive ${phase2.maxAlive}`);
    assert.ok(later.length > events.length, 'a free slot must be used by the next spawn attempt (no permanent stall)');
    const newEvents = later.slice(events.length);
    assert.ok(newEvents.length <= 2, `a freed slot must not release a queue: ${newEvents.length} spawns appeared in 2.6s`);
    const buckets2 = later.map((e) => Math.round(e.t / SPAWN_INTERVAL));
    assert.equal(new Set(buckets2).size, buckets2.length, `spawns must not be queued/burst: buckets ${buckets2.join(',')}`);
    assert.ok(phase2.maxAlive <= MAX_ALIVE, `the alive count must never exceed ${MAX_ALIVE}, saw ${phase2.maxAlive}`);
    assert.equal(phase2.maxAlive, MAX_ALIVE, `after a freed slot the population must return to ${MAX_ALIVE}`);
  });
});

/* ------------------------------------------------------------------ *
 * R4 - spawn points inside the map and 80-280px outside the camera
 * ------------------------------------------------------------------ */

test('R4 spawn positions: inside the map bounds and 80-280px outside the camera view (off screen but close)', { timeout: 120000 }, async (t) => {
  await withGame(t, { initScript: SPAWN_RECORDER }, async (page) => {
    await setPhysics(page, true);
    await page.waitForTimeout(8600);
    const rec = await evalPage(page, `
      const R = window.__rec;
      const sc = window.game.scene.getScene('world');
      const cam = sc.cameras.main;
      return {
        events: R.events,
        maxAlive: R.maxAlive,
        error: R.error,
        camNow: { x: cam.worldView.x, y: cam.worldView.y, width: cam.worldView.width, height: cam.worldView.height },
        bounds: sc.physics.world.bounds ? { x: sc.physics.world.bounds.x, y: sc.physics.world.bounds.y, width: sc.physics.world.bounds.width, height: sc.physics.world.bounds.height } : null,
        display: { w: ${DISPLAY_WIDTH}, h: ${DISPLAY_HEIGHT} },
      };`);
    assert.equal(rec.error, null, `the recorder threw: ${rec.error}`);
    assert.ok(rec.bounds, 'the Arcade world bounds must exist (R10)');
    t.diagnostic(`map bounds ${JSON.stringify(rec.bounds)}, settled camera ${JSON.stringify(rec.camNow)}`);
    t.diagnostic(`spawn events: ${rec.events.map((e) => `t=${e.t.toFixed(0)} (${e.x.toFixed(1)},${e.y.toFixed(1)}) alive=${e.alive}`).join(' | ')}`);
    assert.ok(rec.events.length >= 4, `expected at least 4 spawns in 8.6s, saw ${rec.events.length}`);
    assert.equal(rec.maxAlive, MAX_ALIVE, `the field must fill up to ${MAX_ALIVE} in 8.6s, saw ${rec.maxAlive}`);

    const b = rec.bounds;
    rec.events.forEach((e, i) => {
      assert.ok(e.view && e.view.width > 0 && e.view.height > 0, `spawn #${i}: the spawn-time camera rect must be readable, got ${JSON.stringify(e.view)}`);
      const margin = pointRectDistance(e.x, e.y, e.view);
      const rect = { x: e.x - e.displayW / 2, y: e.y - e.displayH / 2, width: e.displayW, height: e.displayH };
      t.diagnostic(
        `spawn #${i} at t=${e.t.toFixed(0)}ms: pos (${e.x.toFixed(1)},${e.y.toFixed(1)}), camera ${JSON.stringify(e.view)}, margin ${margin.toFixed(2)}px, visible overlap ${rectsOverlap(rect, e.view)}`,
      );
      assert.ok(
        e.x >= b.x && e.x <= b.x + b.width && e.y >= b.y && e.y <= b.y + b.height,
        `spawn #${i} must lie inside the map bounds ${JSON.stringify(b)}, got (${e.x.toFixed(1)}, ${e.y.toFixed(1)})`,
      );
      assert.ok(
        margin >= CAMERA_MARGIN - 0.5,
        `spawn #${i} must be at least ${CAMERA_MARGIN}px away from the camera rect ${JSON.stringify(e.view)}, got ${margin.toFixed(2)}px`,
      );
      assert.ok(
        margin <= SPAWN_MAX_MARGIN + 0.5,
        `spawn #${i} must be at most ${SPAWN_MAX_MARGIN}px away from the camera rect ${JSON.stringify(e.view)}, got ${margin.toFixed(2)}px`,
      );
      assert.ok(
        !rectsOverlap(rect, e.view),
        `spawn #${i}: the ${e.displayW.toFixed(1)}x${e.displayH.toFixed(1)} zombie must be completely outside the camera view ${JSON.stringify(e.view)}, its rect is ${JSON.stringify(rect)}`,
      );
    });
  });
});

/* ------------------------------------------------------------------ *
 * R5 - 150px/s tracking of the player's display centre
 * ------------------------------------------------------------------ */

test('R5 tracking: 150px/s toward the player display centre, half the 300px/s player speed, re-aimed every frame', { timeout: 120000 }, async (t) => {
  await withGame(t, {}, async (page) => {
    await focusCanvas(page);
    await resetPlayer(page, 1000, 1000);
    const count = await waitForZombies(page, 2, 6000);
    assert.ok(count >= 2, `expected at least 2 zombies to test tracking, got ${count}`);

    const snap = await snapshot(page);
    t.diagnostic(`player display centre (${snap.player.x.toFixed(1)}, ${snap.player.y.toFixed(1)}), body centre (${snap.player.body.cx.toFixed(1)}, ${snap.player.body.cy.toFixed(1)}), display ${snap.player.displayWidth.toFixed(1)}x${snap.player.displayHeight.toFixed(1)}`);
    snap.zombies.forEach((z, i) => {
      const mag = norm({ vx: z.body.vx, vy: z.body.vy });
      const fromSprite = expectedVelocity(z.x, z.y, snap.player);
      const fromBody = expectedVelocity(z.body.cx, z.body.cy, snap.player);
      const best = bestDirectionMatch({ vx: z.body.vx, vy: z.body.vy }, [fromSprite, fromBody]);
      t.diagnostic(
        `zombie #${i} at (${z.x.toFixed(1)},${z.y.toFixed(1)}): v=(${z.body.vx.toFixed(2)},${z.body.vy.toFixed(2)}) |v|=${mag.toFixed(2)}, direction error ${best.err.toFixed(2)} deg (${best.index === 0 ? 'sprite origin' : 'body origin'})`,
      );
      assert.ok(within(mag, SPEED, 0.5), `zombie #${i} must move at a constant ${SPEED}px/s, got ${mag.toFixed(2)}px/s`);
      assert.ok(best.err <= 3, `zombie #${i} must be aimed at the player's display centre (${snap.player.x.toFixed(1)},${snap.player.y.toFixed(1)}), direction is ${best.err.toFixed(2)} deg off`);
    });

    // crisp geometric check: sprite centre level with the player's display centre, 300px to the right
    const placed = await placeZombie(page, 0, snap.player.x + 300, snap.player.y);
    const afterPlace = await snapshot(page);
    const z = afterPlace.zombies[0];
    const candidates = [
      expectedVelocity(z.x, z.y, afterPlace.player), // vector from the sprite centre ...
      expectedVelocity(z.body.cx, z.body.cy, afterPlace.player), // ... or from the body centre
    ];
    const best = bestDirectionMatch({ vx: z.body.vx, vy: z.body.vy }, candidates);
    t.diagnostic(
      `placed zombie at (${z.x.toFixed(2)},${z.y.toFixed(2)}), body centre (${z.body.cx.toFixed(2)},${z.body.cy.toFixed(2)}), player centre (${afterPlace.player.x.toFixed(2)},${afterPlace.player.y.toFixed(2)}); v=(${z.body.vx.toFixed(2)},${z.body.vy.toFixed(2)})`,
    );
    t.diagnostic(`candidate velocities: sprite-origin (${candidates[0].vx.toFixed(2)},${candidates[0].vy.toFixed(2)}) body-origin (${candidates[1].vx.toFixed(2)},${candidates[1].vy.toFixed(2)})`);
    assert.ok(
      Math.abs(z.body.vx - candidates[best.index].vx) <= 0.8 && Math.abs(z.body.vy - candidates[best.index].vy) <= 0.8,
      `a zombie level with the player 300px to the right must get the exact normalised velocity toward the display centre ` +
        `(sprite origin ${JSON.stringify(candidates[0])} / body origin ${JSON.stringify(candidates[1])}), got (${z.body.vx.toFixed(2)}, ${z.body.vy.toFixed(2)})`,
    );

    // travel rate over time (physics, not just the velocity vector)
    const travel = await evalPage(page, `
      const scene = window.game.scene.getScene('world');
      const zs = zlist(scene);
      const z = zs[0];
      const p = scene.player.gameObject;
      const start = { x: z.x, y: z.y, t: performance.now() };
      return new Promise(function (resolve) {
        setTimeout(function () {
          resolve({ dt: performance.now() - start.t, dx: z.x - start.x, dy: z.y - start.y, px: p.x, py: p.y });
        }, 700);
      });`);
    const travelled = Math.hypot(travel.dx, travel.dy);
    const rate = (travelled / travel.dt) * 1000;
    t.diagnostic(`travelled ${travelled.toFixed(1)}px in ${travel.dt.toFixed(0)}ms => ${rate.toFixed(1)}px/s`);
    assert.ok(within(rate, SPEED, SPEED * 0.05), `the zombie must cover ${SPEED}px/s (+/-5%), measured ${rate.toFixed(1)}px/s`);

    // the player moves at 300px/s and the zombie keeps 150px/s: re-aimed live
    await resetPlayer(page, 1000, 1000);
    await page.keyboard.down('ArrowRight');
    let moving;
    try {
      moving = await evalPage(page, `
        const scene = window.game.scene.getScene('world');
        const p = scene.player.gameObject;
        const start = { x: p.x, y: p.y, t: performance.now() };
        const errs = [];
        const deadline = performance.now() + 5000;
        return new Promise(function (resolve) {
          const iv = setInterval(function () {
            const z = zlist(scene)[0];
            if (z && z.body && z.body.velocity) {
              const mag = Math.hypot(z.body.velocity.x, z.body.velocity.y);
              const cands = [
                [p.x - z.x, p.y - z.y],
                [p.x - z.body.center.x, p.y - z.body.center.y],
              ];
              const vAng = Math.atan2(z.body.velocity.y, z.body.velocity.x);
              let err = 999;
              cands.forEach(function (c) {
                const len = Math.hypot(c[0], c[1]) || 1;
                const aAng = Math.atan2((c[1] / len) * 150, (c[0] / len) * 150);
                let d = Math.abs(vAng - aAng) * 180 / Math.PI;
                if (d > 180) d = 360 - d;
                if (d < err) err = d;
              });
              errs.push({ mag: mag, err: err, dist: Math.hypot(cands[0][0], cands[0][1]) });
            }
            if (errs.length >= 8 || performance.now() > deadline) {
              clearInterval(iv);
              resolve({ dt: performance.now() - start.t, moved: Math.hypot(p.x - start.x, p.y - start.y), errs: errs, px: p.x, py: p.y });
            }
          }, 90);
        });`);
    } finally {
      await page.keyboard.up('ArrowRight');
    }
    const playerSpeed = (moving.moved / moving.dt) * 1000;
    t.diagnostic(`player travelled ${moving.moved.toFixed(1)}px in ${moving.dt.toFixed(0)}ms => ${playerSpeed.toFixed(1)}px/s`);
    assert.ok(moving.errs.length >= 8, `expected 8 live-zombie samples while the player moves, got ${moving.errs.length}`);
    t.diagnostic(`zombie |v| while the player moves: ${moving.errs.map((e) => e.mag.toFixed(1)).join('/')} | direction error (deg): ${moving.errs.map((e) => e.err.toFixed(2)).join('/')} | distance ${moving.errs[0].dist.toFixed(0)} -> ${moving.errs[moving.errs.length - 1].dist.toFixed(0)}px`);
    assert.ok(within(playerSpeed, PLAYER_SPEED, PLAYER_SPEED * 0.08), `test precondition: the player moves at ${PLAYER_SPEED}px/s, measured ${playerSpeed.toFixed(1)}`);
    moving.errs.forEach((e, i) => {
      assert.ok(within(e.mag, SPEED, 0.5), `zombie speed must stay ${SPEED}px/s while the player moves, sample #${i}: ${e.mag.toFixed(2)}`);
      assert.ok(e.err <= 3, `the zombie must re-aim at the player's current display centre on every frame (half the player's speed); sample #${i} is ${e.err.toFixed(2)} deg off`);
    });
  });
});

/* ------------------------------------------------------------------ *
 * R6 - monster config: speed only; shared module constants
 * ------------------------------------------------------------------ */

test('R6 monster config contains only speed=150 and all zombies share the same display/animation constants', { timeout: 90000 }, async (t) => {
  await withGame(t, {}, async (page) => {
    const count = await waitForZombies(page, 2, 8000);
    assert.ok(count >= 2, `expected at least 2 zombies, got ${count}`);
    const info = await evalPage(page, `
      const scene = window.game.scene.getScene('world');
      const found = findManager(scene);
      const zs = zlist(scene);
      const candidates = [];
      const consider = function (label, obj) {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
        let speed;
        try { speed = obj.speed; } catch (e) { return; }
        if (typeof speed !== 'number') return;
        let json = null;
        try { json = JSON.parse(JSON.stringify(obj)); } catch (e) { json = { speed: speed, __unserialisable: true }; }
        candidates.push({ label: label, value: speed, keys: Object.keys(obj).sort(), json: json });
      };
      if (found) {
        Object.keys(found.obj).forEach(function (k) {
          let v;
          try { v = found.obj[k]; } catch (e) { return; }
          consider('manager.' + k, v);
        });
      }
      if (zs.length) {
        consider('zombie.constructor', zs[0].constructor);
        try { consider('zombie.constructor.config', zs[0].constructor.config); } catch (e) {}
        try { consider('zombie.config', zs[0].config); } catch (e) {}
      }
      const chosen = candidates.filter(function (c) { return c.keys.length === 1 && c.keys[0] === 'speed'; })[0] || candidates[0] || null;
      const configProp = chosen ? chosen.label : null;
      const config = chosen ? chosen.json : null;
      const managerFunctions = found ? Object.getOwnPropertyNames(found.obj).filter(function (k) {
        try { return typeof found.obj[k] === 'function'; } catch (e) { return false; }
      }) : [];
      return {
        manager: found ? { name: found.name, via: found.via, kids: found.kids || null } : null,
        configProp: configProp,
        config: config,
        candidates: candidates,
        managerFunctions: managerFunctions,
        zombies: zs.map(function (z) { return zinfo(scene, z); }),
        ownSpeedProps: zs.map(function (z) { return Object.prototype.hasOwnProperty.call(z, 'speed') ? z.speed : null; }),
      };`);
    t.diagnostic(`zombie manager found at scene.${info.manager ? info.manager.name : 'MISSING'} (via ${info.manager ? info.manager.via : '-'}, children ${info.manager ? info.manager.kids : '-'})`);
    t.diagnostic(`manager functions: ${info.managerFunctions.join(', ')}`);
    assert.ok(info.manager, 'no zombie manager could be found on the scene');
    assert.ok(info.configProp, 'the manager must expose a monster config object containing speed');
    t.diagnostic(`config at ${info.configProp}: ${JSON.stringify(info.config)}`);
    t.diagnostic(`config-like objects found: ${JSON.stringify(info.candidates.map((c) => `${c.label} keys=[${c.keys}] speed=${c.value}`))}`);
    assert.deepEqual(Object.keys(info.config).sort(), ['speed'], `the monster config must contain only the speed entry (R6), got ${JSON.stringify(info.config)}`);
    assert.equal(info.config.speed, SPEED, `the configured speed must be ${SPEED}px/s`);

    const distinct = (pick) => Array.from(new Set(info.zombies.map(pick)));
    const textureKeys = distinct((z) => z.textureKey);
    const animKeys = distinct((z) => z.animKey);
    const heights = distinct((z) => z.displayHeight.toFixed(4));
    const widths = distinct((z) => z.displayWidth.toFixed(4));
    const scales = distinct((z) => `${z.scaleX.toFixed(6)}/${z.scaleY.toFixed(6)}`);
    const depths = distinct((z) => z.depth);
    t.diagnostic(`textures ${textureKeys.join(',')} | anims ${animKeys.join(',')} | display ${widths.join(',')}x${heights.join(',')} | scale ${scales.join(',')} | depth ${depths.join(',')}`);
    assert.equal(textureKeys.length, 1, 'every zombie must use the same texture (no per-instance differentiation)');
    assert.equal(animKeys.length, 1, 'every zombie must use the same animation');
    assert.equal(heights.length, 1, 'every zombie must use the same display height (module constant)');
    assert.equal(widths.length, 1, 'every zombie must use the same display width (module constant)');
    assert.equal(scales.length, 1, 'every zombie must use the same scale (module constant)');
    assert.equal(depths.length, 1, 'every zombie must use the same render depth');
    assert.deepEqual(info.ownSpeedProps.filter((v) => v !== null && v !== SPEED), [], 'no zombie instance may override the speed');
  });
});

/* ------------------------------------------------------------------ *
 * R7 - mirroring
 * ------------------------------------------------------------------ */

test('R7 mirroring: default facing while vx<0, flipX for vx>0, previous facing kept while |vx|<1', { timeout: 120000 }, async (t) => {
  await withGame(t, {}, async (page) => {
    await focusCanvas(page);
    await resetPlayer(page, 1000, 1000);
    const count = await waitForZombies(page, 1, 8000);
    assert.ok(count >= 1, 'no zombie to mirror');

    const hasTarget = await evalPage(page, `
      const sc = window.game.scene.getScene('world');
      window.__zTarget = zlist(sc)[0] || null;
      return !!window.__zTarget;`);
    assert.ok(hasTarget, 'no zombie to mirror');

    const placeTarget = async (sx, sy) =>
      evalPage(page, `
        const sc = window.game.scene.getScene('world');
        const z = window.__zTarget;
        if (!z || z.active === false || !z.body) return null;
        z.setPosition(${sx}, ${sy});
        return { x: z.x, y: z.y };`);

    const read = async () => {
      await frames(page, 3);
      return evalPage(page, `
        const sc = window.game.scene.getScene('world');
        const z = window.__zTarget;
        return {
          player: pinfo(sc),
          z: z && z.active !== false && z.body ? zinfo(sc, z) : null,
        };`);
    };

    // A 2px horizontal offset is enough to push |vx| above 1, so re-pin the exact x
    // on several frames before sampling the near-vertical branch.
    const placeAbove = async () => {
      for (let k = 0; k < 4; k += 1) {
        await evalPage(page, `
          const sc = window.game.scene.getScene('world');
          const z = window.__zTarget;
          const p = sc.player.gameObject;
          if (z && z.body) z.setPosition(p.x, p.y - 250);
          return true;`);
        await frames(page, 1);
      }
    };

    // vx > 0 -> flipped (the original animation faces left)
    let placed = await placeTarget(1000 - 250, 1000);
    let r = await read();
    assert.ok(r.z, 'the target zombie must stay alive');
    t.diagnostic(`zombie left of the player: vx=${r.z.body.vx.toFixed(2)}, flipX=${r.z.flipX}`);
    assert.ok(r.z.body.vx > 10, `precondition: a zombie left of the player walks right, vx=${r.z.body.vx.toFixed(2)}`);
    assert.equal(r.z.flipX, true, 'vx>0 must mirror the sprite horizontally (the source animation faces left)');

    // vx < 0 -> default facing
    placed = await placeTarget(1000 + 250, 1000);
    r = await read();
    assert.ok(r.z, 'the target zombie must stay alive');
    t.diagnostic(`zombie right of the player: vx=${r.z.body.vx.toFixed(2)}, flipX=${r.z.flipX}`);
    assert.ok(r.z.body.vx < -10, `precondition: a zombie right of the player walks left, vx=${r.z.body.vx.toFixed(2)}`);
    assert.equal(r.z.flipX, false, 'vx<0 must keep the default (unflipped) facing');

    // |vx| < 1 keeps the *previous* facing: unflipped -> unflipped
    await placeAbove();
    r = await read();
    assert.ok(r.z, 'the target zombie must stay alive');
    t.diagnostic(`zombie directly above (was walking left): sprite x=${r.z.x.toFixed(2)}, player x=${r.player.x.toFixed(2)}, vx=${r.z.body.vx.toFixed(2)}, flipX=${r.z.flipX}`);
    assert.ok(Math.abs(r.z.body.vx) < 1, `precondition: a zombie directly above the player has |vx|<1, got ${r.z.body.vx.toFixed(2)}`);
    assert.equal(r.z.flipX, false, 'with |vx|<1 the previous facing (default/unflipped) must be kept');

    // |vx| < 1 keeps the *previous* facing: flipped -> flipped
    placed = await placeTarget(r.player.x - 250, r.player.y);
    r = await read();
    assert.ok(r.z, 'the target zombie must stay alive');
    assert.equal(r.z.flipX, true, 'precondition: the zombie flipped while walking right');
    await placeAbove();
    r = await read();
    assert.ok(r.z, 'the target zombie must stay alive');
    t.diagnostic(`zombie directly above (was walking right): sprite x=${r.z.x.toFixed(2)}, player x=${r.player.x.toFixed(2)}, vx=${r.z.body.vx.toFixed(2)}, flipX=${r.z.flipX}, placed sprite x=${placed ? placed.x.toFixed(2) : '-'}`);
    assert.ok(Math.abs(r.z.body.vx) < 1, `precondition: a zombie directly above the player has |vx|<1, got ${r.z.body.vx.toFixed(2)}`);
    assert.equal(r.z.flipX, true, 'with |vx|<1 the previous facing (flipped) must be kept');

    // general invariant while walking: flipX === (vx > 0) whenever |vx| >= 1
    const series = await evalPage(page, `
      const scene = window.game.scene.getScene('world');
      const zs = zlist(scene);
      zs.forEach(function (z, i) { z.body.reset(1000 + (i % 2 === 0 ? -1 : 1) * 300, 700 + i * 60); });
      return new Promise(function (resolve) {
        const out = [];
        let n = 0;
        const iv = setInterval(function () {
          n += 1;
          zlist(scene).forEach(function (z) {
            if (!z.body || !z.body.velocity) return;
            out.push({ vx: z.body.velocity.x, flip: !!z.flipX, cx: z.body.center.x, cy: z.body.center.y });
          });
          if (n >= 8) { clearInterval(iv); resolve(out); }
        }, 60);
      });`);
    const strong = series.filter((s) => Math.abs(s.vx) >= 1);
    const wrong = strong.filter((s) => s.flip !== s.vx > 0);
    t.diagnostic(`checked ${strong.length} samples with |vx|>=1, mismatches: ${wrong.length}`);
    assert.ok(strong.length >= 8, `test precondition: enough samples with |vx|>=1 (${strong.length})`);
    assert.deepEqual(wrong.map((s) => `vx=${s.vx.toFixed(2)} flip=${s.flip}`), [], 'flipX must equal (vx > 0) whenever |vx| >= 1');
  });
});

/* ------------------------------------------------------------------ *
 * R8 - 110px tall, undistorted, rendered below player and darts
 * ------------------------------------------------------------------ */

test('R8 display: 110px tall (~127px wide) without distortion, rendered below the player and the darts', { timeout: 120000 }, async (t) => {
  await withGame(t, {}, async (page) => {
    const count = await waitForZombies(page, 2, 8000);
    assert.ok(count >= 2, `expected at least 2 zombies, got ${count}`);
    const data = await evalPage(page, `
      const scene = window.game.scene.getScene('world');
      const zs = zlist(scene);
      const darts = scene.children.list.filter(function (o) { return o.texture && o.texture.key === 'dart'; });
      return {
        player: pinfo(scene),
        zombies: zs.map(function (z) { return zinfo(scene, z); }),
        darts: darts.map(function (d) { return { depth: d.depth, listIndex: scene.children.list.indexOf(d) }; }),
      };`);
    t.diagnostic(`player depth ${data.player.depth} (index ${data.player.listIndex}); darts ${data.darts.map((d) => `${d.depth}@${d.listIndex}`).join(',') || 'none'}`);
    assert.ok(data.zombies.length >= 2, 'expected at least 2 zombies');
    data.zombies.forEach((z, i) => {
      t.diagnostic(`zombie #${i}: display ${z.displayWidth.toFixed(3)}x${z.displayHeight.toFixed(3)}, scale ${z.scaleX}/${z.scaleY}, depth ${z.depth} (index ${z.listIndex}), frame ${z.frameW}x${z.frameH}`);
      assert.ok(within(z.displayHeight, DISPLAY_HEIGHT, 0.5), `zombie #${i} must be ${DISPLAY_HEIGHT}px tall, got ${z.displayHeight.toFixed(3)}`);
      assert.ok(within(z.displayWidth, DISPLAY_WIDTH, 0.7), `zombie #${i} must be ~${DISPLAY_WIDTH.toFixed(1)}px wide (equal aspect), got ${z.displayWidth.toFixed(3)}`);
      assert.ok(within(z.scaleX, z.scaleY, Math.abs(z.scaleX) * 0.002), `zombie #${i} must be scaled uniformly, scaleX ${z.scaleX} vs scaleY ${z.scaleY}`);
      assert.ok(z.scaleX > 0 && z.scaleY > 0, `zombie #${i} must not be mirrored through a negative scale (${z.scaleX}/${z.scaleY})`);
      const frameAspect = z.frameW / z.frameH;
      const displayAspect = z.displayWidth / z.displayHeight;
      assert.ok(Math.abs(displayAspect / frameAspect - 1) <= 0.002, `zombie #${i} must not be distorted (frame ${frameAspect.toFixed(4)} vs display ${displayAspect.toFixed(4)})`);

      const belowPlayer = z.depth < data.player.depth || (z.depth === data.player.depth && z.listIndex < data.player.listIndex);
      assert.ok(belowPlayer, `zombie #${i} must render below the player (zombie depth ${z.depth} index ${z.listIndex} vs player depth ${data.player.depth} index ${data.player.listIndex})`);
      data.darts.forEach((d, k) => {
        const belowDart = z.depth < d.depth || (z.depth === d.depth && z.listIndex < d.listIndex);
        assert.ok(belowDart, `zombie #${i} must render below dart #${k} (zombie depth ${z.depth} index ${z.listIndex} vs dart depth ${d.depth} index ${d.listIndex})`);
      });
    });
  });
});

/* ------------------------------------------------------------------ *
 * R9 - contact destroys the zombie and calls the empty callback
 * ------------------------------------------------------------------ */

test('R9 contact: body overlap destroys the zombie, invokes the empty contact hook and leaves the player unharmed', { timeout: 120000 }, async (t) => {
  await withGame(t, {}, async (page) => {
    await focusCanvas(page);
    await resetPlayer(page, 1000, 1000);
    const count = await waitForZombies(page, 2, 8000);
    assert.ok(count >= 2, `expected at least 2 zombies, got ${count}`);

    // park the extra zombies far away so they cannot interfere with the contact test
    await evalPage(page, `
      const scene = window.game.scene.getScene('world');
      const zs = zlist(scene);
      window.__zTarget = zs[0];
      zs.forEach(function (z, i) { if (i > 0) z.body.reset(150 + i * 40, 150); });
      return zs.length;`);
    await frames(page, 3);

    // geometry: overlap threshold along the horizontal axis
    const geom = await evalPage(page, `
      const scene = window.game.scene.getScene('world');
      const z = zlist(scene)[0];
      const p = scene.player.gameObject;
      return {
        zRadius: z.body.halfWidth,
        pRadius: p.body.isCircle ? p.body.halfWidth : null,
        pHalfWidth: p.body.halfWidth,
        pHalfHeight: p.body.halfHeight,
        pIsCircle: !!p.body.isCircle,
        pPos: { x: p.x, y: p.y },
        pBody: { cx: p.body.center.x, cy: p.body.center.y },
      };`);
    // along the horizontal approach the bodies touch when the centres are this far apart
    const threshold = geom.pHalfWidth + geom.zRadius;
    t.diagnostic(`contact threshold ${threshold.toFixed(2)}px (player body ${geom.pIsCircle ? 'circle' : 'rect'} halfWidth ${geom.pHalfWidth.toFixed(2)}, zombie radius ${geom.zRadius.toFixed(2)})`);

    // spy on the manager's callbacks before contact
    const spy = await evalPage(page, `
      const scene = window.game.scene.getScene('world');
      const found = findManager(scene);
      if (!found) return { ok: false, reason: 'no manager' };
      window.__spy = [];
      const mgr = found.obj;
      const names = new Set(Object.getOwnPropertyNames(mgr));
      let proto = Object.getPrototypeOf(mgr);
      while (proto && proto !== Object.prototype) {
        Object.getOwnPropertyNames(proto).forEach(function (n) { names.add(n); });
        proto = Object.getPrototypeOf(proto);
      }
      let wrapped = 0;
      names.forEach(function (n) {
        if (n === 'constructor') return;
        let desc;
        try { desc = Object.getOwnPropertyDescriptor(mgr, n); } catch (e) { desc = null; }
        let fn;
        try { fn = mgr[n]; } catch (e) { return; }
        if (typeof fn !== 'function') return;
        try {
          mgr[n] = function () {
            const args = Array.prototype.slice.call(arguments);
            window.__spy.push({ n: n, hasTarget: args.indexOf(window.__zTarget) !== -1, argc: args.length });
            return fn.apply(this, args);
          };
          wrapped += 1;
        } catch (e) { /* non writable */ }
      });
      return { ok: true, name: found.name, wrapped: wrapped };`);
    t.diagnostic(`manager ${spy.ok ? `scene.${spy.name}, wrapped ${spy.wrapped} callbacks` : spy.reason}`);
    assert.ok(spy.ok, `no zombie manager found (${spy.reason})`);

    // a zombie that stays outside the contact radius must survive: baseline for the callback spy
    const farPlaced = await evalPage(page, `
      const scene = window.game.scene.getScene('world');
      const z = window.__zTarget;
      const p = scene.player.gameObject;
      window.__spy.length = 0;
      z.body.reset(p.body.center.x - (${threshold} + 80), p.body.center.y);
      return { x: z.x, y: z.y };`);
    await page.waitForTimeout(420);
    const farAlive = await evalPage(page, `const scene = window.game.scene.getScene('world'); return zlist(scene).indexOf(window.__zTarget) !== -1;`);
    const callsFar = await evalPage(page, `return window.__spy || [];`);
    t.diagnostic(`zombie placed ${(threshold + 80).toFixed(1)}px away (80px outside the contact radius) alive after 420ms: ${farAlive}`);
    t.diagnostic(`manager calls with the zombie while no contact happens: ${Array.from(new Set(callsFar.filter((c) => c.hasTarget).map((c) => c.n))).join(', ') || 'none'} (${callsFar.length} wrapped calls total)`);
    assert.equal(farAlive, true, 'a zombie whose body does not overlap the player must not be destroyed');

    const readState = () => evalPage(page, `
      const scene = window.game.scene.getScene('world');
      const p = scene.player.gameObject;
      const props = {};
      Object.keys(p).forEach(function (k) {
        if (/^(hp|health|life|lives|dead|invuln|damage)/i.test(k)) { try { props[k] = p[k]; } catch (e) {} }
      });
      const s = scene.sound;
      return {
        player: pinfo(scene),
        playerState: props,
        sounds: s && s.sounds ? s.sounds.filter(function (x) { return x.isPlaying; }).length : null,
        alive: zlist(scene).length,
      };`);
    const before = await readState();
    t.diagnostic(`before contact: alive=${before.alive}, player (${before.player.x.toFixed(2)},${before.player.y.toFixed(2)}), state ${JSON.stringify(before.playerState)}, playing sounds ${before.sounds}`);

    // walk it in from 30px outside the contact radius and watch every frame
    const approach = await evalPage(page, `
      const scene = window.game.scene.getScene('world');
      const z = window.__zTarget;
      const p = scene.player.gameObject;
      window.__spy.length = 0;
      z.body.reset(p.body.center.x - (${threshold} + 30), p.body.center.y);
      const frames = [];
      const t0 = performance.now();
      return new Promise(function (resolve) {
        const step = function () {
          const inList = scene.children.list.indexOf(z) !== -1;
          const alive = z.active !== false && inList && !!z.body;
          const dist = z.body ? Math.hypot(z.body.center.x - p.body.center.x, z.body.center.y - p.body.center.y) : 0;
          frames.push({ t: performance.now() - t0, alive: alive, dist: dist, vx: z.body ? z.body.velocity.x : 0, vy: z.body ? z.body.velocity.y : 0 });
          if (!alive || performance.now() - t0 > 4000) return resolve(frames);
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });`);
    const died = approach.filter((f) => !f.alive);
    const lastAlive = approach.filter((f) => f.alive).pop();
    t.diagnostic(`approach frames ${approach.length}, last alive distance ${lastAlive ? lastAlive.dist.toFixed(2) : '-'}px (threshold ${threshold.toFixed(2)}), died=${died.length > 0}`);
    assert.ok(died.length > 0, 'a zombie whose body overlaps the player must be destroyed');
    assert.ok(
      lastAlive && lastAlive.dist <= threshold + 4,
      `destruction must happen on body overlap, not before: last alive frame was ${lastAlive ? lastAlive.dist.toFixed(2) : '-'}px away while the bodies touch at ${threshold.toFixed(2)}px`,
    );
    const early = approach.filter((f) => f.alive && f.dist > threshold + 6);
    assert.ok(early.length >= 2, `test precondition: the zombie must approach from outside the contact radius (${early.length} frames)`);

    const after = await readState();
    const calls = await evalPage(page, `return window.__spy || [];`);
    const hookCalls = calls.filter((c) => c.hasTarget);
    const contactOnly = Array.from(new Set(hookCalls.map((c) => c.n))).filter(
      (n) => !callsFar.some((c) => c.hasTarget && c.n === n),
    );
    t.diagnostic(`manager calls with the zombie during contact: ${hookCalls.map((c) => `${c.n}(${c.argc})`).join(', ') || 'none'}; contact-only entry points: ${contactOnly.join(', ') || 'none'}; wrapped calls total ${calls.length}`);
    assert.ok(
      contactOnly.length >= 1,
      'contact must invoke an entry point that is not part of the per-frame walk (R9: an empty on-contact callback), ' +
        `methods seen with the zombie only during contact: ${JSON.stringify(contactOnly)}; all zombie-arg calls: ${JSON.stringify(Array.from(new Set(hookCalls.map((c) => c.n))))}`,
    );

    const targetGone = await evalPage(page, `const sc = window.game.scene.getScene('world'); return zlist(sc).indexOf(window.__zTarget) === -1;`);
    t.diagnostic(`alive zombies ${before.alive} -> ${after.alive}, target removed: ${targetGone}, player (${before.player.x.toFixed(2)},${before.player.y.toFixed(2)}) -> (${after.player.x.toFixed(2)},${after.player.y.toFixed(2)}), player velocity (${after.player.body.vx},${after.player.body.vy})`);
    assert.equal(targetGone, true, 'the touched zombie must be removed from the live zombie list');
    assert.ok(after.alive <= before.alive + 1, `at most the touched zombie may be destroyed, other spawns aside (${before.alive} -> ${after.alive})`);
    assert.ok(within(after.player.x, before.player.x, 1.5) && within(after.player.y, before.player.y, 1.5), 'the player must not be damaged or knocked back by contact (R9: no damage/knockback in this version)');
    assert.ok(Math.abs(after.player.body.vx) <= 0.01 && Math.abs(after.player.body.vy) <= 0.01, `the player must not be knocked back, velocity (${after.player.body.vx}, ${after.player.body.vy})`);
    t.diagnostic(`player state before/after: ${JSON.stringify(before.playerState)} / ${JSON.stringify(after.playerState)}`);
    assert.deepEqual(after.playerState, before.playerState, 'contact must not change any player health/damage state (R9: this version has no damage)');
    t.diagnostic(`playing sounds before/after contact: ${before.sounds}/${after.sounds}`);
    if (before.sounds !== null && after.sounds !== null) {
      assert.ok(after.sounds <= before.sounds, 'contact must not start any sound (R9: no audio in this version)');
    }

    const goneFromList = await evalPage(page, `
      const scene = window.game.scene.getScene('world');
      return { inList: scene.children.list.indexOf(window.__zTarget) !== -1, active: window.__zTarget.active };`);
    t.diagnostic(`destroyed zombie: in display list=${goneFromList.inList}, active=${goneFromList.active}`);
    assert.equal(goneFromList.active, false, 'the destroyed zombie must be deactivated');
  });
});

/* ------------------------------------------------------------------ *
 * R10 - circular body in the Arcade world, no zombie-zombie collision
 * ------------------------------------------------------------------ */

test('R10 physics: circular body scaled to the display, registered in the Arcade world, no zombie-zombie collider', { timeout: 120000 }, async (t) => {
  await withGame(t, {}, async (page) => {
    const count = await waitForZombies(page, 2, 8000);
    assert.ok(count >= 2, `expected at least 2 zombies, got ${count}`);
    const data = await evalPage(page, `
      const scene = window.game.scene.getScene('world');
      const w = scene.physics.world;
      const zs = zlist(scene);
      const zBodies = new Set(zs.map(function (z) { return z.body; }).filter(Boolean));
      const sideBodies = function (obj, depth) {
        const out = [];
        const walk = function (o, d) {
          if (!o || d > 5) return;
          if (o.body && o.body.world) { out.push(o.body); return; }
          if (o.gameObject && o.world) { out.push(o); return; }
          if (typeof o.getChildren === 'function') { (o.getChildren() || []).forEach(function (c) { walk(c, d + 1); }); return; }
          if (Array.isArray(o)) { o.forEach(function (c) { walk(c, d + 1); }); return; }
          if (o.children && typeof o.children.values === 'function') { Array.from(o.children.values()).forEach(function (c) { walk(c, d + 1); }); return; }
          if (o.object1 || o.object2) { walk(o.object1, d + 1); walk(o.object2, d + 1); }
        };
        walk(obj, 0);
        return out;
      };
      let colliders = [];
      if (w.colliders) {
        if (typeof w.colliders.getActive === 'function') colliders = w.colliders.getActive();
        else if (Array.isArray(w.colliders._active)) colliders = w.colliders._active;
        else if (Array.isArray(w.colliders.list)) colliders = w.colliders.list;
      }
      const pBody = scene.player.gameObject.body;
      return {
        playerBody: !!pBody,
        gravity: { x: w.gravity.x, y: w.gravity.y },
        zombies: zs.map(function (z) { return zinfo(scene, z); }),
        zombieBodiesInWorld: zs.map(function (z) {
          return !!(z.body && z.body.world === w && z.body.enable !== false);
        }),
        worldBodiesCount: w.bodies ? (typeof w.bodies.size === 'number' ? w.bodies.size : Array.from(w.bodies).length) : null,
        colliders: colliders.map(function (c) {
          const a = sideBodies(c && c.object1, 0);
          const b = sideBodies(c && c.object2, 0);
          const allZ = function (list) { return list.length > 0 && list.every(function (x) { return zBodies.has(x); }); };
          return {
            a: a.length,
            b: b.length,
            aAllZombie: allZ(a),
            bAllZombie: allZ(b),
            aHasPlayer: a.indexOf(pBody) !== -1,
            bHasPlayer: b.indexOf(pBody) !== -1,
            aHasZombie: a.some(function (x) { return zBodies.has(x); }),
            bHasZombie: b.some(function (x) { return zBodies.has(x); }),
          };
        }),
      };`);
    t.diagnostic(`arcade world bodies: ${data.worldBodiesCount}, zombies with bodies in that world: ${data.zombieBodiesInWorld.join(',')}`);
    t.diagnostic(`colliders: ${JSON.stringify(data.colliders)}`);

    data.zombies.forEach((z, i) => {
      assert.ok(z.body, `zombie #${i} must have an Arcade body`);
      assert.ok(data.zombieBodiesInWorld[i], `zombie #${i} body must be enabled inside the scene's Arcade world`);
      assert.equal(z.body.isCircle, true, `zombie #${i} must use a circular body`);
      const r = z.body.halfWidth; // world-space radius
      t.diagnostic(
        `zombie #${i} body: circle=${z.body.isCircle} world r=${r.toFixed(2)} box ${z.body.width.toFixed(2)}x${z.body.height.toFixed(2)} centre (${z.body.cx.toFixed(2)},${z.body.cy.toFixed(2)}) vs sprite (${z.x.toFixed(2)},${z.y.toFixed(2)}) display ${z.displayWidth.toFixed(2)}x${z.displayHeight.toFixed(2)}`,
      );
      assert.ok(r > 0, `zombie #${i} body radius must be positive`);
      assert.ok(within(z.body.width, r * 2, 1) && within(z.body.height, r * 2, 1), `zombie #${i} circular body box must be ${(r * 2).toFixed(2)}px square, got ${z.body.width.toFixed(2)}x${z.body.height.toFixed(2)}`);
      assert.ok(r * 2 <= z.displayHeight + 0.5, `zombie #${i} body diameter (${(r * 2).toFixed(2)}px) must fit inside the ${z.displayHeight.toFixed(1)}px display height`);
      const ratio = (r * 2) / z.displayHeight;
      t.diagnostic(`zombie #${i} body diameter / display height = ${ratio.toFixed(3)}`);
      assert.ok(ratio >= 0.15 && ratio <= 0.95, `zombie #${i} body must cover a proportional part of the display height (${(ratio * 100).toFixed(1)}%)`);
      // the circle must sit inside the sprite footprint, horizontally centred
      assert.ok(within(z.body.cx, z.x, 3), `zombie #${i} body must be horizontally centred on the sprite (body x ${z.body.cx.toFixed(2)} vs sprite ${z.x.toFixed(2)})`);
      assert.ok(
        z.body.cy - r >= z.y - z.displayHeight / 2 - 1 && z.body.cy + r <= z.y + z.displayHeight / 2 + 1,
        `zombie #${i} body circle must stay inside the display footprint (body y ${z.body.cy.toFixed(2)} r ${r.toFixed(2)}, sprite y ${z.y.toFixed(2)} h ${z.displayHeight.toFixed(1)})`,
      );
      assert.ok(
        z.body.cx - r >= z.x - z.displayWidth / 2 - 1 && z.body.cx + r <= z.x + z.displayWidth / 2 + 1,
        `zombie #${i} body circle must stay inside the display width (body x ${z.body.cx.toFixed(2)} r ${r.toFixed(2)}, sprite x ${z.x.toFixed(2)} w ${z.displayWidth.toFixed(1)})`,
      );
      assert.ok(
        z.body.allowGravity === false || (data.gravity.x === 0 && data.gravity.y === 0),
        `zombie #${i} must not be pulled by gravity (allowGravity=${z.body.allowGravity}, world gravity ${JSON.stringify(data.gravity)})`,
      );
    });

    const zombieZombie = data.colliders.filter((c) => (c.aAllZombie && (c.bAllZombie || c.bHasZombie)) || (c.bAllZombie && c.aHasZombie));
    assert.deepEqual(zombieZombie, [], 'no zombie-zombie collider may be registered (R10)');
    const playerZombie = data.colliders.filter((c) => (c.aHasPlayer && c.bHasZombie) || (c.bHasPlayer && c.aHasZombie));
    t.diagnostic(`player-zombie contact registrations: ${playerZombie.length}`);
    assert.ok(playerZombie.length >= 1, 'the player must be registered against the zombies so R9 contact can fire');
  });
});

/* ------------------------------------------------------------------ *
 * Build: npm run build ships the zombie spritesheet
 * ------------------------------------------------------------------ */

test('Build: npm run build succeeds and emits the zombie spritesheet exactly once', { timeout: 240000 }, async (t) => {
  const build = spawnSync('npm', ['run', 'build'], {
    cwd: PROJECT_ROOT,
    shell: true,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'production' },
  });
  t.diagnostic(`npm run build exit=${build.status}`);
  t.diagnostic(`${(build.stdout || '').trim().split('\n').slice(-6).join('\n')}`);
  assert.equal(build.status, 0, `npm run build must succeed\n${build.stdout}\n${build.stderr}`);

  const distDir = path.join(PROJECT_ROOT, 'dist');
  assert.ok(fs.existsSync(path.join(distDir, 'index.html')), 'dist/index.html must exist');

  const sheet = fs.readFileSync(SHEET_PATH);
  const emitted = [];
  const assets = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.png$/i.test(entry.name)) emitted.push(full);
      else if (/\.(js|css)$/i.test(entry.name)) assets.push(full);
    }
  };
  walk(distDir);
  const matched = emitted.filter((f) => sha1(fs.readFileSync(f)) === sha1(sheet));
  t.diagnostic(`dist PNGs: ${emitted.map((f) => path.relative(distDir, f)).join(', ')}`);
  assert.equal(matched.length, 1, `the zombie spritesheet must be emitted exactly once into dist/, found ${matched.length}`);
  const gifStrings = assets.filter((f) => fs.readFileSync(f, 'utf8').includes('image/gif'));
  t.diagnostic(`dist js/css files referencing image/gif: ${gifStrings.length} (diagnostic only)`);
});
