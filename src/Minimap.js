import { WORLD } from './mapLayout.js';
import { MAP_TEXTURE } from './GameMap.js';

const MAP_SIZE = 200;
const PADDING = 8;
const MARGIN = 16;
const PANEL_SIZE = MAP_SIZE + PADDING * 2;

const DARK = 0x0a1420;
const INNER = 0x1e2328;
const BRONZE = 0x785a28;
const GOLD = 0xc8aa6e;
const ZOMBIE_DOT = 0xff3b30;
const ZOMBIE_DOT_RADIUS = 3;
const ZOMBIE_DOT_OUTLINE = 0x1a0705;

function chamferPoints(x, y, width, height, cut) {
  return [
    { x: x + cut, y },
    { x: x + width - cut, y },
    { x: x + width, y: y + cut },
    { x: x + width, y: y + height - cut },
    { x: x + width - cut, y: y + height },
    { x: x + cut, y: y + height },
    { x, y: y + height - cut },
    { x, y: y + cut },
  ];
}

export default class Minimap {
  constructor(scene) {
    this.scene = scene;
    this.x = scene.scale.width - MARGIN - PANEL_SIZE;
    this.y = scene.scale.height - MARGIN - PANEL_SIZE;
    this.innerX = this.x + PADDING;
    this.innerY = this.y + PADDING;

    const panel = scene.add.graphics().setScrollFactor(0).setDepth(1090);
    this.panel = panel;
    const points = chamferPoints(this.x, this.y, PANEL_SIZE, PANEL_SIZE, 10);
    panel.fillStyle(0x050b0f, 0.94);
    panel.fillPoints(points, true);
    panel.lineStyle(1, BRONZE, 1);
    panel.strokePoints(points, true);
    panel.lineStyle(1, INNER, 0.9);
    panel.strokePoints(
      chamferPoints(this.x + 2, this.y + 2, PANEL_SIZE - 4, PANEL_SIZE - 4, 9),
      true,
    );
    panel.lineStyle(1, GOLD, 0.22);
    panel.lineBetween(this.x + 10, this.y + 3, this.x + PANEL_SIZE - 10, this.y + 3);
    panel.fillStyle(0x02080c, 1);
    panel.fillRect(this.innerX - 2, this.innerY - 2, MAP_SIZE + 4, MAP_SIZE + 4);
    panel.lineStyle(1, 0x3c3220, 1);
    panel.strokeRect(this.innerX - 1, this.innerY - 1, MAP_SIZE + 2, MAP_SIZE + 2);

    this.mapImage = scene.add
      .image(this.innerX, this.innerY, MAP_TEXTURE.key)
      .setOrigin(0)
      .setDisplaySize(MAP_SIZE, MAP_SIZE)
      .setScrollFactor(0)
      .setDepth(1091);

    this.viewport = scene.add.graphics().setScrollFactor(0).setDepth(1092);
    this.zombieDots = scene.add.graphics().setScrollFactor(0).setDepth(1092.5);
    this.zombieBlips = [];

    this.markerGlow = scene.add
      .circle(this.innerX + MAP_SIZE / 2, this.innerY + MAP_SIZE / 2, 9, 0xffd873, 0.22)
      .setScrollFactor(0)
      .setDepth(1092);
    this.marker = scene.add
      .circle(this.innerX + MAP_SIZE / 2, this.innerY + MAP_SIZE / 2, 5, 0xffd873)
      .setStrokeStyle(2.5, 0x2a1a08)
      .setScrollFactor(0)
      .setDepth(1093);

    this.fadeRegions = [{ x: this.x, y: this.y, width: PANEL_SIZE, height: PANEL_SIZE }];
    this.fadeObjects = [
      this.panel,
      this.mapImage,
      this.viewport,
      this.zombieDots,
      this.markerGlow,
      this.marker,
    ];
  }

  setAlpha(alpha) {
    for (const object of this.fadeObjects) object.setAlpha(alpha);
  }

  update(player, zombies = []) {
    const body = player && player.body;
    const x = body ? body.center.x : player.gameObject.x;
    const y = body ? body.center.y : player.gameObject.y;
    const markerX = this.innerX + (x / WORLD.width) * MAP_SIZE;
    const markerY = this.innerY + (y / WORLD.height) * MAP_SIZE;
    this.marker.setPosition(markerX, markerY);
    this.markerGlow.setPosition(markerX, markerY);

    const view = this.scene.cameras.main.worldView;
    const vx = this.innerX + (view.x / WORLD.width) * MAP_SIZE;
    const vy = this.innerY + (view.y / WORLD.height) * MAP_SIZE;
    const vw = (view.width / WORLD.width) * MAP_SIZE;
    const vh = (view.height / WORLD.height) * MAP_SIZE;

    const g = this.viewport;
    g.clear();
    g.fillStyle(0xf0e6d2, 0.05);
    g.fillRect(vx, vy, vw, vh);
    g.lineStyle(1, 0xf0e6d2, 0.55);
    g.strokeRect(vx, vy, vw, vh);

    this.drawZombieDots(zombies);
  }

  drawZombieDots(zombies) {
    const blips = this.zombieBlips;
    blips.length = 0;

    for (const zombie of zombies) {
      if (!zombie || zombie.dead) continue;
      const body = zombie.body;
      const x = body ? body.center.x : zombie.gameObject.x;
      const y = body ? body.center.y : zombie.gameObject.y;
      blips.push({
        x: this.innerX + (x / WORLD.width) * MAP_SIZE,
        y: this.innerY + (y / WORLD.height) * MAP_SIZE,
      });
    }

    const g = this.zombieDots;
    g.clear();
    if (blips.length === 0) return;

    g.fillStyle(ZOMBIE_DOT_OUTLINE, 0.85);
    for (const blip of blips) g.fillCircle(blip.x, blip.y, ZOMBIE_DOT_RADIUS + 1);
    g.fillStyle(ZOMBIE_DOT, 1);
    for (const blip of blips) g.fillCircle(blip.x, blip.y, ZOMBIE_DOT_RADIUS);
  }
}
