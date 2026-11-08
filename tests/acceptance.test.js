'use strict';

/**
 * Independent acceptance suite for feat/game-engine.
 * Requirements are taken from docs/sdlc/feat/game-engine/spec.md (R1-R11).
 *
 * Black-box only: the app is driven through a real Edge instance (playwright-core)
 * against a programmatically started Vite dev server. Runtime state is read through
 * the dev-only `window.game` handle.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const DEV_PORT = Number(process.env.ACCEPTANCE_DEV_PORT || 5178);
const PREVIEW_PORT = Number(process.env.ACCEPTANCE_PREVIEW_PORT || 4179);
const SUBPATH_PORT = Number(process.env.ACCEPTANCE_SUBPATH_PORT || 4181);
const DEV_URL = `http://127.0.0.1:${DEV_PORT}/`;
const PREVIEW_URL = `http://127.0.0.1:${PREVIEW_PORT}/`;
const SUBPATH_PREFIX = '/game/';
const SUBPATH_URL = `http://127.0.0.1:${SUBPATH_PORT}${SUBPATH_PREFIX}`;

const VIEWPORT = { width: 1280, height: 720 }; // canvas base size
const WORLD_SIZE = 2000; // spec R2: fixed world, decoupled from canvas
const GAME_W = 1280;
const GAME_H = 720;

const MIN_FPS = 50; // spec R8: no perceivable stutter, headless may vary
const LONG_FRAME_MS = 100; // spec R8: a single frame longer than this is perceivable stutter
const STUTTER_SAMPLE_MS = 10000; // sample window for the "no perceivable stutter" check
const MAX_STUTTER_FRAMES = 3; // tolerated frames > 50 ms inside the sample window

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

/* ------------------------------------------------------------------ *
 * Page helpers
 * ------------------------------------------------------------------ */

/** Resolves after `count` animation frames have been rendered. */
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
  if (!scene || !scene.cameras || !scene.cameras.main) return false;
  const p = scene.player;
  return !!(p && p.gameObject && p.body);
};

/**
 * Opens a fresh page on the dev server, waits for the Phaser scene to be usable
 * and returns the page plus captured diagnostics.
 */
async function openGame(t, { viewport = VIEWPORT } = {}) {
  const page = await browser.newPage({ viewport });
  const errors = { console: [], page: [], failed: [], requests: [] };

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
  page.on('request', (req) => {
    errors.requests.push({ url: req.url(), type: req.resourceType() });
  });

  await page.goto(DEV_URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 30000 });
  await page.waitForFunction(BOOT_PREDICATE, null, { timeout: 60000, polling: 100 });
  await frames(page, 3);
  if (t && typeof t.diagnostic === 'function') t.diagnostic(`page opened at ${viewport.width}x${viewport.height}`);
  return { page, errors };
}

/** Runs `fn(page, errors)` with a fresh page and always closes it. */
async function withGame(t, opts, fn) {
  const { page, errors } = await openGame(t, opts);
  try {
    return await fn(page, errors);
  } finally {
    await page.close().catch(() => {});
  }
}

/** Reads a serialisable snapshot of the interesting runtime state. */
function readState(page) {
  return page.evaluate(() => {
    const g = window.game;
    const scene = g.scene.getScene('world');
    const p = scene.player;
    const body = p.body;
    const obj = p.gameObject;
    const cam = scene.cameras.main;
    const radius =
      typeof obj.radius === 'number' ? obj.radius : Math.max(obj.width || 0, obj.height || 0) / 2;
    const mid = cam.midPoint && typeof cam.midPoint.x === 'number' ? cam.midPoint : null;
    return {
      obj: { x: obj.x, y: obj.y, radius, fillColor: obj.fillColor, type: obj.type },
      body: {
        x: body.x,
        y: body.y,
        left: body.left,
        right: body.right,
        top: body.top,
        bottom: body.bottom,
        width: body.width,
        height: body.height,
        vx: body.velocity.x,
        vy: body.velocity.y,
        speed: Math.hypot(body.velocity.x, body.velocity.y),
      },
      cam: {
        scrollX: cam.scrollX,
        scrollY: cam.scrollY,
        width: cam.width,
        height: cam.height,
        zoom: cam.zoom,
        midX: mid ? mid.x : cam.scrollX + cam.width / 2,
        midY: mid ? mid.y : cam.scrollY + cam.height / 2,
      },
      world: {
        width: scene.physics.world.bounds.width,
        height: scene.physics.world.bounds.height,
      },
      loop: {
        targetFps: g.loop.targetFps,
        actualFps: g.loop.actualFps,
        started: g.loop.started,
      },
    };
  });
}

const state = (page) => readState(page);

/** Teleports the player (test setup only) and lets a couple of frames settle. */
async function resetPlayer(page, x, y) {
  await page.evaluate(
    ([px, py]) => {
      const scene = window.game.scene.getScene('world');
      scene.player.body.reset(px, py);
    },
    [x, y],
  );
  await frames(page, 3);
}

/** Point to click that is *not* on the canvas when the page leaves any margin. */
async function offCanvasClickPoint(page) {
  const box = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const candidates = [
    { x: 4, y: 4 },
    { x: 4, y: Math.round(box.h + box.y + 4) },
    { x: Math.round(box.w + box.x + 4), y: 4 },
  ];
  for (const pt of candidates) {
    const insideCanvas =
      pt.x >= box.x && pt.x <= box.x + box.w && pt.y >= box.y && pt.y <= box.y + box.h;
    if (!insideCanvas && pt.x >= 0 && pt.y >= 0 && pt.x < VIEWPORT.width && pt.y < VIEWPORT.height) {
      return { point: pt, fellBackToCanvas: false };
    }
  }
  return { point: { x: 2, y: 2 }, fellBackToCanvas: true };
}

/** R11: the canvas must be focusable and become the active element after a click. */
async function ensureCanvasFocus(page) {
  const focused = await page.evaluate(
    () => !!document.activeElement && document.activeElement.tagName === 'CANVAS',
  );
  if (focused) return true;
  const { point } = await offCanvasClickPoint(page);
  await page.mouse.click(point.x, point.y);
  return page
    .waitForFunction(
      () => !!document.activeElement && document.activeElement.tagName === 'CANVAS',
      null,
      { timeout: 3000, polling: 50 },
    )
    .then(() => true)
    .catch(() => false);
}

/**
 * Holds `keys` for `ms` and returns the player displacement + elapsed time.
 * Position based, so it works for velocity-driven and position-driven movement.
 */
async function measureMove(page, keys, ms, { settleMs = 120 } = {}) {
  for (const key of keys) await page.keyboard.down(key);
  try {
    await page.waitForTimeout(settleMs);
    const sample = await page.evaluate(async (duration) => {
      const scene = window.game.scene.getScene('world');
      const obj = scene.player.gameObject;
      const body = scene.player.body;
      const x0 = obj.x;
      const y0 = obj.y;
      const t0 = performance.now();
      await new Promise((resolve) => setTimeout(resolve, duration));
      const t1 = performance.now();
      return {
        dt: t1 - t0,
        dx: obj.x - x0,
        dy: obj.y - y0,
        vx: body.velocity.x,
        vy: body.velocity.y,
      };
    }, ms);
    const distance = Math.hypot(sample.dx, sample.dy);
    return {
      ...sample,
      distance,
      speedPxPerSec: distance / (sample.dt / 1000),
      velocityMagnitude: Math.hypot(sample.vx, sample.vy),
    };
  } finally {
    for (const key of keys) await page.keyboard.up(key);
  }
}

/** Speed of a single-axis move measured away from any world boundary. */
async function straightSpeed(page, key = 'ArrowRight', ms = 700) {
  await resetPlayer(page, WORLD_SIZE / 2, WORLD_SIZE / 2);
  const move = await measureMove(page, [key], ms);
  return move.speedPxPerSec;
}

/** fetch() that tolerates a preview server which is still binding its port. */
async function fetchWithRetry(url, attempts = 40, delayMs = 150) {
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fetch(url);
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error(`could not reach ${url}: ${lastError && lastError.message}`);
}

/**
 * The browser itself asks for /favicon.ico and logs a 404 console error when the site
 * has no icon. That request is generated by the browser, not by the app, so it is
 * reported separately instead of being asserted away silently.
 */
