import Phaser from 'phaser';
import { ZOMBIES } from './config.js';
import Zombie from './Zombie.js';

function rectGap(x, y, left, top, right, bottom) {
  const dx = Math.max(left - x, 0, x - right);
  const dy = Math.max(top - y, 0, y - bottom);
  return Math.hypot(dx, dy);
}

export default class ZombieManager {
  constructor(scene, player, population, typeId = 'normal', callbacks = {}) {
    this.scene = scene;
    this.player = player;
    this.population = population;
    this.typeId = typeId;
    this.config = ZOMBIES[typeId];
    this.zombies = new Set();
    this.onReachPlayer = callbacks.onReachPlayer || (() => {});
    this.onZombieKilled = callbacks.onKill || (() => {});

    // Legacy spritesheet animations (superseded by ZombieArt reanim parts):
    // this.createAnimations();
    this.group = scene.physics.add.group();
    scene.physics.add.collider(this.group, this.group);
    scene.physics.add.collider(player.gameObject, this.group);

    this.spawn();
    this.spawnTimer = scene.time.addEvent({
      delay: this.config.spawnIntervalMs,
      loop: true,
      callback: this.spawn,
      callbackScope: this,
    });
  }

  // Legacy spritesheet animation setup (superseded by ZombieArt reanim parts):
  // createAnimations() {
  //   for (const variant of this.config.walk.variants) {
  //     this.createAnimation(variant, this.config.walk.repeat);
  //   }
  //   this.createAnimation(this.config.attack, this.config.attack.repeat);
  //   this.createAnimation(this.config.die, this.config.die.repeat);
  //   this.createAnimation(this.config.head, this.config.head.repeat);
  // }
  //
  // createAnimation(animation, repeat) {
  //   if (this.scene.anims.exists(animation.animationKey)) return;
  //
  //   const frames = this.scene.anims.generateFrameNumbers(animation.textureKey, {
  //     start: 0,
  //     end: animation.frameCount - 1,
  //   });
  //   frames.forEach((frame, index) => {
  //     frame.duration = animation.frameDurations[index % animation.frameDurations.length];
  //   });
  //
  //   this.scene.anims.create({
  //     key: animation.animationKey,
  //     frames,
  //     repeat,
  //   });
  // }

  spawn() {
    const cost = this.config.populationCost;
    if (!this.population.canAdd(cost)) return null;

    const point = this.findSpawnPoint();
    if (!point) return null;

    const zombie = new Zombie(
      this.scene,
      point.x,
      point.y,
      this.typeId,
      {
        speed: this.config.speed,
        maxHp: this.config.maxHp,
      },
      {
        onDeath: (deadZombie) => this.handleZombieDeath(deadZombie),
        onAttack: (attacker) => this.onReachPlayer(attacker),
      },
    );
    this.group.add(zombie.gameObject);
    this.zombies.add(zombie);
    this.population.add(zombie, cost);
    zombie.gameObject.once('destroy', () => {
      this.zombies.delete(zombie);
      this.population.remove(zombie);
    });

    return zombie;
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
    const { worldInset, cameraMargin, spawnMaxMargin, spawnAttempts } = this.config;

    // Spawn in a ring just outside the camera: never on screen, but close
    // enough that enemies reach the player instead of wandering in from afar.
    const minX = Math.max(bounds.left + worldInset, viewLeft - spawnMaxMargin);
    const maxX = Math.min(bounds.right - worldInset, viewRight + spawnMaxMargin);
    const minY = Math.max(bounds.top + worldInset, viewTop - spawnMaxMargin);
    const maxY = Math.min(bounds.bottom - worldInset, viewBottom + spawnMaxMargin);
    if (minX >= maxX || minY >= maxY) return null;

    for (let attempt = 0; attempt < spawnAttempts; attempt += 1) {
      const x = Phaser.Math.Between(minX, maxX);
      const y = Phaser.Math.Between(minY, maxY);
      const gap = rectGap(x, y, viewLeft, viewTop, viewRight, viewBottom);

      if (gap < cameraMargin || gap > spawnMaxMargin) continue;
      if (this.scene.gameMap && !this.scene.gameMap.canSpawnAt(x, y, this.config.body.radius + 8)) {
        continue;
      }
      return { x, y };
    }

    return null;
  }

  update(time) {
    const player = this.player.gameObject;
    const playerBody = this.player.body;
    const playerX = playerBody ? playerBody.center.x : player.x;
    const playerY = playerBody ? playerBody.center.y : player.y;
    const { despawnDistance } = this.config;
    const despawnSq = (despawnDistance || 0) ** 2;

    for (const zombie of this.zombies) {
      if (despawnSq && !zombie.despawnExempt) {
        const dx = zombie.body.center.x - playerX;
        const dy = zombie.body.center.y - playerY;
        // Left far behind: cull without a death reward so the freed
        // population slot can spawn a fresh chaser near the player.
        if (dx * dx + dy * dy > despawnSq) {
          this.despawn(zombie);
          continue;
        }
      }
      zombie.update(player, time);
    }
  }

  despawn(zombie) {
    this.zombies.delete(zombie);
    this.population.remove(zombie);
    zombie.destroy();
  }

  getLiveZombies() {
    return Array.from(this.zombies);
  }

  clear() {
    const count = this.zombies.size;
    for (const zombie of Array.from(this.zombies)) zombie.destroy();
    this.zombies.clear();
    this.group.clear(true, true);
    this.population.clear();
    return count;
  }

  handleZombieDeath(zombie) {
    this.zombies.delete(zombie);
    this.population.remove(zombie);
    this.group.remove(zombie.gameObject);
    this.onZombieKilled(zombie);
  }

  stop() {
    if (!this.spawnTimer) return;
    this.spawnTimer.remove(false);
    this.spawnTimer = null;
  }
}
