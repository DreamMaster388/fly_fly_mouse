'use strict';

/**
 * Independent acceptance suite for feat/weapon-orbit-around-player.
 *
 * Every expectation below is derived from
 * docs/sdlc/feat/weapon-orbit-around-player/spec.md (R1-R8). The spec's "证明方式"
 * hints are only used as a starting point; boundary conditions are filled in by
 * this suite (count != 7/9, neighbour spacing, radius while moving/stopped, flipX
 * before/after, speed per game time at a low frame rate, body tracking).
 *
 * Black box only: a real Edge instance (playwright-core) drives the app served by a
 * programmatically started Vite dev server. Runtime state is read through the
 * dev-only `window.game` handle, the display list (texture key `dart`) and the
 * network responses of the page.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const DEV_PORT = Number(process.env.ORBIT_DEV_PORT || 5196);
const DIST_PORT = Number(process.env.ORBIT_DIST_PORT || 5197);
const DEV_URL = `http://127.0.0.1:${DEV_PORT}/`;

const DART_PNG = path.join(PROJECT_ROOT, 'resource', 'weapon', '武器-飞镖-透明.png');

/* ---- values straight from the spec ---- */
const DART_COUNT = 8; // R2
const SPACING_DEG = 45; // R2 (360 / 8)
const ORBIT_RADIUS = 90; // R2
const DART_HEIGHT = 27; // R2
const ORBIT_DEG_PER_SEC = 90; // R3 (4 s per turn)
const SPIN_DEG_PER_SEC = 360; // R4 (1 s per turn)
const TOP_ANGLE = -90; // R2 "初始状态一支位于正上方" in screen coords (y down)

/* ---- tolerances: sampling + frame scheduling slack, not spec values ---- */
const RADIUS_TOLERANCE = 1; // px
const HEIGHT_TOLERANCE = 0.5; // px
const ANGLE_TOLERANCE = 1.5; // deg (~2.4 px at r=90)
const CENTER_TOLERANCE = 1; // px
const SPEED_TOLERANCE = 0.05; // +/-5 %
const INITIAL_PHASE_TOLERANCE = 10; // deg, first observable formation frame
const ASPECT_TOLERANCE = 0.005; // 0.5 % of the display aspect ratio

const DEG = 180 / Math.PI;
const VIEWPORT = { width: 1280, height: 720 };

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

async function openGame(t, { viewport = VIEWPORT, initScript = null } = {}) {
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
      type: res.request().resourceType(),
      contentType: headers['content-type'] || '',
      contentLength: headers['content-length'] || null,
    });
  });

  await page.goto(DEV_URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 30000 });
  await page.waitForFunction(BOOT_PREDICATE, null, { timeout: 60000, polling: 100 });
  await frames(page, 3);
  if (t && typeof t.diagnostic === 'function') t.diagnostic(`page opened at ${viewport.width}x${viewport.height}`);
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

/** One serialisable snapshot of player + darts, read in the page. */
const READ_SRC = `(() => {
  const g = window.game;
  const scene = g.scene.getScene('world');
  const list = scene.children.list;
  const p = scene.player.gameObject;
  const darts = list.filter((o) => o.texture && o.texture.key === 'dart');
  return {
    t: performance.now(),
    player: {
      x: p.x,
      y: p.y,
      flipX: !!p.flipX,
      depth: p.depth,
      listIndex: list.indexOf(p),
      displayWidth: p.displayWidth,
      displayHeight: p.displayHeight,
      bodyCenterY: p.body ? p.body.center.y : null,
      vx: p.body ? p.body.velocity.x : null,
      vy: p.body ? p.body.velocity.y : null,
    },
    darts: darts.map((d) => {
      const b = d.body || null;
      const f = d.frame || null;
      return {
        x: d.x,
        y: d.y,
        rotation: d.rotation,
        displayWidth: d.displayWidth,
        displayHeight: d.displayHeight,
        scaleX: d.scaleX,
        scaleY: d.scaleY,
        flipX: !!d.flipX,
        flipY: !!d.flipY,
        depth: d.depth,
        listIndex: list.indexOf(d),
        originX: d.originX,
        originY: d.originY,
        visible: d.visible,
        alpha: d.alpha,
        frameWidth: f ? f.realWidth : null,
        frameHeight: f ? f.realHeight : null,
        body: b
          ? {
              x: b.x,
              y: b.y,
              centerX: b.center.x,
              centerY: b.center.y,
              width: b.width,
              height: b.height,
              halfWidth: b.halfWidth,
              halfHeight: b.halfHeight,
              radius: b.radius,
              isCircle: !!b.isCircle,
              enable: b.enable !== false,
              moves: b.moves,
              allowGravity: !!b.allowGravity,
              vx: b.velocity.x,
              vy: b.velocity.y,
              ax: b.acceleration.x,
              ay: b.acceleration.y,
            }
          : null,
      };
    }),
  };
})()`;

const snapshot = (page) => page.evaluate(READ_SRC);

/** Reads `n` snapshots `interval` ms apart inside the page. */
function sample(page, n = 10, interval = 150) {
  return page.evaluate(
    ({ src, n: count, interval: step }) =>
      new Promise((resolve) => {
        const read = () => eval(src);
        const out = [read()];
        const timer = setInterval(() => {
          out.push(read());
          if (out.length >= count) {
            clearInterval(timer);
            resolve(out);
          }
        }, step);
      }),
    { src: READ_SRC, n, interval },
  );
}

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

