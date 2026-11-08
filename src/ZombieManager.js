import Phaser from 'phaser';
import { ZOMBIES } from './config.js';
import Zombie from './Zombie.js';

export default class ZombieManager {
  constructor(scene, player, difficulty, typeId = 'walker', callbacks = {}) {
    this.scene = scene;
    this.player = player;
    this.difficulty = difficulty;
    this.typeId = typeId;
    this.config = ZOMBIES[typeId];
    this.zombies = new Set();
    this.onReachPlayer = callbacks.onReachPlayer || (() => {});
    this.onZombieKilled = callbacks.onKill || (() => {});

    this.createAnimations();
    this.group = scene.physics.add.group();
    scene.physics.add.overlap(player.gameObject, this.group, this.handleContact, null, this);

    this.spawn();
    this.spawnTimer = scene.time.addEvent({
      delay: this.config.spawnIntervalMs,
      loop: true,
      callback: this.spawn,
      callbackScope: this,
    });
  }

  createAnimations() {
    this.createAnimation(this.config.walk);
    this.createAnimation(this.config.die);
  }

  createAnimation(animation) {
    if (this.scene.anims.exists(animation.animationKey)) return;

    const frames = this.scene.anims.generateFrameNumbers(animation.textureKey, {
      start: 0,
      end: animation.frameCount - 1,
    });
    frames.forEach((frame, index) => {
      frame.duration = animation.frameDurations[index % animation.frameDurations.length];
    });

    this.scene.anims.create({
      key: animation.animationKey,
      frames,
      repeat: animation.repeat,
    });
  }

  spawn() {
    const tier = this.difficulty.tier;
    if (this.zombies.size >= tier.maxAlive) return;

    const point = this.findSpawnPoint();
    if (!point) return;

    const zombie = new Zombie(
      this.scene,
      point.x,
      point.y,
      this.typeId,
      {
        speed: this.difficulty.rollZombieSpeed(),
        maxHp: tier.maxHp,
      },
      (deadZombie) => this.handleZombieDeath(deadZombie),
    );
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
    const { worldInset, cameraMargin, spawnAttempts } = this.config;

    for (let attempt = 0; attempt < spawnAttempts; attempt += 1) {
      const x = Phaser.Math.Between(bounds.left + worldInset, bounds.right - worldInset);
      const y = Phaser.Math.Between(bounds.top + worldInset, bounds.bottom - worldInset);

      const insideMargin =
        x >= viewLeft - cameraMargin &&
        x <= viewRight + cameraMargin &&
        y >= viewTop - cameraMargin &&
        y <= viewBottom + cameraMargin;

      if (!insideMargin) return { x, y };
    }

    return null;
  }

  update() {
    const player = this.player.gameObject;
    for (const zombie of this.zombies) zombie.update(player);
  }

  getLiveZombies() {
    return Array.from(this.zombies);
  }

  handleZombieDeath(zombie) {
    this.zombies.delete(zombie);
    this.group.remove(zombie.gameObject);
    this.onZombieKilled(zombie);
  }

  stop() {
    if (!this.spawnTimer) return;
    this.spawnTimer.remove(false);
    this.spawnTimer = null;
  }

  handleContact(playerObject, zombieObject) {
    if (!zombieObject.active) return;
    this.onReachPlayer(zombieObject);
    zombieObject.destroy();
  }
}
