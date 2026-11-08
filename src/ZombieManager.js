import Phaser from 'phaser';
import Zombie, { ZOMBIE_ANIMATION_KEY } from './Zombie.js';

const FRAME_COUNT = 22;
const FRAME_DURATIONS = [90, 180];
const SPAWN_INTERVAL_MS = 2000;
const MAX_ALIVE = 5;
const SPAWN_ATTEMPTS = 20;
const WORLD_INSET = 64;
const CAMERA_MARGIN = 80;
const CONFIG = { speed: 150 };

export default class ZombieManager {
  constructor(scene, player) {
    this.scene = scene;
    this.player = player;
    this.config = { ...CONFIG };
    this.zombies = new Set();

    this.createAnimation();
    this.group = scene.physics.add.group();
    scene.physics.add.overlap(player.gameObject, this.group, this.handleContact, null, this);

    this.spawn();
    this.spawnTimer = scene.time.addEvent({
      delay: SPAWN_INTERVAL_MS,
      loop: true,
      callback: this.spawn,
      callbackScope: this,
    });
  }

  createAnimation() {
    if (this.scene.anims.exists(ZOMBIE_ANIMATION_KEY)) return;

    const frames = this.scene.anims.generateFrameNumbers('zombie', {
      start: 0,
      end: FRAME_COUNT - 1,
    });
    frames.forEach((frame, index) => {
      frame.duration = FRAME_DURATIONS[index % FRAME_DURATIONS.length];
    });

    this.scene.anims.create({
      key: ZOMBIE_ANIMATION_KEY,
      frames,
      repeat: -1,
    });
  }

  spawn() {
    if (this.zombies.size >= MAX_ALIVE) return;

    const point = this.findSpawnPoint();
    if (!point) return;

    const zombie = new Zombie(this.scene, point.x, point.y, this.config);
    this.group.add(zombie.gameObject);
    this.zombies.add(zombie);
    zombie.gameObject.once('destroy', () => this.zombies.delete(zombie));
  }

  findSpawnPoint() {
    const camera = this.scene.cameras.main;
    const viewWidth = camera.width / (camera.zoomX || 1);
    const viewHeight = camera.height / (camera.zoomY || 1);
    const viewLeft = camera.scrollX + camera.width / 2 - viewWidth / 2;
    const viewTop = camera.scrollY + camera.height / 2 - viewHeight / 2;
    const viewRight = viewLeft + viewWidth;
    const viewBottom = viewTop + viewHeight;
    const bounds = this.scene.physics.world.bounds;

    for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt += 1) {
      const x = Phaser.Math.Between(bounds.left + WORLD_INSET, bounds.right - WORLD_INSET);
      const y = Phaser.Math.Between(bounds.top + WORLD_INSET, bounds.bottom - WORLD_INSET);

      const insideMargin =
        x >= viewLeft - CAMERA_MARGIN &&
        x <= viewRight + CAMERA_MARGIN &&
        y >= viewTop - CAMERA_MARGIN &&
        y <= viewBottom + CAMERA_MARGIN;

      if (!insideMargin) return { x, y };
    }

    return null;
  }

  update() {
    const player = this.player.gameObject;
    for (const zombie of this.zombies) zombie.update(player);
  }

  handleContact(playerObject, zombieObject) {
    if (!zombieObject.active) return;
    this.onReachPlayer(zombieObject);
    zombieObject.destroy();
  }

  onReachPlayer() {}
}