async function focusCanvas(page) {
  const box = await page.evaluate(() => {
    const r = document.querySelector('canvas').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2);
  await frames(page, 2);
}

/* ------------------------------------------------------------------ *
 * Maths helpers (screen coords, y down: increasing angle == clockwise)
 * ------------------------------------------------------------------ */

const NORMALISE_360 = (a) => ((a % 360) + 360) % 360;

function relativeAngles(snap) {
  return snap.darts.map((d) => Math.atan2(d.y - snap.player.y, d.x - snap.player.x) * DEG);
}

function radii(snap) {
  return snap.darts.map((d) => Math.hypot(d.x - snap.player.x, d.y - snap.player.y));
}

function centerOffset(snap) {
  const n = snap.darts.length;
  const mx = snap.darts.reduce((a, d) => a + d.x, 0) / n;
  const my = snap.darts.reduce((a, d) => a + d.y, 0) / n;
  return { dx: mx - snap.player.x, dy: my - snap.player.y };
}

/** Neighbour gaps of a set of angles, sorted ascending; sums to 360. */
function gaps(angles) {
  const sorted = angles.map(NORMALISE_360).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const next = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + 360;
    out.push(next - sorted[i]);
  }
  return out;
}

/** Unwraps a degree series that crosses +/-180 or wraps at 360. */
function unwrapSeries(series) {
  const out = [series[0]];
  for (let i = 1; i < series.length; i += 1) {
    let step = series[i] - series[i - 1];
    while (step > 180) step -= 360;
    while (step <= -180) step += 360;
    out.push(out[i - 1] + step);
  }
  return out;
}

function seriesSpeed(series, timesMs) {
  const unwrapped = unwrapSeries(series);
  const seconds = (timesMs[timesMs.length - 1] - timesMs[0]) / 1000;
  return (unwrapped[unwrapped.length - 1] - unwrapped[0]) / seconds;
}

function orbitSpeeds(samples) {
  const times = samples.map((s) => s.t);
  const count = samples[0].darts.length;
  return Array.from({ length: count }, (_, k) =>
    seriesSpeed(samples.map((s) => relativeAngles(s)[k]), times),
  );
}

function spinSpeeds(samples) {
  const times = samples.map((s) => s.t);
  const count = samples[0].darts.length;
  return Array.from({ length: count }, (_, k) =>
    seriesSpeed(samples.map((s) => s.darts[k].rotation * DEG), times),
  );
}

/** Speed of (own rotation - orbit angle): 0 if the dart locks to the radius, 90 if it locks to the tangent. */
function relativeOrientSpeeds(samples) {
  const times = samples.map((s) => s.t);
  const count = samples[0].darts.length;
  return Array.from({ length: count }, (_, k) =>
    seriesSpeed(
      samples.map((s) => s.darts[k].rotation * DEG - relativeAngles(s)[k]),
      times,
    ),
  );
}

function angleFromTop(snap) {
  const diffs = relativeAngles(snap).map((a) => {
    let d = a - TOP_ANGLE;
    while (d > 180) d -= 360;
    while (d <= -180) d += 360;
    return Math.abs(d);
  });
  return Math.min(...diffs);
}

const within = (actual, expected, tolerance) => Math.abs(actual - expected) <= tolerance;

function assertSpeeds(t, label, speeds, expected, tolerance) {
  t.diagnostic(`${label}: ${speeds.map((s) => s.toFixed(1)).join(' / ')} deg/s`);
  for (let k = 0; k < speeds.length; k += 1) {
    assert.ok(
      within(speeds[k], expected, expected * tolerance),
      `${label}: dart #${k} must be ${expected} deg/s +/-${tolerance * 100}%, got ${speeds[k].toFixed(2)}`,
    );
  }
}

/** Copies the shared invariants (count, radius, spacing) of one snapshot. */
function assertFormation(t, label, snap, { radiusTolerance = RADIUS_TOLERANCE } = {}) {
  assert.equal(
    snap.darts.length,
    DART_COUNT,
    `${label}: expected exactly ${DART_COUNT} darts, found ${snap.darts.length}`,
  );
  const rs = radii(snap);
  const gs = gaps(relativeAngles(snap));
  t.diagnostic(
    `${label}: radii ${rs.map((r) => r.toFixed(2)).join('/')} | gaps ${gs.map((g) => g.toFixed(1)).join('/')} | offset ${JSON.stringify(centerOffset(snap))}`,
  );
  for (const r of rs) {
    assert.ok(
      within(r, ORBIT_RADIUS, radiusTolerance),
      `${label}: every dart must sit ${ORBIT_RADIUS}px from the player centre, got ${r.toFixed(2)}`,
    );
  }
  for (const g of gs) {
    assert.ok(
      within(g, SPACING_DEG, ANGLE_TOLERANCE),
      `${label}: neighbour darts must be ${SPACING_DEG} deg apart, got ${g.toFixed(2)}`,
    );
  }
  const off = centerOffset(snap);
  assert.ok(
    Math.abs(off.dx) <= CENTER_TOLERANCE && Math.abs(off.dy) <= CENTER_TOLERANCE,
    `${label}: formation must be centred on the player display centre, offset (${off.dx.toFixed(2)}, ${off.dy.toFixed(2)})`,
  );
}

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

/** Worst-case deviations of one snapshot from the rigid formation described by R2/R5. */
function formationStats(snap) {
  const rs = radii(snap);
  const gs = gaps(relativeAngles(snap));
  const off = centerOffset(snap);
  return {
    rs,
    gs,
    off,
    maxRadiusErr: Math.max(...rs.map((r) => Math.abs(r - ORBIT_RADIUS))),
    maxGapErr: Math.max(...gs.map((g) => Math.abs(g - SPACING_DEG))),
    centerOffset: Math.hypot(off.dx, off.dy),
  };
}

