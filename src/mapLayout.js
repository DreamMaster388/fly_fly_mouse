// Shared geometry for the Summoner's Rift inspired map. Both the texture
// generator (tools/build-map.mjs) and the runtime read from this module so the
// painted art, the collision bodies and the water zones always line up.

const DEG = Math.PI / 180;

export const WORLD = { width: 4000, height: 4000 };

export const SPAWN = { x: 620, y: 3380 };

export const WATER_SLOW = 0.55;

export const BASES = {
  player: {
    id: 'player',
    name: '出生区域',
    cx: 0,
    cy: 4000,
    radius: 1150,
    startAngle: -90,
    endAngle: 0,
    gates: [-70, -45, -20],
    gateHalfAngle: 5.5,
  },
  enemy: {
    id: 'enemy',
    name: '僵尸巢穴',
    cx: 4000,
    cy: 0,
    radius: 1150,
    startAngle: 90,
    endAngle: 180,
    gates: [110, 135, 160],
    gateHalfAngle: 5.5,
  },
};

export function baseGatePoint(base, gateIndex, radiusOffset = 0) {
  const angle = base.gates[gateIndex] * DEG;
  const radius = base.radius + radiusOffset;
  return {
    x: base.cx + Math.cos(angle) * radius,
    y: base.cy + Math.sin(angle) * radius,
    angle,
  };
}

export function wallSegments(base) {
  const half = base.gateHalfAngle;
  return [
    [base.startAngle, base.gates[0] - half],
    [base.gates[0] + half, base.gates[1] - half],
    [base.gates[1] + half, base.gates[2] - half],
    [base.gates[2] + half, base.endAngle],
  ].filter(([start, end]) => end > start);
}

/* ------------------------------------------------------------------ *
 * Water
 * ------------------------------------------------------------------ */