const isFaviconNoise = (entry) => /favicon\.ico/i.test(entry.url || '');
const appConsoleErrors = (entries) => entries.filter((e) => !isFaviconNoise(e)).map((e) => e.text);

/* ------------------------------------------------------------------ *
 * Production build helpers (R9)
 * ------------------------------------------------------------------ */

let buildResult = null;

/** Runs `npm run build` exactly once and returns the spawn result. */
function ensureBuild(t) {
  if (!buildResult) {
    // Importing/creating the Vite dev server in this process sets NODE_ENV=development,
    // and a child process would inherit it (yielding a dev-flavoured bundle). Force the
    // production value so the build under test is the artifact that gets deployed.
    buildResult = spawnSync('npm', ['run', 'build'], {
      cwd: PROJECT_ROOT,
      shell: true,
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'production' },
    });
  }
  if (t) t.diagnostic(`npm run build (NODE_ENV=production) exit=${buildResult.status}`);
  return buildResult;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/**
 * Minimal static file server that mounts `rootDir` under `prefix` only.
 * Everything outside the prefix 404s, which is exactly what a sub-path deployment
 * looks like (and what R9 asks the build to survive).
 */
function startStaticServer(rootDir, prefix, port) {
  const root = path.resolve(rootDir);
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (!urlPath.startsWith(prefix)) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end(`not mounted here: ${urlPath}`);
      return;
    }
    let rel = urlPath.slice(prefix.length);
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end(`missing: ${urlPath}`);
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server) return resolve();
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    server.close(() => resolve());
  });
}

/**
 * Screenshots just the canvas and counts pixels, so visual requirements can be
 * verified without touching the (dev-only) window.game handle.
 */
async function canvasPixelStats(page) {
  const box = await page.evaluate(() => {
    const r = document.querySelector('canvas').getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const shot = await page.screenshot({
    clip: {
      x: Math.floor(box.x),
      y: Math.floor(box.y),
      width: Math.max(1, Math.floor(box.width)),
      height: Math.max(1, Math.floor(box.height)),
    },
  });
  const sharp = require('sharp');
  const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
  const redMask = new Uint8Array(info.width * info.height);
  let black = 0;
  let white = 0;
  for (let i = 0, p = 0; i < data.length; i += info.channels, p += 1) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r < 40 && g < 40 && b < 40) black += 1;
    else if (r > 230 && g > 230 && b > 230) white += 1;
    else if (r > 150 && g < 80 && b < 80) redMask[p] = 1;
  }

  // connected components of red pixels: the four reference circles (spec R10)
  const w = info.width;
  const h = info.height;
  const seen = new Uint8Array(w * h);
  let redBlobs = 0;
  for (let start = 0; start < redMask.length; start += 1) {
    if (!redMask[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let size = 0;
    while (stack.length) {
      const idx = stack.pop();
      size += 1;
      const x = idx % w;
      const y = (idx - x) / w;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (redMask[n] && !seen[n]) {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
    }
    if (size >= 20) redBlobs += 1;
  }

  const total = info.width * info.height;
  const ci = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
  return {
    width: info.width,
    height: info.height,
    total,
    blackPct: (black / total) * 100,
    whitePct: (white / total) * 100,
    redBlobs,
    center: [data[ci], data[ci + 1], data[ci + 2]],
  };
}

/* ------------------------------------------------------------------ *
 * R1 - toolchain
 * ------------------------------------------------------------------ */

test('R1 toolchain is Vite + phaser ^4.1, plain JS, no backend', { timeout: 60000 }, async (t) => {
  const pkgPath = path.join(PROJECT_ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

  // phaser declared as ^4.x
  assert.ok(deps.phaser, 'package.json must declare a phaser dependency');
  const phaserRange = String(deps.phaser);
  assert.match(phaserRange, /^\^?4\./, `phaser must be declared as ^4.x, got "${phaserRange}"`);

  // phaser actually installed as 4.x
  const phaserPkg = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, 'node_modules/phaser/package.json'), 'utf8'),
  );
  t.diagnostic(`phaser installed version: ${phaserPkg.version}`);
  assert.match(phaserPkg.version, /^4\./, `installed phaser must be 4.x, got ${phaserPkg.version}`);

  // vite present
  assert.ok(deps.vite, 'package.json must declare vite');
  t.diagnostic(`vite declared: ${deps.vite}`);

  // no TypeScript anywhere in the dependency graph / sources
  assert.ok(!deps.typescript, 'TypeScript must not be a dependency');
  const tsFiles = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) tsFiles.push(full);
    }
  };
  walk(path.join(PROJECT_ROOT, 'src'));
  assert.deepEqual(tsFiles, [], 'sources must be plain JS, found: ' + tsFiles.join(', '));

  // no backend / account: everything the page loads comes from the dev server origin,
  // and no app state is persisted (spec: no save games).
  await withGame(t, {}, async (page, errors) => {
    await resetPlayer(page, WORLD_SIZE / 2, WORLD_SIZE / 2);
    await measureMove(page, ['ArrowRight'], 250);

    const foreign = errors.requests.filter((r) => !r.url.startsWith(DEV_URL));
    assert.deepEqual(foreign.map((r) => r.url), [], 'game must not call any backend/third-party host');

    const storage = await page.evaluate(() => ({
      local: Object.keys(window.localStorage).length,
      session: Object.keys(window.sessionStorage).length,
    }));
    assert.deepEqual(storage, { local: 0, session: 0 }, 'no account/save persistence expected');
    t.diagnostic(`requests observed: ${errors.requests.length}, storage keys: 0`);
  });
});

/* ------------------------------------------------------------------ *
 * R2 - canvas / scale
 * ------------------------------------------------------------------ */

test('R2 canvas is 1280x720 with Scale.FIT and keeps 16:9 at 800x600', { timeout: 90000 }, async (t) => {
  await withGame(t, { viewport: { width: 800, height: 600 } }, async (page) => {
    const info = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      const r = c.getBoundingClientRect();
      const parent = c.parentElement.getBoundingClientRect();
      const g = window.game;
      const scene = g.scene.getScene('world');
      return {
        backing: { width: c.width, height: c.height },
        css: { x: r.x, y: r.y, width: r.width, height: r.height },
        parent: { x: parent.x, y: parent.y, width: parent.width, height: parent.height },
        gameSize: { width: g.scale.gameSize.width, height: g.scale.gameSize.height },
        displaySize: { width: g.scale.displaySize.width, height: g.scale.displaySize.height },
        camera: { width: scene.cameras.main.width, height: scene.cameras.main.height },
        world: {
          width: scene.physics.world.bounds.width,
          height: scene.physics.world.bounds.height,
        },
      };
    });

    t.diagnostic(`backing store: ${info.backing.width}x${info.backing.height}`);
    t.diagnostic(
      `css box at 800x600: ${info.css.width.toFixed(2)}x${info.css.height.toFixed(2)} (parent ${info.parent.width.toFixed(2)}x${info.parent.height.toFixed(2)})`,
    );
    t.diagnostic(`camera visible size: ${info.camera.width}x${info.camera.height}`);

    // backing store is the 1280x720 base
    assert.equal(info.backing.width, GAME_W, 'canvas backing width must be 1280');
    assert.equal(info.backing.height, GAME_H, 'canvas backing height must be 720');
    assert.deepEqual(info.gameSize, { width: GAME_W, height: GAME_H });

    // FIT: 16:9 preserved inside a 4:3 viewport, letterboxed, never overflowing
    const aspect = info.css.width / info.css.height;
    const expectedAspect = GAME_W / GAME_H;
    assert.ok(
      Math.abs(aspect - expectedAspect) / expectedAspect < 0.01,
      `canvas CSS aspect must stay 16:9, got ${aspect.toFixed(4)} (expected ${expectedAspect.toFixed(4)})`,
    );
    assert.ok(info.css.width <= 800 + 0.6, `canvas must fit viewport width, got ${info.css.width}`);
    assert.ok(info.css.height <= 600 + 0.6, `canvas must fit viewport height, got ${info.css.height}`);
    assert.ok(
      info.css.x >= info.parent.x - 1 &&
        info.css.y >= info.parent.y - 1 &&
        info.css.x + info.css.width <= info.parent.x + info.parent.width + 1 &&
        info.css.y + info.css.height <= info.parent.y + info.parent.height + 1,
      'canvas must stay inside its container (letterboxing outside the canvas)',
    );
    const fillRatio = Math.max(info.css.width / info.parent.width, info.css.height / info.parent.height);
    assert.ok(fillRatio > 0.95, `FIT must fill the limiting dimension, fill ratio ${fillRatio.toFixed(3)}`);

    // world is fixed and decoupled from the canvas size
    assert.deepEqual(info.world, { width: WORLD_SIZE, height: WORLD_SIZE });
    assert.deepEqual(info.camera, { width: GAME_W, height: GAME_H }, 'visible world area must not change with the window');
  });
});