/* ------------------------------------------------------------------ *
 * Early frame recorder: the very first frames after the darts exist,
 * used to judge the spec's "初始状态一支位于正上方".
 * ------------------------------------------------------------------ */

const INIT_RECORDER = () => {
  window.__dartFrames = [];
  const record = () => {
    try {
      const g = window.game;
      const scene = g && g.scene && g.scene.getScene('world');
      if (scene && scene.children && scene.player && scene.player.gameObject) {
        const list = scene.children.list;
        const p = scene.player.gameObject;
        const darts = list.filter((o) => o.texture && o.texture.key === 'dart');
        if (darts.length) {
          window.__dartFrames.push({
            t: performance.now(),
            px: p.x,
            py: p.y,
            darts: darts.map((d) => ({
              x: d.x,
              y: d.y,
              rotation: d.rotation,
              displayWidth: d.displayWidth,
              displayHeight: d.displayHeight,
              scaleX: d.scaleX,
              scaleY: d.scaleY,
              frameWidth: d.frame ? d.frame.realWidth : null,
              frameHeight: d.frame ? d.frame.realHeight : null,
            })),
          });
        }
      }
    } catch (err) {
      window.__dartFrames.push({ error: String(err) });
    }
    if (window.__dartFrames.length < 40) requestAnimationFrame(record);
  };
  requestAnimationFrame(record);
};

/* ------------------------------------------------------------------ *
 * R1 - Vite asset import, single dart texture
 * ------------------------------------------------------------------ */

test('R1 darts use the Vite-imported resource/weapon/武器-飞镖-透明.png and nothing else', { timeout: 90000 }, async (t) => {
  const dartFile = fs.readFileSync(DART_PNG);
  const dartHash = sha1(dartFile);
  const fileWidth = dartFile.readUInt32BE(16);
  const fileHeight = dartFile.readUInt32BE(20);

  await withGame(t, {}, async (page, errors) => {
    const info = await page.evaluate(() => {
      const scene = window.game.scene.getScene('world');
      const darts = scene.children.list.filter((o) => o.texture && o.texture.key === 'dart');
      const tex = scene.textures.list['dart'] || null;
      const src = tex && tex.source && tex.source[0] ? tex.source[0] : null;
      return {
        textureKeys: Object.keys(scene.textures.list),
        exists: typeof scene.textures.exists === 'function' ? scene.textures.exists('dart') : !!tex,
        source: src ? { width: src.width, height: src.height } : null,
        sources: tex && tex.source ? tex.source.length : 0,
        dartTextureKeys: Array.from(new Set(darts.map((d) => d.texture.key))),
        dartFrames: darts.map((d) => (d.frame ? { w: d.frame.realWidth, h: d.frame.realHeight } : null)),
      };
    });

    t.diagnostic(`textures: ${info.textureKeys.join(', ')}`);
    t.diagnostic(`dart texture source: ${JSON.stringify(info.source)} (file ${fileWidth}x${fileHeight}), sources=${info.sources}`);
    t.diagnostic(`dart texture keys in use: ${info.dartTextureKeys.join(', ')}`);

    assert.ok(info.exists, "the scene must load a texture keyed 'dart'");
    assert.deepEqual(info.dartTextureKeys, ['dart'], 'every dart must share that single texture');
    assert.ok(info.source, 'the dart texture must have an image source');
    assert.equal(info.source.width, fileWidth, 'dart texture width must equal the resource PNG width');
    assert.equal(info.source.height, fileHeight, 'dart texture height must equal the resource PNG height');
    assert.equal(info.sources, 1, 'the dart texture must come from a single image source');
    for (const frame of info.dartFrames) {
      assert.deepEqual(
        { w: frame.w, h: frame.h },
        { w: fileWidth, h: fileHeight },
        'the dart frame must be the full resource image',
      );
    }

    // the browser really fetched that PNG (Vite asset URL import), and byte-for-byte.
    // Phaser loads images through XHR/fetch, so the request type is not necessarily
    // "image"; the served content type is the reliable signal.
    const imageResponses = errors.responses.filter((r) => {
      const url = decodeURIComponent(r.url.split('?')[0]);
      return /\/resource\/weapon\//.test(url) && /\.png$/i.test(url) && /image\/png/i.test(r.contentType);
    });
    t.diagnostic(
      `resource asset responses: ${imageResponses.map((r) => `${r.status} ${decodeURIComponent(r.url)}`).join(' | ') || 'none'}`,
    );
    assert.ok(imageResponses.length >= 1, 'the page must request the dart PNG from resource/weapon/');
    const decoded = decodeURIComponent(imageResponses[0].url.split('?')[0]);
    assert.ok(decoded.includes('武器-飞镖-透明.png'), `dart texture must come from 武器-飞镖-透明.png, got ${decoded}`);
    assert.equal(imageResponses[0].status, 200, 'the dart PNG must be served with 200');
    assert.match(imageResponses[0].contentType, /image\/png/i, `unexpected content type: ${imageResponses[0].contentType}`);

    const served = Buffer.from(await (await fetch(imageResponses[0].url)).arrayBuffer());
    t.diagnostic(`served dart bytes: ${served.length} (file ${dartFile.length}) sha1 ${sha1(served)}`);
    assert.equal(sha1(served), dartHash, 'the served dart asset must be exactly resource/weapon/武器-飞镖-透明.png');

    // ... and no other PNG was fetched as a texture
    const otherImages = errors.responses.filter((r) => {
      const url = decodeURIComponent(r.url.split('?')[0]);
      return /\.png$/i.test(url) && /image\/png/i.test(r.contentType) && !/\/resource\/weapon\//.test(url) && !/^blob:/i.test(url);
    });
    t.diagnostic(`other PNG requests: ${otherImages.map((r) => decodeURIComponent(r.url)).join(', ') || 'none'}`);
  });
});

