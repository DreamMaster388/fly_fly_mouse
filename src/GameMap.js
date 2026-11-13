import mapTextureUrl from '../resource/map/rift-map.jpg';
import {
  WORLD,
  BASES,
  WALL_COLLIDERS,
  OBSTACLES,
  WATER_BODIES,
  isInWater,
  speedMultiplierAt as layoutSpeedMultiplierAt,
  baseGatePoint,
  nearestGate,
} from './mapLayout.js';

export const MAP_TEXTURE = { key: 'rift-map', url: mapTextureUrl };

export default class GameMap {
  constructor(scene) {
    this.scene = scene;
    this.width = WORLD.width;
    this.height = WORLD.height;
    this.bases = BASES;
    this.waterBodies = WATER_BODIES;
    this.background = scene.add
      .image(0, 0, MAP_TEXTURE.key)
      .setOrigin(0)
      .setDisplaySize(WORLD.width, WORLD.height)
      .setDepth(-100);

    this.obstacleBodies = [];
    for (const wall of WALL_COLLIDERS) {
      this.obstacleBodies.push({ x: wall.x, y: wall.y, r: wall.r, kind: 'wall' });
    }
    for (const obstacle of OBSTACLES) {
      if (!obstacle.colliderRadius) continue;
      this.obstacleBodies.push({
        x: obstacle.x,
        y: obstacle.y,
        r: obstacle.colliderRadius,
        kind: obstacle.kind,
      });
    }

    this.colliders = this.obstacleBodies.map((body) => this.createCollider(body));
  }

  createCollider({ x, y, r }) {
    const zone = this.scene.add.zone(x, y, r * 2, r * 2);
    this.scene.physics.add.existing(zone, true);
    zone.body.setCircle(r);
    zone.setDepth(-90);
    return zone;
  }

  isBlocked(x, y, padding = 0) {
    return this.obstacleBodies.some(
      (body) => Math.hypot(x - body.x, y - body.y) < body.r + padding,
    );
  }

  isInWater(x, y) {
    return isInWater(x, y);
  }

  speedMultiplierAt(x, y) {
    return layoutSpeedMultiplierAt(x, y);
  }

  isInsideBase(baseId, x, y, padding = 0) {
    const base = BASES[baseId];
    return Math.hypot(x - base.cx, y - base.cy) < base.radius + padding;
  }

  canSpawnAt(x, y, padding = 40) {
    if (this.isBlocked(x, y, padding)) return false;
    if (this.isInsideBase('player', x, y, 60)) return false;
    if (this.isInsideBase('enemy', x, y, 60)) return false;
    return true;
  }

  // Routes a walker to a gate when it has to cross a base wall, so zombies do
  // not grind against the arc between two openings.
  navigationTarget(fromX, fromY, toX, toY) {
    for (const base of Object.values(BASES)) {
      const fromDistance = Math.hypot(fromX - base.cx, fromY - base.cy);
      const toDistance = Math.hypot(toX - base.cx, toY - base.cy);
      if (fromDistance > base.radius && toDistance < base.radius) {
        return baseGatePoint(base, nearestGate(base, fromX, fromY), -40);
      }
      if (fromDistance < base.radius && toDistance > base.radius) {
        return baseGatePoint(base, nearestGate(base, fromX, fromY), 40);
      }
    }
    return { x: toX, y: toY };
  }
}