/* ------------------------------------------------------------------ *
 * R3 - input / movement
 * ------------------------------------------------------------------ */

test('R3 arrows and WASD move immediately, straight moves stay on one axis', { timeout: 90000 }, async (t) => {
  await withGame(t, {}, async (page) => {
    await ensureCanvasFocus(page);

    const cases = [
      { keys: ['ArrowRight'], axis: 'x', sign: 1 },
      { keys: ['ArrowLeft'], axis: 'x', sign: -1 },
      { keys: ['ArrowDown'], axis: 'y', sign: 1 },
      { keys: ['ArrowUp'], axis: 'y', sign: -1 },
      { keys: ['KeyD'], axis: 'x', sign: 1 },
      { keys: ['KeyA'], axis: 'x', sign: -1 },
      { keys: ['KeyS'], axis: 'y', sign: 1 },
      { keys: ['KeyW'], axis: 'y', sign: -1 },
    ];

    for (const c of cases) {
      await resetPlayer(page, WORLD_SIZE / 2, WORLD_SIZE / 2);

      // press -> motion within ~150 ms
      await page.keyboard.down(c.keys[0]);
      let early;
      try {
        await page.waitForTimeout(150);
        early = await state(page);
      } finally {
        await page.keyboard.up(c.keys[0]);
      }
      const earlyDelta =
        c.axis === 'x'
          ? (early.obj.x - WORLD_SIZE / 2) * c.sign
          : (early.obj.y - WORLD_SIZE / 2) * c.sign;
      assert.ok(
        earlyDelta > 0.5,
        `${c.keys[0]}: expected movement within 150 ms, observed ${earlyDelta.toFixed(2)}px`,
      );

      // sustained move changes only the intended axis
      await resetPlayer(page, WORLD_SIZE / 2, WORLD_SIZE / 2);
      const move = await measureMove(page, c.keys, 400);
      const along = c.axis === 'x' ? move.dx * c.sign : move.dy * c.sign;
      const across = c.axis === 'x' ? Math.abs(move.dy) : Math.abs(move.dx);
      t.diagnostic(`${c.keys[0]}: along=${along.toFixed(2)}px across=${across.toFixed(2)}px`);
      assert.ok(along > 5, `${c.keys[0]}: expected >5px along ${c.axis}, got ${along.toFixed(2)}px`);
      assert.ok(across <= 0.5, `${c.keys[0]}: must not drift across axis, drifted ${across.toFixed(2)}px`);
    }
  });
});

test('R3 releasing the keys stops the player without inertia', { timeout: 90000 }, async (t) => {
  await withGame(t, {}, async (page) => {
    await ensureCanvasFocus(page);
    await resetPlayer(page, WORLD_SIZE / 2, WORLD_SIZE / 2);

    await page.keyboard.down('ArrowRight');
    await page.keyboard.down('ArrowDown');
    try {
      await page.waitForTimeout(350);
    } finally {
      await page.keyboard.up('ArrowRight');
      await page.keyboard.up('ArrowDown');
    }

    await page.waitForTimeout(150);
    const atRest = await state(page);
    t.diagnostic(`velocity 150 ms after release: ${atRest.body.speed.toFixed(4)} px/s`);
    assert.ok(
      atRest.body.speed <= 0.01,
      `Arcade velocity must return to 0 within 150 ms, got ${atRest.body.speed.toFixed(3)}`,
    );

    await page.waitForTimeout(300);
    const later = await state(page);
    const drift = Math.hypot(later.obj.x - atRest.obj.x, later.obj.y - atRest.obj.y);
    t.diagnostic(`drift 300 ms after coming to rest: ${drift.toFixed(3)}px`);
    assert.ok(drift <= 1, `player must not drift after release, drifted ${drift.toFixed(2)}px`);
  });
});

test('R3 diagonal speed equals straight speed (vector normalised)', { timeout: 90000 }, async (t) => {
  await withGame(t, {}, async (page) => {
    await ensureCanvasFocus(page);

    await resetPlayer(page, WORLD_SIZE / 2, WORLD_SIZE / 2);
    const straight = await measureMove(page, ['ArrowRight'], 700);

    await resetPlayer(page, WORLD_SIZE / 2, WORLD_SIZE / 2);
    const diagonal = await measureMove(page, ['ArrowRight', 'ArrowDown'], 700);

    t.diagnostic(
      `straight: pos=${straight.speedPxPerSec.toFixed(2)} px/s vel=${straight.velocityMagnitude.toFixed(2)} px/s`,
    );
    t.diagnostic(
      `diagonal: pos=${diagonal.speedPxPerSec.toFixed(2)} px/s vel=${diagonal.velocityMagnitude.toFixed(2)} px/s`,
    );
    assert.ok(straight.speedPxPerSec > 20, 'straight movement must actually move the player');

    const ratio = diagonal.speedPxPerSec / straight.speedPxPerSec;
    assert.ok(
      Math.abs(ratio - 1) <= 0.03,
      `diagonal/straight speed ratio must be 1 +/- 3%, got ${ratio.toFixed(4)} ` +
        `(straight ${straight.speedPxPerSec.toFixed(2)}, diagonal ${diagonal.speedPxPerSec.toFixed(2)} px/s)`,
    );

    if (diagonal.velocityMagnitude > 0) {
      const vRatio = diagonal.velocityMagnitude / straight.velocityMagnitude;
      assert.ok(
        Math.abs(vRatio - 1) <= 0.03,
        `diagonal velocity magnitude must equal straight one, ratio ${vRatio.toFixed(4)}`,
      );
    }
  });
});

/**
 * Measures distance per unit of *game* time (sum of the deltas the scene receives) while
 * a single key is held. Distance per game-time second is what spec R3 calls "位移按
 * delta 时间换算"; it must not change with the frame rate.
 */
function measureGameTime(page, durationMs) {
  return page.evaluate(
    (duration) =>
      new Promise((resolve) => {
        const g = window.game;
        const scene = g.scene.getScene('world');
        const obj = scene.player.gameObject;
        scene.player.body.reset(1000, 1000);
        let gameTime = 0;
        let frames = 0;
        let x0 = null;
        const onUpdate = (time, delta) => {
          if (x0 === null) x0 = obj.x;
          gameTime += delta;
          frames += 1;
        };
        scene.events.on('update', onUpdate);
        setTimeout(() => {
          scene.events.off('update', onUpdate);
          resolve({
            gameTime,
            frames,
            distance: obj.x - x0,
            fps: g.loop.actualFps,
            limit: g.loop.fpsLimit,
          });
        }, duration);
      }),
    durationMs,
  );
}