/* ------------------------------------------------------------------ *
 * R2 - count / spacing / initial top / radius / size
 * ------------------------------------------------------------------ */

test('R2 eight darts 45° apart, one at the top, r=90 about the player centre, 27px tall and undistorted', { timeout: 120000 }, async (t) => {
  await withGame(t, { initScript: INIT_RECORDER }, async (page) => {
    const early = await page.evaluate(() => window.__dartFrames || []);
    t.diagnostic(`early frames recorded: ${early.length}`);
    assert.ok(early.length > 0, 'the early frame recorder captured nothing (window.game unavailable?)');

    const formed = early.find(
      (f) =>
        f.darts &&
        f.darts.length === DART_COUNT &&
        f.darts.every((d) => within(Math.hypot(d.x - f.px, d.y - f.py), ORBIT_RADIUS, 8)),
    );
    assert.ok(formed, 'no early frame showed the 8 darts already on the 90px orbit');
    t.diagnostic(`first formed frame after ${(formed.t - (early[0].t || formed.t)).toFixed(0)} ms of recording`);

    const snap = { player: { x: formed.px, y: formed.py }, darts: formed.darts };
    assertFormation(t, 'initial', snap, { radiusTolerance: 1 });

    const top = angleFromTop(snap);
    const angles = relativeAngles(snap);
    t.diagnostic(
      `initial angles: ${angles.map((a) => a.toFixed(1)).join('/')} | nearest to top ${top.toFixed(2)} deg`,
    );
    assert.ok(
      top <= INITIAL_PHASE_TOLERANCE,
      `at the first observable frame one dart must sit at the top (-90 deg), nearest is ${top.toFixed(2)} deg off`,
    );

    for (const d of formed.darts) {
      t.diagnostic(`initial dart: display ${d.displayWidth.toFixed(3)}x${d.displayHeight.toFixed(3)} scale ${d.scaleX}/${d.scaleY}`);
      assert.ok(
        within(d.displayHeight, DART_HEIGHT, HEIGHT_TOLERANCE),
        `every dart must be ${DART_HEIGHT}px tall, got ${d.displayHeight.toFixed(3)}`,
      );
      const frameAspect = d.frameWidth / d.frameHeight;
      const displayAspect = d.displayWidth / d.displayHeight;
      assert.ok(
        Math.abs(displayAspect / frameAspect - 1) <= ASPECT_TOLERANCE,
        `dart must keep its aspect ratio (frame ${frameAspect.toFixed(4)} vs display ${displayAspect.toFixed(4)})`,
      );
      assert.ok(
        within(d.scaleX, d.scaleY, Math.abs(d.scaleX) * 0.005),
        `dart must not be distorted: scaleX ${d.scaleX} vs scaleY ${d.scaleY}`,
      );
    }

    // the orbit centre is the player's texture display centre, not the physics body centre
    const pBody = await page.evaluate(() => {
      const p = window.game.scene.getScene('world').player;
      return { bodyCenterY: p.body.center.y, y: p.gameObject.y, displayHeight: p.gameObject.displayHeight };
    });
    t.diagnostic(
      `player display centre y=${pBody.y.toFixed(2)}, body centre y=${pBody.bodyCenterY.toFixed(2)} (${(pBody.bodyCenterY - pBody.y).toFixed(2)}px apart)`,
    );
    assert.ok(
      Math.abs(pBody.bodyCenterY - pBody.y) > 5,
      'test precondition: the player body centre differs from the display centre',
    );

    // the formation survives into the steady state
    const now = await snapshot(page);
    assertFormation(t, 'steady', now);
  });
});

/* ------------------------------------------------------------------ *
 * R3 - orbit speed, clockwise, per scene time, independent of frame rate
 * ------------------------------------------------------------------ */

test('R3 orbit is 90°/s clockwise and unchanged at a 30 fps limit', { timeout: 150000 }, async (t) => {
  await withGame(t, {}, async (page) => {
    await focusCanvas(page);
    await resetPlayer(page, 1000, 1000);

    const at60 = await sample(page, 10, 150);
    t.diagnostic(
      `60 Hz window: ${(at60[10 - 1].t - at60[0].t).toFixed(0)} ms, ${at60[0].darts.length} darts`,
    );
    assertSpeeds(t, 'orbit @ unlimited fps', orbitSpeeds(at60), ORBIT_DEG_PER_SEC, SPEED_TOLERANCE);
    for (const s of at60) assertFormation(t, 'orbit@60', s);

    const limit = await page.evaluate(() => {
      const loop = window.game.loop;
      if (typeof loop.setFPSLimit === 'function') loop.setFPSLimit(30);
      else loop.targetFps = 30;
      return { actualFps: loop.actualFps, fpsLimit: loop.fpsLimit, targetFps: loop.targetFps };
    });
    await page.waitForTimeout(500);
    t.diagnostic(`fps limited: ${JSON.stringify(limit)}`);

    const at30 = await sample(page, 10, 150);
    await page.evaluate(() => {
      const loop = window.game.loop;
      if (typeof loop.setFPSLimit === 'function') loop.setFPSLimit(0);
      else loop.targetFps = 60;
    });

    const s60 = orbitSpeeds(at60);
    const s30 = orbitSpeeds(at30);
    t.diagnostic(
      `60 Hz frames ${at60.length}, 30 Hz frames over ${(at30[10 - 1].t - at30[0].t).toFixed(0)} ms`,
    );
    assertSpeeds(t, 'orbit @ 30 fps limit', s30, ORBIT_DEG_PER_SEC, SPEED_TOLERANCE);

    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const ratio = mean(s30) / mean(s60);
    t.diagnostic(`30fps/unlimited orbit speed ratio: ${ratio.toFixed(4)}`);
    assert.ok(
      Math.abs(ratio - 1) <= 0.06,
      `orbit speed must not depend on the frame rate, ratio ${ratio.toFixed(3)}`,
    );
  });
});