function catmullRomClosed(controls, samplesPerSegment = 8) {
  const points = [];
  const count = controls.length;
  for (let index = 0; index < count; index += 1) {
    const p0 = controls[(index - 1 + count) % count];
    const p1 = controls[index];
    const p2 = controls[(index + 1) % count];
    const p3 = controls[(index + 2) % count];
    for (let step = 0; step < samplesPerSegment; step += 1) {
      const t = step / samplesPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      points.push({
        x:
          0.5 *
          (2 * p1.x +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y:
          0.5 *
          (2 * p1.y +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  return points;
}

const NORTH_LAKE = [
  { x: 690, y: 760 },
  { x: 780, y: 650 },
  { x: 900, y: 610 },
  { x: 1030, y: 645 },
  { x: 1140, y: 710 },
  { x: 1205, y: 815 },
  { x: 1215, y: 925 },
  { x: 1150, y: 1000 },
  { x: 1040, y: 1035 },
  { x: 930, y: 1030 },
  { x: 820, y: 985 },
  { x: 725, y: 910 },
  { x: 670, y: 835 },
];

const SOUTH_LAKE = [
  { x: 2260, y: 2100 },
  { x: 2370, y: 2010 },
  { x: 2520, y: 1995 },
  { x: 2660, y: 2045 },
  { x: 2800, y: 2120 },
  { x: 2890, y: 2240 },
  { x: 2910, y: 2370 },
  { x: 2840, y: 2475 },
  { x: 2720, y: 2530 },
  { x: 2580, y: 2555 },
  { x: 2450, y: 2510 },
  { x: 2340, y: 2420 },
  { x: 2255, y: 2300 },
  { x: 2230, y: 2195 },
];

export const WATER_BODIES = [
  { id: 'north-lake', center: { x: 950, y: 840 }, controls: NORTH_LAKE, points: catmullRomClosed(NORTH_LAKE) },
  { id: 'south-lake', center: { x: 2580, y: 2300 }, controls: SOUTH_LAKE, points: catmullRomClosed(SOUTH_LAKE) },
];

export function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i];
    const b = points[j];
    if (
      a.y > y !== b.y > y &&
      x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export function isInWater(x, y) {
  return WATER_BODIES.some((body) => pointInPolygon(x, y, body.points));
}

/* ------------------------------------------------------------------ *
 * Lanes (used for painting and for keeping obstacles out of the routes)
 * ------------------------------------------------------------------ */

function catmullRomOpen(controls, samplesPerSegment = 12) {
  const extended = [controls[0], ...controls, controls[controls.length - 1]];
  const points = [];
  for (let index = 1; index < extended.length - 2; index += 1) {
    const p0 = extended[index - 1];
    const p1 = extended[index];
    const p2 = extended[index + 1];
    const p3 = extended[index + 2];
    for (let step = 0; step < samplesPerSegment; step += 1) {
      const t = step / samplesPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      points.push({
        x:
          0.5 *
          (2 * p1.x +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y:
          0.5 *
          (2 * p1.y +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  points.push(controls[controls.length - 1]);
  return points;
}

export const LANES = [
  {
    id: 'north',
    controls: [
      { x: 393, y: 2919 },
      { x: 520, y: 2450 },
      { x: 720, y: 1900 },
      { x: 1050, y: 1450 },
      { x: 1500, y: 1050 },
      { x: 1950, y: 800 },
      { x: 2350, y: 620 },
      { x: 2700, y: 500 },
      { x: 2919, y: 393 },
    ],
  },
  {
    id: 'mid',
    controls: [
      { x: 813, y: 3187 },
      { x: 1250, y: 2800 },
      { x: 1750, y: 2450 },
      { x: 2150, y: 2150 },
      { x: 2500, y: 1850 },
      { x: 2800, y: 1500 },
      { x: 3187, y: 813 },
    ],
  },
  {
    id: 'south',
    controls: [
      { x: 1081, y: 3607 },
      { x: 1600, y: 3350 },
      { x: 2100, y: 3050 },
      { x: 2600, y: 2850 },
      { x: 3050, y: 2600 },
      { x: 3400, y: 2100 },
      { x: 3607, y: 1081 },
    ],
  },
];

for (const lane of LANES) lane.points = catmullRomOpen(lane.controls);

export function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

export function distanceToPolyline(x, y, points, closed = false) {
  let best = Infinity;
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    const distance = distanceToSegment(x, y, a.x, a.y, b.x, b.y);
    if (distance < best) best = distance;
  }
  if (closed && points.length > 1) {
    const a = points[points.length - 1];
    const b = points[0];
    const distance = distanceToSegment(x, y, a.x, a.y, b.x, b.y);
    if (distance < best) best = distance;
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * Base walls (arc segments with three wide gates per base)
 * ------------------------------------------------------------------ */

export const WALL_COLLIDERS = [];

for (const base of Object.values(BASES)) {
  for (const [startAngle, endAngle] of wallSegments(base)) {
    const arcLength = (endAngle - startAngle) * DEG * base.radius;
    const steps = Math.max(2, Math.ceil(arcLength / 36));
    for (let step = 0; step <= steps; step += 1) {
      const angle = (startAngle + ((endAngle - startAngle) * step) / steps) * DEG;
      WALL_COLLIDERS.push({
        x: base.cx + Math.cos(angle) * base.radius,
        y: base.cy + Math.sin(angle) * base.radius,
        r: 27,
        base: base.id,
        angle,
      });
    }
  }
}

/* ------------------------------------------------------------------ *
 * Obstacles
 * ------------------------------------------------------------------ */

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const OBSTACLE_CLUSTERS = [
  { kind: 'tree', x: 700, y: 1580, count: 6, spread: 125 },
  { kind: 'tree', x: 1160, y: 1640, count: 5, spread: 100 },
  { kind: 'tree', x: 1560, y: 790, count: 5, spread: 100 },
  { kind: 'tree', x: 1860, y: 640, count: 4, spread: 80 },
  { kind: 'tree', x: 1360, y: 2360, count: 5, spread: 100 },
  { kind: 'tree', x: 2250, y: 1660, count: 5, spread: 95 },
  { kind: 'tree', x: 2350, y: 2870, count: 6, spread: 120 },
  { kind: 'tree', x: 3060, y: 2960, count: 6, spread: 115 },
  { kind: 'tree', x: 3350, y: 1900, count: 5, spread: 100 },
  { kind: 'tree', x: 2500, y: 1000, count: 4, spread: 85 },
  { kind: 'tree', x: 850, y: 2600, count: 4, spread: 90 },
  { kind: 'tree', x: 3300, y: 1420, count: 4, spread: 90 },
  { kind: 'rock', x: 1000, y: 620, count: 4, spread: 90 },
  { kind: 'rock', x: 640, y: 1150, count: 3, spread: 75 },
  { kind: 'rock', x: 1450, y: 1850, count: 4, spread: 90 },
  { kind: 'rock', x: 2000, y: 2450, count: 4, spread: 95 },
  { kind: 'rock', x: 2580, y: 1240, count: 4, spread: 90 },
  { kind: 'rock', x: 2740, y: 3060, count: 4, spread: 90 },
  { kind: 'rock', x: 1650, y: 3050, count: 3, spread: 80 },
  { kind: 'rock', x: 2850, y: 800, count: 3, spread: 75 },
];

function isObstacleSpotFree(x, y, radius) {
  const margin = 235;
  if (x < margin || x > WORLD.width - margin || y < margin || y > WORLD.height - margin) return false;

  for (const base of Object.values(BASES)) {
    if (Math.hypot(x - base.cx, y - base.cy) < base.radius + 130 + radius) return false;
  }

  for (const body of WATER_BODIES) {
    if (pointInPolygon(x, y, body.points)) return false;
    if (distanceToPolyline(x, y, body.points, true) < 48 + radius) return false;
  }

  for (const lane of LANES) {
    if (distanceToPolyline(x, y, lane.points) < 112 + radius) return false;
  }

  for (const other of OBSTACLES) {
    if (Math.hypot(x - other.x, y - other.y) < radius + other.r + 26) return false;
  }

  return true;
}

export const OBSTACLES = [];
{
  const rng = mulberry32(0x51ff0a7);
  for (const cluster of OBSTACLE_CLUSTERS) {
    for (let index = 0; index < cluster.count; index += 1) {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const angle = rng() * Math.PI * 2;
        const distance = Math.sqrt(rng()) * cluster.spread;
        const x = cluster.x + Math.cos(angle) * distance;
        const y = cluster.y + Math.sin(angle) * distance;
        const r = cluster.kind === 'rock' ? 46 + rng() * 22 : 22 + rng() * 8;
        if (!isObstacleSpotFree(x, y, r)) continue;

        OBSTACLES.push({
          id: `${cluster.kind}-${OBSTACLES.length}`,
          kind: cluster.kind,
          x: Math.round(x),
          y: Math.round(y),
          r: Math.round(r),
          seed: Math.floor(rng() * 0xffffffff),
        });
        break;
      }
    }
  }
}

// Trees are painted decoration only: the player and zombies walk through them.
const COLLIDER_PADDING = {
  rock: 0.82,
};

for (const obstacle of OBSTACLES) {
  const padding = COLLIDER_PADDING[obstacle.kind];
  if (!padding) continue;
  obstacle.colliderRadius = Math.round(obstacle.r * padding);
}

/* ------------------------------------------------------------------ *
 * Border decoration (purely visual; the world bounds block movement)
 * ------------------------------------------------------------------ */

export const BORDER_TREES = [];
export const BORDER_ROCKS = [];

function insideBase(x, y, padding = 0) {
  return Object.values(BASES).some(
    (base) => Math.hypot(x - base.cx, y - base.cy) < base.radius + padding,
  );
}

{
  const rng = mulberry32(0xb07de2);
  const edges = [
    { axis: 'horizontal', line: 0, normal: 1 },
    { axis: 'horizontal', line: WORLD.height, normal: -1 },
    { axis: 'vertical', line: 0, normal: 1 },
    { axis: 'vertical', line: WORLD.width, normal: -1 },
  ];

  for (const edge of edges) {
    const length = edge.axis === 'horizontal' ? WORLD.width : WORLD.height;
    for (let step = 10; step < length; step += 52) {
      const rows = 4;
      for (let row = 0; row < rows; row += 1) {
        if (rng() < 0.18) continue;
        const depth = 18 + row * 58 + rng() * 38;
        const along = step + (rng() - 0.5) * 44;
        const x = edge.axis === 'horizontal' ? along : edge.line + edge.normal * depth;
        const y = edge.axis === 'horizontal' ? edge.line + edge.normal * depth : along;
        if (x < 0 || y < 0 || x > WORLD.width || y > WORLD.height) continue;
        if (insideBase(x, y, 40)) continue;

        const scale = 0.95 + rng() * 1.3;
        if (rng() < 0.82) {
          BORDER_TREES.push({
            x,
            y,
            scale,
            seed: Math.floor(rng() * 0xffffffff),
            hue: rng(),
          });
        } else {
          BORDER_ROCKS.push({
            x,
            y,
            r: 34 + rng() * 46,
            seed: Math.floor(rng() * 0xffffffff),
          });
        }
      }
    }
  }

  // Large cliff masses in the two unused corners.
  for (const corner of [
    { x: 140, y: 160 },
    { x: 3860, y: 3840 },
  ]) {
    for (let index = 0; index < 9; index += 1) {
      const angle = rng() * Math.PI * 2;
      const distance = rng() * 210;
      if (insideBase(corner.x + Math.cos(angle) * distance, corner.y + Math.sin(angle) * distance, 60)) {
        continue;
      }
      BORDER_ROCKS.push({
        x: corner.x + Math.cos(angle) * distance,
        y: corner.y + Math.sin(angle) * distance,
        r: 40 + rng() * 55,
        seed: Math.floor(rng() * 0xffffffff),
      });
    }
  }
}

/* ------------------------------------------------------------------ *
 * Runtime helpers
 * ------------------------------------------------------------------ */

export function speedMultiplierAt(x, y) {
  return isInWater(x, y) ? WATER_SLOW : 1;
}

export function baseContainsPoint(base, x, y) {
  return Math.hypot(x - base.cx, y - base.cy) <= base.radius;
}

export function nearestGate(base, x, y) {
  const angle = Math.atan2(y - base.cy, x - base.cx);
  let bestIndex = 0;
  let bestDelta = Infinity;
  base.gates.forEach((gate, index) => {
    const delta = Math.abs(Math.atan2(Math.sin(angle - gate * DEG), Math.cos(angle - gate * DEG)));
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = index;
    }
  });
  return bestIndex;
}