test('R3 displacement uses delta time (speed per game-time second stable when fps is halved)', { timeout: 90000 }, async (t) => {
  await withGame(t, {}, async (page) => {
    await ensureCanvasFocus(page);

    // Phaser 4: the runtime throttle is TimeStep.setFPSLimit(); 0 removes the limit.
    const applyLimit = (limit) =>
      page.evaluate((l) => {
        const loop = window.game.loop;
        if (typeof loop.setFPSLimit === 'function') loop.setFPSLimit(l);
        else loop.targetFps = l === 0 ? 60 : l;
      }, limit);

    await applyLimit(0);
    await page.waitForTimeout(300);

    await page.keyboard.down('ArrowRight');
    let at60;
    let at30;
    try {
      at60 = await measureGameTime(page, 1200);
      await applyLimit(30);
      await page.waitForTimeout(500);
      at30 = await measureGameTime(page, 1200);
    } finally {
      await page.keyboard.up('ArrowRight');
      await applyLimit(0);
    }

    const speed60 = at60.distance / (at60.gameTime / 1000);
    const speed30 = at30.distance / (at30.gameTime / 1000);
    const ratio = speed30 / speed60;

    t.diagnostic(
      `60 Hz: ${at60.frames} frames / ${at60.gameTime.toFixed(0)} ms game time -> ${speed60.toFixed(1)} px per game-second`,
    );
    t.diagnostic(
      `fpsLimit=${at30.limit} (loop.actualFps=${at30.fps.toFixed(1)}, unreliable under a limit): ${at30.frames} frames / ${at30.gameTime.toFixed(0)} ms game time -> ${speed30.toFixed(1)} px per game-second`,
    );
    t.diagnostic(`ratio=${ratio.toFixed(3)}`);

    assert.ok(at60.gameTime > 800, `sampling window too short at 60 Hz (${at60.gameTime.toFixed(0)} ms)`);
    assert.ok(at30.gameTime > 800, `sampling window too short at 30 Hz (${at30.gameTime.toFixed(0)} ms)`);
    assert.ok(at30.frames < at60.frames, `frame rate must actually drop: ${at60.frames} -> ${at30.frames} frames`);
    assert.ok(
      Math.abs(ratio - 1) <= 0.06,
      `distance per game-time second must not depend on the frame rate, ratio ${ratio.toFixed(3)}`,
    );
  });
});

/* ------------------------------------------------------------------ *
 * R4 - world boundaries
 * ------------------------------------------------------------------ */

test('R4 player stops at the world bounds and cannot leave them', { timeout: 120000 }, async (t) => {
  await withGame(t, {}, async (page) => {
    await ensureCanvasFocus(page);

    const speed = await straightSpeed(page, 'ArrowRight', 500);
    assert.ok(speed > 20, `player speed must be measurable, got ${speed.toFixed(2)} px/s`);
    const holdMs = Math.min(5000, Math.max(900, (120 / speed) * 1000 * 2 + 400));
    t.diagnostic(`measured speed ${speed.toFixed(2)} px/s, hold ${Math.round(holdMs)} ms per leg`);

    const start = WORLD_SIZE - 100;

    // bottom-right corner
    await resetPlayer(page, start, start);
    await measureMove(page, ['ArrowRight', 'ArrowDown'], holdMs);
    const br = await state(page);
    t.diagnostic(
      `bottom-right: center=(${br.obj.x.toFixed(2)}, ${br.obj.y.toFixed(2)}) radius=${br.obj.radius.toFixed(2)} body.right=${br.body.right.toFixed(2)} body.bottom=${br.body.bottom.toFixed(2)}`,
    );
    assert.ok(br.body.right <= WORLD_SIZE + 1, `body.right must not exceed ${WORLD_SIZE}, got ${br.body.right}`);
    assert.ok(br.body.bottom <= WORLD_SIZE + 1, `body.bottom must not exceed ${WORLD_SIZE}, got ${br.body.bottom}`);
    assert.ok(
      br.obj.x + br.obj.radius <= WORLD_SIZE + 1,
      `player must not be half outside the map: center ${br.obj.x} + r ${br.obj.radius}`,
    );
    assert.ok(
      br.obj.x + br.obj.radius >= WORLD_SIZE - 8,
      `player must reach the right edge, gap ${(WORLD_SIZE - br.obj.x - br.obj.radius).toFixed(2)}px`,
    );
    assert.ok(
      br.obj.y + br.obj.radius >= WORLD_SIZE - 8,
      `player must reach the bottom edge, gap ${(WORLD_SIZE - br.obj.y - br.obj.radius).toFixed(2)}px`,
    );

    // holding longer must not push coordinates further
    await measureMove(page, ['ArrowRight', 'ArrowDown'], 700);
    const br2 = await state(page);
    const grown = Math.max(br2.body.right - br.body.right, br2.body.bottom - br.body.bottom);
    t.diagnostic(`extra hold growth: ${grown.toFixed(3)}px`);
    assert.ok(grown <= 0.5, `coordinates must stop growing at the edge, grew ${grown.toFixed(2)}px`);
    assert.ok(br2.body.right <= WORLD_SIZE + 1 && br2.body.bottom <= WORLD_SIZE + 1);

    // top-left corner
    await resetPlayer(page, 100, 100);
    await measureMove(page, ['ArrowLeft', 'ArrowUp'], holdMs);
    const tl = await state(page);
    t.diagnostic(
      `top-left: center=(${tl.obj.x.toFixed(2)}, ${tl.obj.y.toFixed(2)}) body.x=${tl.body.x.toFixed(2)} body.y=${tl.body.y.toFixed(2)}`,
    );
    assert.ok(tl.body.x >= -1, `body.x must not go below 0, got ${tl.body.x}`);
    assert.ok(tl.body.y >= -1, `body.y must not go below 0, got ${tl.body.y}`);
    assert.ok(tl.obj.x - tl.obj.radius >= -1, 'player must not be half outside the map (left)');
    assert.ok(tl.obj.y - tl.obj.radius >= -1, 'player must not be half outside the map (top)');
    assert.ok(tl.obj.x - tl.obj.radius <= 8, `player must reach the left edge, gap ${(tl.obj.x - tl.obj.radius).toFixed(2)}px`);
    assert.ok(tl.obj.y - tl.obj.radius <= 8, `player must reach the top edge, gap ${(tl.obj.y - tl.obj.radius).toFixed(2)}px`);
  });
});

/* ------------------------------------------------------------------ *
 * R5 - camera
 * ------------------------------------------------------------------ */

test('R5 camera follows the player 1:1 without zoom while away from edges', { timeout: 90000 }, async (t) => {
  await withGame(t, {}, async (page) => {
    await ensureCanvasFocus(page);
    await resetPlayer(page, WORLD_SIZE / 2, WORLD_SIZE / 2);

    const before = await state(page);
    await measureMove(page, ['ArrowRight'], 450);
    await measureMove(page, ['ArrowDown'], 450);
    const after = await state(page);

    const dScrollX = after.cam.scrollX - before.cam.scrollX;
    const dScrollY = after.cam.scrollY - before.cam.scrollY;
    const dPlayerX = after.obj.x - before.obj.x;
    const dPlayerY = after.obj.y - before.obj.y;

    t.diagnostic(
      `player delta=(${dPlayerX.toFixed(2)}, ${dPlayerY.toFixed(2)}) scroll delta=(${dScrollX.toFixed(2)}, ${dScrollY.toFixed(2)}) zoom=${after.cam.zoom}`,
    );
    assert.equal(after.cam.zoom, 1, 'camera must not zoom');
    assert.ok(Math.abs(dScrollX - dPlayerX) <= 1.5, `camera scrollX must track the player 1:1 (dx ${dScrollX - dPlayerX})`);
    assert.ok(Math.abs(dScrollY - dPlayerY) <= 1.5, `camera scrollY must track the player 1:1 (dy ${dScrollY - dPlayerY})`);

    // player stays at the visual centre of the viewport
    const screenX = after.obj.x - after.cam.scrollX;
    const screenY = after.obj.y - after.cam.scrollY;
    t.diagnostic(`player screen position: (${screenX.toFixed(2)}, ${screenY.toFixed(2)}) in ${after.cam.width}x${after.cam.height}`);
    assert.ok(Math.abs(screenX - after.cam.width / 2) <= 2, `player must stay at viewport centre X, off by ${(screenX - after.cam.width / 2).toFixed(2)}px`);
    assert.ok(Math.abs(screenY - after.cam.height / 2) <= 2, `player must stay at viewport centre Y, off by ${(screenY - after.cam.height / 2).toFixed(2)}px`);
    assert.ok(Math.abs(after.cam.midX - after.obj.x) <= 2 && Math.abs(after.cam.midY - after.obj.y) <= 2, 'camera midpoint must sit on the player');
  });
});