/* ------------------------------------------------------------------ *
 * R4 - self rotation, clockwise, independent of the orbit
 * ------------------------------------------------------------------ */

test('R4 each dart spins 360°/s clockwise around its own centre, independent of the orbit', { timeout: 120000 }, async (t) => {
  await withGame(t, {}, async (page) => {
    await focusCanvas(page);
    await resetPlayer(page, 1000, 1000);

    const samples = await sample(page, 12, 100);
    const spin = spinSpeeds(samples);
    assertSpeeds(t, 'self rotation', spin, SPIN_DEG_PER_SEC, SPEED_TOLERANCE);

    const orbit = orbitSpeeds(samples);
    assertSpeeds(t, 'orbit during spin test', orbit, ORBIT_DEG_PER_SEC, SPEED_TOLERANCE);

    // orientation relative to the radius: 360 - 90 = 270 deg/s. 0 would mean "radial",
    // 90 would mean "tangential" - i.e. the dart would not spin on its own.
    const rel = relativeOrientSpeeds(samples);
    assertSpeeds(t, 'orientation relative to radius', rel, SPIN_DEG_PER_SEC - ORBIT_DEG_PER_SEC, SPEED_TOLERANCE * 2);

    // spin around the dart's own centre: the position on the orbit must not drift
    // because of the rotation (origin stays in the middle of the sprite)
    for (const s of samples) {
      for (const d of s.darts) {
        assert.ok(
          within(d.originX, 0.5, 0.01) && within(d.originY, 0.5, 0.01),
          `dart must rotate around its own centre, origin (${d.originX}, ${d.originY})`,
        );
      }
      assertFormation(t, 'spin', s);
    }
  });
});

/* ------------------------------------------------------------------ *
 * R5 - rigid follow, no easing, static relative layout when stopped
 * ------------------------------------------------------------------ */

test('R5a formation follows the moving player rigidly, without easing or a frame of lag', { timeout: 150000 }, async (t) => {
  await withGame(t, {}, async (page) => {
    await focusCanvas(page);
    await resetPlayer(page, 1000, 1000);

    const idle = await snapshot(page);
    assertFormation(t, 'idle', idle);

    await page.keyboard.down('ArrowRight');
    let moving;
    try {
      moving = await sample(page, 9, 130);
    } finally {
      await page.keyboard.up('ArrowRight');
    }
    const travelled = Math.hypot(
      moving[moving.length - 1].player.x - moving[0].player.x,
      moving[moving.length - 1].player.y - moving[0].player.y,
    );
    t.diagnostic(`player travelled ${travelled.toFixed(1)}px during the follow sample`);
    assert.ok(travelled > 100, `test precondition: the player must actually move (travelled ${travelled.toFixed(1)}px)`);

    // Rigid follow, checked on every sampled frame while the player moves: any easing
    // or a single frame of delay shows up as an offset of the formation centre.
    const speed = Math.max(...moving.map((s) => Math.hypot(s.player.vx || 0, s.player.vy || 0)));
    const perFrame = speed / 60;
    let worstCenter = 0;
    let worstRadius = 0;
    let worstGap = 0;
    let worstOffset = null;
    for (const s of moving) {
      const st = formationStats(s);
      if (st.centerOffset > worstCenter) {
        worstCenter = st.centerOffset;
        worstOffset = st.off;
      }
      worstRadius = Math.max(worstRadius, st.maxRadiusErr);
      worstGap = Math.max(worstGap, st.maxGapErr);
    }
    t.diagnostic(
      `while moving at ${speed.toFixed(0)}px/s (${perFrame.toFixed(1)}px per 60Hz frame): ` +
        `worst centre offset ${worstCenter.toFixed(2)}px (${JSON.stringify(worstOffset)}), ` +
        `worst radius error ${worstRadius.toFixed(2)}px, worst gap error ${worstGap.toFixed(2)}deg`,
    );
    assert.ok(
      worstCenter <= CENTER_TOLERANCE,
      `the formation must be centred on the player's current display centre every frame, worst offset ${worstCenter.toFixed(2)}px while moving ${speed.toFixed(0)}px/s (one 60Hz frame = ${perFrame.toFixed(1)}px)`,
    );
    assert.ok(
      worstRadius <= RADIUS_TOLERANCE,
      `every dart must stay ${ORBIT_RADIUS}px from the player while it moves, worst error ${worstRadius.toFixed(2)}px`,
    );
    assert.ok(
      worstGap <= ANGLE_TOLERANCE,
      `neighbour darts must stay ${SPACING_DEG} deg apart while moving, worst error ${worstGap.toFixed(2)}deg`,
    );
  });
});

test('R5b the formation stays rigid relative to the player once it stops', { timeout: 150000 }, async (t) => {
  await withGame(t, {}, async (page) => {
    await focusCanvas(page);
    await resetPlayer(page, 1000, 1000);

    // move first (crossing the moving -> stopped transition), then let it settle
    await page.keyboard.down('ArrowRight');
    try {
      await page.waitForTimeout(500);
    } finally {
      await page.keyboard.up('ArrowRight');
    }
    await page.waitForTimeout(400);

    const stoppedA = await snapshot(page);
    await page.waitForTimeout(400);
    const stoppedB = await snapshot(page);

    const drift = Math.hypot(stoppedB.player.x - stoppedA.player.x, stoppedB.player.y - stoppedA.player.y);
    t.diagnostic(`player drift while stopped: ${drift.toFixed(3)}px`);
    assert.ok(drift <= 1, `the player must be at rest, drifted ${drift.toFixed(2)}px`);
    assert.ok(
      Math.abs(stoppedB.player.vx) <= 0.01 && Math.abs(stoppedB.player.vy) <= 0.01,
      `player velocity must be 0 when stopped, got (${stoppedB.player.vx}, ${stoppedB.player.vy})`,
    );

    assertFormation(t, 'stopped A', stoppedA);
    assertFormation(t, 'stopped B', stoppedB);

    // radius must survive the movement / stop transitions
    for (const r of radii(stoppedB)) {
      assert.ok(
        within(r, ORBIT_RADIUS, RADIUS_TOLERANCE),
        `radius must stay ${ORBIT_RADIUS}px after stopping, got ${r.toFixed(2)}`,
      );
    }

    // and the orbit keeps turning while the player is stopped (the formation is not frozen)
    const speeds = orbitSpeeds([stoppedA, stoppedB]);
    assertSpeeds(t, 'orbit while the player is stopped', speeds, ORBIT_DEG_PER_SEC, SPEED_TOLERANCE);
  });
});

/* ------------------------------------------------------------------ *
 * R6 - player flipX does not propagate to the darts
 * ------------------------------------------------------------------ */

test('R6 flipping the player does not flip or re-orient the darts', { timeout: 120000 }, async (t) => {
  await withGame(t, {}, async (page) => {
    await focusCanvas(page);
    await resetPlayer(page, 1000, 1000);

    const before = await snapshot(page);
    assertFormation(t, 'before flip', before);

    await page.keyboard.down('ArrowRight');
    let during;
    try {
      await page.waitForTimeout(120);
      const flipped = await page.evaluate(
        () => !!window.game.scene.getScene('world').player.gameObject.flipX,
      );
      t.diagnostic(`player.flipX after pressing Right: ${flipped}`);
      assert.ok(flipped, 'test precondition: moving right must mirror the player');
      during = await sample(page, 8, 100);
    } finally {
      await page.keyboard.up('ArrowRight');
    }

    for (const s of during) {
      for (let k = 0; k < s.darts.length; k += 1) {
        const d = s.darts[k];
        assert.equal(d.flipX, false, `dart #${k} must not be flipped when the player is mirrored`);
        assert.equal(d.flipY, false, `dart #${k} must not be flipped vertically`);
        assert.ok(d.scaleX > 0, `dart #${k} must not be mirrored through a negative scaleX (${d.scaleX})`);
        assert.ok(d.scaleY > 0, `dart #${k} must not be mirrored through a negative scaleY (${d.scaleY})`);
      }
      // the orbit keeps going clockwise while mirrored (a leaked mirror would reverse it)
    }
    assertSpeeds(t, 'orbit across flip', orbitSpeeds(during), ORBIT_DEG_PER_SEC, SPEED_TOLERANCE * 1.6);

    // orientation keeps going at the same rate: no 180 deg jump at the flip frame
    const spin = spinSpeeds(during);
    const times = during.map((s) => s.t);
    assertSpeeds(t, 'spin across flip', spin, SPIN_DEG_PER_SEC, SPEED_TOLERANCE * 1.6);
    for (let k = 0; k < during[0].darts.length; k += 1) {
      const series = during.map((s) => s.darts[k].rotation * DEG);
      for (let i = 1; i < series.length; i += 1) {
        let step = series[i] - series[i - 1];
        while (step > 180) step -= 360;
        while (step <= -180) step += 360;
        const expected = (SPIN_DEG_PER_SEC * (times[i] - times[i - 1])) / 1000;
        assert.ok(
          Math.abs(step - expected) <= 25,
          `dart #${k} rotation jumped ${step.toFixed(1)} deg where ~${expected.toFixed(1)} deg was expected (mirroring leaked into the dart?)`,
        );
      }
    }

    // turning left mirrors the player back; the darts stay unflipped
    await page.keyboard.down('ArrowLeft');
    try {
      await page.waitForTimeout(150);
    } finally {
      await page.keyboard.up('ArrowLeft');
    }
    await page.waitForTimeout(350);
    const after = await snapshot(page);
    const playerFlip = await page.evaluate(() => !!window.game.scene.getScene('world').player.gameObject.flipX);
    t.diagnostic(`player.flipX after pressing Left: ${playerFlip}`);
    assert.equal(playerFlip, false, 'test precondition: moving left un-mirrors the player');
    for (const d of after.darts) {
      assert.equal(d.flipX, false, 'darts must stay unflipped after the player flips back');
      assert.ok(d.scaleX > 0 && d.scaleY > 0, 'darts must not be mirrored');
    }
    assertFormation(t, 'after flip back', after);
  });
});

/* ------------------------------------------------------------------ *
 * R7 - circular physics body, size from display height, inert
 * ------------------------------------------------------------------ */