test('R5 camera clamps at the map edges and never shows outside the world', { timeout: 120000 }, async (t) => {
  await withGame(t, {}, async (page) => {
    await ensureCanvasFocus(page);

    const speed = await straightSpeed(page, 'ArrowRight', 500);
    const holdMs = Math.min(5000, Math.max(900, (120 / speed) * 1000 * 2 + 400));

    await resetPlayer(page, 100, 100);
    await measureMove(page, ['ArrowLeft', 'ArrowUp'], holdMs);
    const tl = await state(page);
    t.diagnostic(`top-left clamp: scroll=(${tl.cam.scrollX.toFixed(2)}, ${tl.cam.scrollY.toFixed(2)})`);
    assert.ok(Math.abs(tl.cam.scrollX) <= 0.5, `camera scrollX must clamp to 0 at the left edge, got ${tl.cam.scrollX}`);
    assert.ok(Math.abs(tl.cam.scrollY) <= 0.5, `camera scrollY must clamp to 0 at the top edge, got ${tl.cam.scrollY}`);

    await resetPlayer(page, WORLD_SIZE - 100, WORLD_SIZE - 100);
    await measureMove(page, ['ArrowRight', 'ArrowDown'], holdMs);
    const br = await state(page);
    const maxScrollX = WORLD_SIZE - br.cam.width;
    const maxScrollY = WORLD_SIZE - br.cam.height;
    t.diagnostic(
      `bottom-right clamp: scroll=(${br.cam.scrollX.toFixed(2)}, ${br.cam.scrollY.toFixed(2)}) expected=(${maxScrollX}, ${maxScrollY})`,
    );
    assert.ok(Math.abs(br.cam.scrollX - maxScrollX) <= 0.5, `camera scrollX must clamp to ${maxScrollX}, got ${br.cam.scrollX}`);
    assert.ok(Math.abs(br.cam.scrollY - maxScrollY) <= 0.5, `camera scrollY must clamp to ${maxScrollY}, got ${br.cam.scrollY}`);

    // the visible rectangle stays inside the world -> no empty area on screen
    const view = {
      left: br.cam.scrollX,
      top: br.cam.scrollY,
      right: br.cam.scrollX + br.cam.width,
      bottom: br.cam.scrollY + br.cam.height,
    };
    assert.ok(view.left >= -0.5 && view.top >= -0.5, 'view must not start outside the world');
    assert.ok(view.right <= WORLD_SIZE + 0.5 && view.bottom <= WORLD_SIZE + 0.5, 'view must not extend past the world');
  });
});

/* ------------------------------------------------------------------ *
 * R6 - visuals and clean load
 * ------------------------------------------------------------------ */

test('R6 black circle on white, no resource/ PNG, no console or page errors', { timeout: 90000 }, async (t) => {
  await withGame(t, {}, async (page, errors) => {
    await ensureCanvasFocus(page);

    const visuals = await page.evaluate(() => {
      const scene = window.game.scene.getScene('world');
      const cam = scene.cameras.main;
      const bg = cam.backgroundColor;
      const bgColor = bg == null ? null : typeof bg === 'number' ? bg : bg.color;
      const kids = scene.children.list.map((o) => ({
        type: o.type,
        fillColor: o.fillColor,
        width: o.width,
        height: o.height,
        x: o.x,
        y: o.y,
      }));
      return {
        bgColor,
        kids,
        player: {
          type: scene.player.gameObject.type,
          fillColor: scene.player.gameObject.fillColor,
          radius: scene.player.gameObject.radius,
        },
        textureKeys: Object.keys(scene.textures.list),
      };
    });

    t.diagnostic(`camera background: ${visuals.bgColor === null ? 'null' : '0x' + visuals.bgColor.toString(16)}`);
    t.diagnostic(`player: type=${visuals.player.type} fill=${'0x' + Number(visuals.player.fillColor).toString(16)} radius=${visuals.player.radius}`);
    t.diagnostic(`texture keys: ${visuals.textureKeys.join(', ')}`);

    // white backdrop: camera background or a white world-sized rectangle
    const whiteRect = visuals.kids.find(
      (k) => k.fillColor === 0xffffff && k.width >= WORLD_SIZE - 1 && k.height >= WORLD_SIZE - 1,
    );
    assert.ok(
      visuals.bgColor === 0xffffff || !!whiteRect,
      'scene must render on a white backdrop (camera background or world-sized white rectangle)',
    );

    // player is engine-generated geometry, filled black
    assert.equal(visuals.player.fillColor, 0x000000, 'player circle must be filled black (0x000000)');
    assert.ok(visuals.player.radius > 0, 'player circle must have a radius');
    assert.notEqual(visuals.player.type, 'Image', 'player must be engine geometry, not a loaded image');

    // no PNG (or any bitmap) loaded from resource/ or elsewhere
    const bitmapTextures = visuals.textureKeys.filter((k) => /\.(png|jpe?g|webp|gif|svg)$/i.test(k));
    assert.deepEqual(bitmapTextures, [], 'no bitmap textures may be loaded at runtime');
    const resourceRequests = errors.requests.filter((r) => /\/resource\//i.test(r.url) || /\.(png|jpe?g|webp|gif)$/i.test(r.url));
    assert.deepEqual(resourceRequests.map((r) => r.url), [], 'nothing from resource/ may be requested');
    const mediaRequests = errors.requests.filter((r) => ['image', 'font', 'media'].includes(r.type));
    assert.deepEqual(
      mediaRequests.map((r) => `${r.type} ${r.url}`),
      [],
      'page load must not fetch images/fonts/media at all (spec R6)',
    );

    // ... and the rendered pixels really are a black circle on white.
    await resetPlayer(page, WORLD_SIZE / 2, WORLD_SIZE / 2);
    await frames(page, 3);
    const px = await canvasPixelStats(page);
    t.diagnostic(
      `pixels ${px.width}x${px.height}: white=${px.whitePct.toFixed(2)}% black=${px.blackPct.toFixed(3)}% redBlobs=${px.redBlobs} centre=rgb(${px.center.join(',')})`,
    );
    assert.ok(
      px.whitePct > 90,
      `backdrop must be white (spec R6), only ${px.whitePct.toFixed(2)}% white pixels`,
    );
    assert.ok(
      px.center.every((v) => v < 20),
      `player at the viewport centre must be black, got rgb(${px.center.join(',')})`,
    );
    assert.ok(
      px.blackPct > 0.02 && px.blackPct < 5,
      `black player circle must cover a small part of the canvas, got ${px.blackPct.toFixed(3)}%`,
    );
    assert.equal(
      px.redBlobs,
      4,
      `the four red reference circles must be rendered in the initial view, found ${px.redBlobs} red blobs`,
    );

    // load + movement stays clean
    await resetPlayer(page, WORLD_SIZE / 2, WORLD_SIZE / 2);
    await measureMove(page, ['ArrowRight', 'ArrowDown'], 400);
    await frames(page, 5);

    t.diagnostic(
      `console errors: ${errors.console.length} (app: ${appConsoleErrors(errors.console).length}), page errors: ${errors.page.length}, failed requests: ${errors.failed.length}`,
    );
    t.diagnostic(
      `app console errors: ${appConsoleErrors(errors.console).join(' | ') || 'none'}`,
    );
    const faviconNoise = errors.console.filter(isFaviconNoise);
    if (faviconNoise.length) {
      t.diagnostic(
        `note: browser-generated 404 for /favicon.ico (no icon shipped) logged ${faviconNoise.length} console error(s)`,
      );
    }
    assert.deepEqual(errors.page, [], 'no uncaught page errors are allowed');
    assert.deepEqual(appConsoleErrors(errors.console), [], 'no app console errors are allowed');
    assert.deepEqual(errors.failed, [], 'no failed network requests are allowed');
  });
});

/* ------------------------------------------------------------------ *
 * R7 - player module boundary
 * ------------------------------------------------------------------ */

function listJsFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listJsFiles(full, out);
    else if (/\.m?js$/.test(entry.name)) out.push(full);
  }
  return out;
}