test('R7 each dart has a circular, gravity-free, inert body sized from its 27px height', { timeout: 120000 }, async (t) => {
  await withGame(t, {}, async (page) => {
    await focusCanvas(page);
    await resetPlayer(page, 1000, 1000);

    const world = await page.evaluate(() => {
      const scene = window.game.scene.getScene('world');
      const w = scene.physics.world;
      const colliders = w.colliders;
      let list = [];
      if (colliders) {
        if (typeof colliders.getActive === 'function') list = colliders.getActive();
        else if (Array.isArray(colliders._active)) list = colliders._active;
        else if (Array.isArray(colliders.list)) list = colliders.list;
      }
      const darts = scene.children.list.filter((o) => o.texture && o.texture.key === 'dart');
      const dartBodies = new Set(darts.map((d) => d.body).filter(Boolean));
      const involvesDart = (obj) => {
        if (!obj) return false;
        if (obj.body && dartBodies.has(obj.body)) return true;
        if (obj.object1 && involvesDart(obj.object1)) return true;
        if (obj.object2 && involvesDart(obj.object2)) return true;
        if (Array.isArray(obj.children)) return obj.children.some(involvesDart);
        if (obj.children && typeof obj.children.values === 'function') {
          return [...obj.children.values()].some(involvesDart);
        }
        return false;
      };
      return {
        gravity: { x: w.gravity.x, y: w.gravity.y },
        colliders: list.map((c) => ({
          type: c && c.name !== undefined ? String(c.name) : 'collider',
          involvesDart: involvesDart(c && c.object1) || involvesDart(c && c.object2),
        })),
        dartCount: darts.length,
        bodies: darts.filter((d) => d.body).length,
      };
    });

    t.diagnostic(
      `world gravity ${JSON.stringify(world.gravity)}, colliders ${JSON.stringify(world.colliders)}, darts ${world.dartCount}/${world.bodies} with bodies`,
    );
    assert.equal(world.bodies, DART_COUNT, 'every dart must have a physics body');
    assert.equal(
      world.colliders.filter((c) => c.involvesDart).length,
      0,
      'no collider may be registered for a dart (no collision callback)',
    );

    const samples = await sample(page, 8, 120);
    const gravityOff = world.gravity.x === 0 && world.gravity.y === 0;

    for (let k = 0; k < DART_COUNT; k += 1) {
      const first = samples[0].darts[k];
      const body = first.body;
      assert.ok(body, `dart #${k} must have a physics body`);
      assert.ok(body.enable, `dart #${k} body must be enabled`);
      assert.equal(body.isCircle, true, `dart #${k} body must be circular`);
      assert.ok(body.radius > 0, `dart #${k} body must have a radius`);
      // `radius` is in unscaled source pixels; the world-space radius is halfWidth.
      const worldRadius = body.halfWidth;
      assert.ok(
        worldRadius > 0 && worldRadius <= DART_HEIGHT / 2 + 0.01,
        `dart #${k} body radius must stay within half of the ${DART_HEIGHT}px display height, got ${worldRadius}px (source radius ${body.radius})`,
      );
      assert.ok(
        within(body.width, worldRadius * 2, 1) && within(body.height, worldRadius * 2, 1),
        `dart #${k} body box ${body.width}x${body.height} must match its ${worldRadius}px radius`,
      );
      t.diagnostic(
        `dart #${k} body: circle=${body.isCircle} world r=${worldRadius} (d=${body.width}) source r=${body.radius}`,
      );

      for (const s of samples) {
        const b = s.darts[k].body;
        assert.ok(
          gravityOff || b.allowGravity === false,
          `dart #${k} must not be affected by gravity (allowGravity=${b.allowGravity}, world gravity ${JSON.stringify(world.gravity)})`,
        );
        assert.ok(
          Math.abs(b.vx) <= 0.01 && Math.abs(b.vy) <= 0.01,
          `dart #${k} must not move itself: velocity (${b.vx}, ${b.vy})`,
        );
        assert.ok(
          Math.abs(b.ax) <= 0.01 && Math.abs(b.ay) <= 0.01,
          `dart #${k} must not accelerate: acceleration (${b.ax}, ${b.ay})`,
        );
      }

      // the body must travel with the dart (a stale body fixed in the world is a bug)
      const offsets = samples.map((s) => ({
        dx: s.darts[k].x - s.darts[k].body.centerX,
        dy: s.darts[k].y - s.darts[k].body.centerY,
      }));
      const spread = Math.max(...offsets.map((o) => Math.hypot(o.dx, o.dy)));
      const firstPos = { x: samples[0].darts[k].x, y: samples[0].darts[k].y };
      const lastPos = { x: samples[samples.length - 1].darts[k].x, y: samples[samples.length - 1].darts[k].y };
      const dartMoved = Math.hypot(lastPos.x - firstPos.x, lastPos.y - firstPos.y);
      const bodyMoved = Math.hypot(
        samples[samples.length - 1].darts[k].body.centerX - samples[0].darts[k].body.centerX,
        samples[samples.length - 1].darts[k].body.centerY - samples[0].darts[k].body.centerY,
      );
      t.diagnostic(
        `dart #${k}: dart moved ${dartMoved.toFixed(1)}px, body moved ${bodyMoved.toFixed(1)}px, body<->dart centre distance max ${spread.toFixed(1)}px`,
      );
      assert.ok(
        spread <= 10,
        `dart #${k} body must follow the dart, its centre is up to ${spread.toFixed(1)}px away`,
      );
      assert.ok(
        Math.abs(bodyMoved - dartMoved) <= Math.max(5, dartMoved * 0.25),
        `dart #${k} body moved ${bodyMoved.toFixed(1)}px while the dart moved ${dartMoved.toFixed(1)}px`,
      );
    }
  });
});

/* ------------------------------------------------------------------ *
 * R8 - render order above the player
 * ------------------------------------------------------------------ */

test('R8 darts render above the player', { timeout: 90000 }, async (t) => {
  await withGame(t, {}, async (page) => {
    await focusCanvas(page);
    const snap = await snapshot(page);
    assert.equal(snap.darts.length, DART_COUNT, `expected ${DART_COUNT} darts`);
    t.diagnostic(`player depth=${snap.player.depth} listIndex=${snap.player.listIndex}`);
    for (let k = 0; k < snap.darts.length; k += 1) {
      const d = snap.darts[k];
      t.diagnostic(`dart #${k} depth=${d.depth} listIndex=${d.listIndex}`);
      const above = d.depth > snap.player.depth || (d.depth === snap.player.depth && d.listIndex > snap.player.listIndex);
      assert.ok(
        above,
        `dart #${k} must render above the player (depth ${d.depth} vs ${snap.player.depth}, list index ${d.listIndex} vs ${snap.player.listIndex})`,
      );
    }
  });
});

/* ------------------------------------------------------------------ *
 * Build: production build succeeds and ships the dart texture
 * ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function startStaticServer(rootDir, port) {
  const root = path.resolve(rootDir);
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    let rel = urlPath.replace(/^\/+/, '');
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end(`missing: ${urlPath}`);
      return;
    }
    const body = fs.readFileSync(file);
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': String(body.length),
      'cache-control': 'no-store',
    });
    res.end(body);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

test('Build: npm run build succeeds and the production page loads the same dart PNG', { timeout: 240000 }, async (t) => {
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

  const dartFile = fs.readFileSync(DART_PNG);
  const dartHash = sha1(dartFile);
  const emitted = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.png$/i.test(entry.name)) emitted.push(full);
    }
  };
  walk(distDir);
  const matched = emitted.filter((f) => sha1(fs.readFileSync(f)) === dartHash);
  t.diagnostic(`dist PNGs: ${emitted.map((f) => path.relative(distDir, f)).join(', ')}`);
  assert.equal(matched.length, 1, 'the dart PNG must be emitted exactly once into dist/');

  const server = await startStaticServer(distDir, DIST_PORT);
  const page = await browser.newPage({ viewport: VIEWPORT });
  const pageErrors = [];
  const consoleErrors = [];
  const responses = [];
  page.on('pageerror', (e) => pageErrors.push(String((e && e.stack) || e)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const loc = typeof m.location === 'function' ? m.location() : {};
    consoleErrors.push({ text: m.text(), url: (loc && loc.url) || '' });
  });
  page.on('response', (res) => {
    let headers = {};
    try {
      headers = res.headers();
    } catch {
      headers = {};
    }
    responses.push({
      url: res.url(),
      status: res.status(),
      type: res.request().resourceType(),
      contentType: headers['content-type'] || '',
      contentLength: headers['content-length'] || null,
    });
  });

  try {
    await page.goto(`http://127.0.0.1:${DIST_PORT}/`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector('canvas', { timeout: 30000 });
    await page.waitForTimeout(1200);

    const pngResponses = responses.filter((r) => {
      const url = decodeURIComponent(r.url.split('?')[0]);
      return /\.png$/i.test(url) && /image\/png/i.test(r.contentType);
    });
    t.diagnostic(`production image responses: ${pngResponses.map((r) => `${r.status} ${decodeURIComponent(r.url)}`).join(' | ') || 'none'}`);
    assert.ok(pngResponses.length >= 1, 'the production page must load bitmap assets (player + dart textures)');
    for (const res of pngResponses) {
      assert.equal(res.status, 200, `${res.url} must return 200`);
    }
    const dartAsset = pngResponses.find((r) => String(r.contentLength) === String(dartFile.length));
    assert.ok(
      dartAsset,
      `the built page must request the emitted dart PNG (${dartFile.length} bytes); got ${pngResponses.map((r) => r.contentLength).join(', ')}`,
    );
    const servedDart = Buffer.from(await (await fetch(dartAsset.url)).arrayBuffer());
    assert.equal(sha1(servedDart), dartHash, 'the production page must load exactly the built dart PNG');

    const canvas = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      return c ? { width: c.width, height: c.height } : null;
    });
    t.diagnostic(`production canvas: ${canvas ? `${canvas.width}x${canvas.height}` : 'missing'}`);
    assert.deepEqual(canvas, { width: 1280, height: 720 }, 'the production build must boot the same canvas');

    // Browser-initiated /favicon.ico 404s are reported, not asserted: no icon ships with the build.
    const appConsole = consoleErrors.filter((e) => !/favicon\.ico/i.test(e.url || ''));
    if (appConsole.length !== consoleErrors.length) {
      t.diagnostic(`note: browser-generated favicon noise ignored: ${consoleErrors.filter((e) => /favicon\.ico/i.test(e.url || '')).map((e) => e.text).join(' | ')}`);
    }
    t.diagnostic(`production page errors: ${pageErrors.length}, console errors: ${appConsole.length}`);
    assert.deepEqual(pageErrors, [], 'the production page must not throw');
    assert.deepEqual(
      appConsole.map((e) => `${e.text} @ ${e.url}`),
      [],
      'the production page must not log console errors',
    );
  } finally {
    await page.close().catch(() => {});
    await new Promise((resolve) => {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      server.close(() => resolve());
    });
  }
});