test('R7 player lives in its own module that owns the body and the input', { timeout: 60000 }, async (t) => {
  const rel = (p) => path.relative(PROJECT_ROOT, p).replace(/\\/g, '/');
  const srcFiles = listJsFiles(path.join(PROJECT_ROOT, 'src')).map(rel);
  t.diagnostic(`src modules: ${srcFiles.join(', ')}`);
  assert.ok(srcFiles.length >= 2, 'src must contain at least the entry and a player module');

  // entry module is whatever index.html loads
  const html = fs.readFileSync(path.join(PROJECT_ROOT, 'index.html'), 'utf8');
  const entrySrc = html.match(/<script[^>]+src="([^"]+)"/);
  assert.ok(entrySrc, 'index.html must load a module script');
  const entry = entrySrc[1].replace(/^\.?\//, '').replace(/\\/g, '/');
  t.diagnostic(`entry module: ${entry}`);

  const INPUT = /createCursorKeys|addKeys\s*\(|\.addKey\s*\(|Keyboard\.JustDown|KeyCodes\./;
  const BLACK_FILL = /0x000000/;
  const MOVE_KEYS = /Arrow(Up|Down|Left|Right)|Key(W|A|S|D)/;
  const sources = new Map(srcFiles.map((f) => [f, fs.readFileSync(path.join(PROJECT_ROOT, f), 'utf8')]));

  const inputFiles = srcFiles.filter((f) => INPUT.test(sources.get(f)));
  const blackFiles = srcFiles.filter((f) => BLACK_FILL.test(sources.get(f)));
  t.diagnostic(`modules registering keyboard input: ${inputFiles.join(', ') || 'none'}`);
  t.diagnostic(`modules declaring a black fill: ${blackFiles.join(', ') || 'none'}`);

  // input handling + the black circle body belong to exactly one dedicated module
  assert.deepEqual(inputFiles.length, 1, `exactly one module may register keyboard input, got: ${inputFiles.join(', ')}`);
  const playerModule = inputFiles[0];
  assert.deepEqual(
    blackFiles,
    [playerModule],
    `the player module must own the black circle definition, black fills found in: ${blackFiles.join(', ')}`,
  );
  assert.notEqual(playerModule, entry, 'the player must be its own module, not the entry module');

  // world / camera / input plumbing must not know the player's keys or colour,
  // i.e. replacing the player internals does not touch them (spec R7)
  const leaks = [];
  for (const f of srcFiles) {
    if (f === playerModule) continue;
    const code = sources.get(f);
    if (MOVE_KEYS.test(code)) leaks.push(`${f}: movement keys`);
    if (BLACK_FILL.test(code)) leaks.push(`${f}: black fill`);
  }
  assert.deepEqual(leaks, [], `other modules must not own player input/visuals: ${leaks.join(', ')}`);

  // the module is actually imported somewhere else (otherwise it is dead code)
  const stem = path.basename(playerModule).replace(/\.m?js$/, '');
  const importers = srcFiles.filter(
    (f) => f !== playerModule && new RegExp(`(from\\s+['"][^'"]*${stem}(\\.m?js)?['"]|require\\(['"][^'"]*${stem}(\\.m?js)?['"]\\))`).test(sources.get(f)),
  );
  t.diagnostic(`player module imported by: ${importers.join(', ') || 'nobody'}`);
  assert.ok(importers.length >= 1, `${playerModule} must be imported by the scene/entry`);

  // runtime surface: position + per-frame update are reachable from the scene
  await withGame(t, {}, async (page) => {
    const surface = await page.evaluate(() => {
      const p = window.game.scene.getScene('world').player;
      return {
        update: typeof p.update,
        position:
          typeof (p.gameObject && p.gameObject.x) === 'number' && typeof (p.body && p.body.x) === 'number',
        members: Object.keys(p).sort(),
      };
    });
    t.diagnostic(`player surface: update=${surface.update} position=${surface.position} members=${surface.members.join(',')}`);
    assert.equal(surface.update, 'function', 'the scene must drive the player through a per-frame update()');
    assert.ok(surface.position, 'the player must expose its position to the world/camera');
  });
});

/* ------------------------------------------------------------------ *
 * R8 - frame loop
 * ------------------------------------------------------------------ */

test('R8 engine loop targets 60 fps and actual fps is not degraded', { timeout: 90000 }, async (t) => {
  await withGame(t, {}, async (page, errors) => {
    await ensureCanvasFocus(page);
    await resetPlayer(page, WORLD_SIZE / 2, WORLD_SIZE / 2);
    await measureMove(page, ['ArrowRight'], 1000);
    await page.waitForTimeout(1200);

    const loop = await page.evaluate(() => ({
      targetFps: window.game.loop.targetFps,
      actualFps: window.game.loop.actualFps,
      started: window.game.loop.started,
    }));
    t.diagnostic(`loop.targetFps=${loop.targetFps} loop.actualFps=${loop.actualFps.toFixed(2)} started=${loop.started}`);

    assert.equal(loop.started, true, 'engine loop must be running');
    assert.equal(loop.targetFps, 60, `target fps must be 60, got ${loop.targetFps}`);
    assert.ok(
      loop.actualFps >= MIN_FPS,
      `actual fps must stay >= ${MIN_FPS} (60 fps target), observed ${loop.actualFps.toFixed(2)}`,
    );
    assert.deepEqual(errors.page, [], 'no page errors while the loop runs');
  });
});

test('R8 no long frames: a 10 s sample stays free of perceivable stutter', { timeout: 120000 }, async (t) => {
  await withGame(t, {}, async (page, errors) => {
    await ensureCanvasFocus(page);
    await resetPlayer(page, WORLD_SIZE / 2, WORLD_SIZE / 2);
    await frames(page, 30); // warm-up frames are not part of the sample

    // spec R8 "移动逻辑每帧不创建新对象": the display list must not grow while moving
    const childCount = () =>
      page.evaluate(() => window.game.scene.getScene('world').children.list.length);
    const childrenBefore = await childCount();

    await page.keyboard.down('ArrowRight');
    let sample;
    try {
      sample = await page.evaluate(
        (duration) =>
          new Promise((resolve) => {
            const stamps = [];
            const t0 = performance.now();
            const step = (ts) => {
              stamps.push(ts);
              if (ts - t0 < duration) {
                requestAnimationFrame(step);
                return;
              }
              const deltas = [];
              for (let i = 1; i < stamps.length; i += 1) deltas.push(stamps[i] - stamps[i - 1]);
              const sorted = [...deltas].sort((a, b) => a - b);
              resolve({
                frames: stamps.length,
                windowMs: ts - t0,
                max: sorted[sorted.length - 1],
                p95: sorted[Math.floor(sorted.length * 0.95)],
                p99: sorted[Math.floor(sorted.length * 0.99)],
                over50: deltas.filter((d) => d > 50).length,
                over100: deltas.filter((d) => d > 100).length,
              });
            };
            requestAnimationFrame(step);
          }),
        STUTTER_SAMPLE_MS,
      );
    } finally {
      await page.keyboard.up('ArrowRight');
    }

    t.diagnostic(
      `frames=${sample.frames} over ${sample.windowMs.toFixed(0)} ms: max=${sample.max.toFixed(1)} ms, ` +
        `p95=${sample.p95.toFixed(1)} ms, p99=${sample.p99.toFixed(1)} ms, ` +
        `>50 ms=${sample.over50}, >${LONG_FRAME_MS} ms=${sample.over100}`,
    );
    t.diagnostic(
      `thresholds: no frame > ${LONG_FRAME_MS} ms, at most ${MAX_STUTTER_FRAMES} frames > 50 ms, p95 <= 50 ms, >= 300 frames`,
    );

    assert.ok(sample.frames >= 300, `loop must keep rendering during the sample, only ${sample.frames} frames`);
    assert.equal(
      sample.over100,
      0,
      `${sample.over100} frame(s) took longer than ${LONG_FRAME_MS} ms (max ${sample.max.toFixed(1)} ms) - perceivable stutter`,
    );
    assert.ok(
      sample.over50 <= MAX_STUTTER_FRAMES,
      `${sample.over50} frames exceeded 50 ms, more than the tolerated ${MAX_STUTTER_FRAMES}`,
    );
    assert.ok(sample.p95 <= 50, `95th percentile frame time must stay <= 50 ms, got ${sample.p95.toFixed(1)} ms`);

    const childrenAfter = await childCount();
    t.diagnostic(`scene display list: ${childrenBefore} -> ${childrenAfter} objects`);
    assert.equal(
      childrenAfter,
      childrenBefore,
      'the per-frame update must not create new display objects',
    );

    assert.deepEqual(errors.page, [], 'no page errors during the sampling window');
  });
});

/* ------------------------------------------------------------------ *
 * R10 - four static red reference circles
 * ------------------------------------------------------------------ */

test('R10 exactly four red reference circles, fixed and static', { timeout: 90000 }, async (t) => {
  await withGame(t, {}, async (page) => {
    await ensureCanvasFocus(page);

    const readReds = () =>
      page.evaluate(() => {
        const scene = window.game.scene.getScene('world');
        return scene.children.list
          .filter((o) => o.fillColor === 0xff0000)
          .map((o) => ({
            type: o.type,
            x: o.x,
            y: o.y,
            radius: o.radius,
            hasBody: !!o.body,
            vx: o.body ? o.body.velocity.x : null,
            vy: o.body ? o.body.velocity.y : null,
          }));
      });

    const before = await readReds();
    t.diagnostic(
      `red circles: ${before.map((r) => `${r.type}(${r.x.toFixed(1)},${r.y.toFixed(1)}) r=${r.radius}`).join(' ')}`,
    );
    assert.equal(before.length, 4, `expected exactly 4 red circles (0xff0000), found ${before.length}`);

    for (const red of before) {
      assert.ok(red.radius > 0, 'red reference circle must have a radius');
      assert.ok(red.x >= 0 && red.x <= WORLD_SIZE, `red circle must be inside the world, x=${red.x}`);
      assert.ok(red.y >= 0 && red.y <= WORLD_SIZE, `red circle must be inside the world, y=${red.y}`);
    }

    // distinct positions
    for (let i = 0; i < before.length; i += 1) {
      for (let j = i + 1; j < before.length; j += 1) {
        const d = Math.hypot(before[i].x - before[j].x, before[i].y - before[j].y);
        assert.ok(d > 1, `red circles ${i} and ${j} must be at distinct positions, distance ${d.toFixed(2)}`);
      }
    }

    // static while the player moves
    await resetPlayer(page, WORLD_SIZE / 2, WORLD_SIZE / 2);
    await measureMove(page, ['ArrowRight', 'ArrowDown'], 600);
    await frames(page, 5);
    const after = await readReds();

    assert.equal(after.length, 4, 'red circles must still be 4 after movement');
    for (let i = 0; i < 4; i += 1) {
      const drift = Math.hypot(after[i].x - before[i].x, after[i].y - before[i].y);
      assert.ok(drift <= 0.01, `red circle ${i} must not move, drifted ${drift.toFixed(4)}px`);
      if (before[i].hasBody) {
        assert.ok(
          Math.abs(after[i].vx) < 0.01 && Math.abs(after[i].vy) < 0.01,
          `red circle ${i} must not have velocity`,
        );
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * R11 - focus handling
 * ------------------------------------------------------------------ */

/** Focus helpers shared by the two R11 tests. */
async function activeTag(page) {
  return page.evaluate(() => (document.activeElement && document.activeElement.tagName) || 'NONE');
}

async function blurCanvas(page) {
  return page.evaluate(() => {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    return document.activeElement && document.activeElement.tagName;
  });
}

async function waitForCanvasFocus(page, timeout = 3000) {
  return page
    .waitForFunction(() => !!document.activeElement && document.activeElement.tagName === 'CANVAS', null, {
      timeout,
      polling: 50,
    })
    .then(() => true)
    .catch(() => false);
}

test('R11 canvas has focus after load and a click on the canvas restores it', { timeout: 90000 }, async (t) => {
  await withGame(t, {}, async (page) => {
    const activeAfterLoad = await activeTag(page);
    t.diagnostic(`activeElement after load: ${activeAfterLoad}`);
    assert.equal(activeAfterLoad, 'CANVAS', 'canvas must have focus right after load');

    const blurred = await blurCanvas(page);
    t.diagnostic(`activeElement after blur(): ${blurred}`);
    assert.notEqual(blurred, 'CANVAS', 'blur() must really drop canvas focus (test precondition)');

    const box = await page.evaluate(() => {
      const r = document.querySelector('canvas').getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2);

    const refocused = await waitForCanvasFocus(page);
    t.diagnostic(`refocused by clicking the canvas: ${refocused}`);
    assert.ok(refocused, 'clicking the canvas must give the focus back to it');

    // ... and real key presses work afterwards
    await resetPlayer(page, WORLD_SIZE / 2, WORLD_SIZE / 2);
    const move = await measureMove(page, ['ArrowRight'], 400);
    t.diagnostic(`movement after refocus: dx=${move.dx.toFixed(2)}px dy=${move.dy.toFixed(2)}px`);
    assert.ok(move.dx > 5, `keyboard input must still move the player after refocus, dx=${move.dx.toFixed(2)}`);
  });
});

test('R11 clicking the page body (outside the canvas) restores canvas focus', { timeout: 90000 }, async (t) => {
  await withGame(t, {}, async (page) => {
    const blurred = await blurCanvas(page);
    t.diagnostic(`activeElement after blur(): ${blurred}`);
    assert.notEqual(blurred, 'CANVAS', 'blur() must really drop canvas focus (test precondition)');

    // spec R11: keyboard input must not stop working just because focus was lost
    await resetPlayer(page, WORLD_SIZE / 2, WORLD_SIZE / 2);
    const afterBlur = await measureMove(page, ['ArrowRight'], 400);
    t.diagnostic(`movement while blurred (activeElement=${blurred}): dx=${afterBlur.dx.toFixed(2)}px`);
    assert.ok(
      afterBlur.dx > 5,
      `keyboard input must keep working after losing focus, dx=${afterBlur.dx.toFixed(2)}`,
    );

    const { point, fellBackToCanvas } = await offCanvasClickPoint(page);
    t.diagnostic(`body click point: (${point.x}, ${point.y}); canvas covers it: ${fellBackToCanvas}`);
    await page.mouse.click(point.x, point.y);

    const refocused = await waitForCanvasFocus(page);
    const nowActive = await activeTag(page);
    t.diagnostic(`activeElement after body click: ${nowActive}`);

    // The functional part of R11: keyboard input must survive a focus loss.
    const focusBefore = nowActive;
    await resetPlayer(page, WORLD_SIZE / 2, WORLD_SIZE / 2);
    const move = await measureMove(page, ['ArrowRight'], 400);
    t.diagnostic(
      `movement after body click (activeElement=${focusBefore}): dx=${move.dx.toFixed(2)}px`,
    );
    assert.ok(move.dx > 5, `keyboard input must still work after a focus loss, dx=${move.dx.toFixed(2)}`);
    assert.ok(
      refocused,
      `spec R11 asks for "点击页面可重新聚焦"; after clicking the page body the canvas is not the active element (got ${nowActive})`,
    );
  });
});

/* ------------------------------------------------------------------ *
 * R9 - production build / preview
 * ------------------------------------------------------------------ */

test('R9 production build serves index and bundle over HTTP 200 from the root', { timeout: 180000 }, async (t) => {
  // Fresh production build through the package script (shared with the sub-path test).
  const build = ensureBuild(t);
  assert.equal(build.status, 0, `npm run build must succeed\n${build.stdout}\n${build.stderr}`);

  const distIndex = path.join(PROJECT_ROOT, 'dist', 'index.html');
  assert.ok(fs.existsSync(distIndex), 'dist/index.html must exist after the build');
  const distHtml = fs.readFileSync(distIndex, 'utf8');
  const assetMatch = distHtml.match(/<script[^>]+src="([^"]+)"/);
  assert.ok(assetMatch, 'dist/index.html must reference a script bundle');
  t.diagnostic(`bundle reference in dist/index.html: ${assetMatch[1]}`);

  const { preview } = await import('vite');
  const previewServer = await preview({
    root: PROJECT_ROOT,
    logLevel: 'error',
    preview: { port: PREVIEW_PORT, host: '127.0.0.1', strictPort: true },
  });

  try {
    const indexRes = await fetchWithRetry(PREVIEW_URL);
    t.diagnostic(`GET / -> ${indexRes.status}`);
    assert.equal(indexRes.status, 200, 'preview must serve index.html with 200');
    const html = await indexRes.text();
    const servedAsset = html.match(/<script[^>]+src="([^"]+)"/);
    assert.ok(servedAsset, 'served index must reference a script bundle');

    const assetUrl = new URL(servedAsset[1], PREVIEW_URL).toString();
    const assetRes = await fetch(assetUrl);
    t.diagnostic(`GET ${servedAsset[1]} -> ${assetRes.status} (${assetRes.headers.get('content-type')})`);
    assert.equal(assetRes.status, 200, `referenced bundle ${servedAsset[1]} must return 200`);
    const contentType = assetRes.headers.get('content-type') || '';
    assert.match(contentType, /javascript|ecmascript/i, `bundle content-type looks wrong: ${contentType}`);
    const bundle = await assetRes.text();
    t.diagnostic(`bundle size: ${(bundle.length / 1024 / 1024).toFixed(2)} MiB`);
    assert.ok(bundle.length > 1024, 'bundle must not be empty');

    // the built page really boots in a browser (no dev-only window.game available)
    const page = await browser.newPage({ viewport: VIEWPORT });
    const consoleErrors = [];
    const pageErrors = [];
    const badResponses = [];
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const location = typeof m.location === 'function' ? m.location() : {};
      consoleErrors.push({ text: m.text(), url: (location && location.url) || '' });
    });
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('response', (r) => {
      if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`);
    });
    try {
      await page.goto(PREVIEW_URL, { waitUntil: 'load', timeout: 60000 });
      await page.waitForSelector('canvas', { timeout: 30000 });
      await page.waitForTimeout(600);
      const canvas = await page.evaluate(() => {
        const c = document.querySelector('canvas');
        return { width: c.width, height: c.height };
      });
      t.diagnostic(`preview canvas backing store: ${canvas.width}x${canvas.height}`);
      t.diagnostic(`preview 4xx/5xx responses: ${badResponses.length ? badResponses.join(', ') : 'none'}`);
      assert.deepEqual(canvas, { width: GAME_W, height: GAME_H }, 'production build must boot the same canvas');
      const rootPx = await canvasPixelStats(page);
      t.diagnostic(
        `preview pixels: white=${rootPx.whitePct.toFixed(2)}% black=${rootPx.blackPct.toFixed(3)}%`,
      );
      assert.ok(rootPx.whitePct > 90, `production build must render the white map, got ${rootPx.whitePct.toFixed(2)}%`);
      assert.ok(rootPx.blackPct > 0.02, `production build must render the black player, got ${rootPx.blackPct.toFixed(3)}%`);
      assert.deepEqual(pageErrors, [], 'production page must not throw');
      // Browser-initiated /favicon.ico 404s are reported, not asserted: no icon ships with the build.
      const appErrors = appConsoleErrors(consoleErrors);
      if (appErrors.length !== consoleErrors.length) {
        t.diagnostic(
          `note: browser-generated 404 console noise: ${consoleErrors.filter(isFaviconNoise).map((e) => e.url).join(', ')}`,
        );
      }
      assert.deepEqual(appErrors, [], 'production page must not log console errors');
      assert.deepEqual(
        badResponses.filter((r) => !/favicon/i.test(r)),
        [],
        'production page must not request missing assets',
      );
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    if (typeof previewServer.close === 'function') await previewServer.close().catch(() => {});
    else
      await new Promise((resolve) => {
        try {
          previewServer.httpServer.close(resolve);
        } catch {
          resolve();
        }
      });
  }
});

/**
 * R9 sub-path deployment: the same dist/ mounted under /game/ must boot, and every
 * asset it references must come back 200. This is the case the spec calls out
 * ("部署子路径导致资源 404 的情况要处理") - a root-only preview cannot prove it.
 */
test('R9 dist served from a /game/ sub-path boots with 200 assets', { timeout: 180000 }, async (t) => {
  const build = ensureBuild(t);
  assert.equal(build.status, 0, `npm run build must succeed\n${build.stdout}\n${build.stderr}`);

  const distDir = path.join(PROJECT_ROOT, 'dist');
  assert.ok(fs.existsSync(path.join(distDir, 'index.html')), 'dist/index.html must exist');

  const server = await startStaticServer(distDir, SUBPATH_PREFIX, SUBPATH_PORT);
  const page = await browser.newPage({ viewport: VIEWPORT });
  const consoleErrors = [];
  const pageErrors = [];
  const responses = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const loc = typeof m.location === 'function' ? m.location() : {};
    consoleErrors.push({ text: m.text(), url: (loc && loc.url) || '' });
  });
  page.on('pageerror', (e) => pageErrors.push(String((e && e.stack) || e)));
  page.on('response', (r) => {
    responses.push({ status: r.status(), url: r.url(), type: r.request().resourceType() });
  });

  try {
    await page.goto(SUBPATH_URL, { waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector('canvas', { timeout: 30000 });
    await page.waitForTimeout(1200);

    const assetResponses = responses.filter((r) => r.type === 'script' || r.type === 'stylesheet');
    t.diagnostic(`asset responses: ${assetResponses.map((r) => `${r.status} ${r.url}`).join(' | ') || 'none'}`);
    assert.ok(assetResponses.length >= 1, 'the sub-path page must load at least its JS bundle');
    for (const res of assetResponses) {
      assert.equal(res.status, 200, `asset ${res.url} must return 200 when served under ${SUBPATH_PREFIX}`);
      assert.ok(
        new URL(res.url).pathname.startsWith(SUBPATH_PREFIX),
        `asset ${res.url} must be requested under ${SUBPATH_PREFIX} (relative base), not from the site root`,
      );
    }

    const missing = responses.filter((r) => r.status >= 400 && !/favicon/i.test(r.url));
    t.diagnostic(`non-2xx responses: ${missing.map((r) => `${r.status} ${r.url}`).join(', ') || 'none'}`);
    assert.deepEqual(missing.map((r) => `${r.status} ${r.url}`), [], 'sub-path deployment must not 404 any asset');

    const canvas = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      return c ? { width: c.width, height: c.height } : null;
    });
    t.diagnostic(`sub-path canvas: ${canvas ? `${canvas.width}x${canvas.height}` : 'missing'}`);
    assert.deepEqual(canvas, { width: GAME_W, height: GAME_H }, 'the game must boot under /game/');

    // world + player must be readable, either through the runtime handle (when the
    // build exposes one) or through the rendered pixels.
    const runtime = await page.evaluate(() => {
      const g = window.game;
      if (!g || !g.scene) return null;
      const scene = g.scene.getScene('world');
      if (!scene || !scene.physics || !scene.player) return null;
      const p = scene.player;
      return {
        world: { width: scene.physics.world.bounds.width, height: scene.physics.world.bounds.height },
        player: {
          x: p.gameObject.x,
          y: p.gameObject.y,
          fillColor: p.gameObject.fillColor,
          radius: p.gameObject.radius,
        },
        reds: scene.children.list.filter((o) => o.fillColor === 0xff0000).length,
      };
    });
    t.diagnostic(`sub-path runtime: ${runtime ? JSON.stringify(runtime) : 'no window.game (production build)'}`);
    if (runtime) {
      assert.deepEqual(runtime.world, { width: WORLD_SIZE, height: WORLD_SIZE }, 'world must stay 2000x2000');
      assert.equal(runtime.player.fillColor, 0x000000, 'player must be a black circle');
      assert.ok(runtime.player.radius > 0, 'player circle must have a radius');
      assert.equal(runtime.reds, 4, 'the four red reference circles must exist in the built game');
    }

    const px = await canvasPixelStats(page);
    t.diagnostic(
      `sub-path pixels: white=${px.whitePct.toFixed(2)}% black=${px.blackPct.toFixed(3)}% redBlobs=${px.redBlobs}`,
    );
    assert.ok(px.whitePct > 90, `built game must render the white map, got ${px.whitePct.toFixed(2)}% white`);
    assert.ok(px.blackPct > 0.02, `built game must render the black player, got ${px.blackPct.toFixed(3)}% black`);
    assert.equal(
      px.redBlobs,
      4,
      `built game must render the four red reference circles, found ${px.redBlobs} red blobs`,
    );

    assert.deepEqual(pageErrors, [], 'sub-path page must not throw');
    const appErrors = appConsoleErrors(consoleErrors);
    if (appErrors.length !== consoleErrors.length) {
      t.diagnostic(
        `note: browser-generated 404 console noise: ${consoleErrors.filter(isFaviconNoise).map((e) => e.url).join(', ')}`,
      );
    }
    assert.deepEqual(appErrors, [], 'sub-path page must not log app console errors');
  } finally {
    await page.close().catch(() => {});
    await closeServer(server);
  }
});
