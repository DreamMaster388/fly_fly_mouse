import Phaser from 'phaser';
import { WEAPONS } from './config.js';

const BOMB_DEPTH = 60;
const EXPLOSION_DEPTH = 61;

export default class BombWeapon {
  constructor(scene, player, zombieManager, typeId = 'bomb') {
    this.scene = scene;
    this.player = player;
    this.zombieManager = zombieManager;
    this.typeId = typeId;

    const source = WEAPONS[typeId];
    this.config = {
      ...source,
      animation: { ...source.animation },
      explosion: { ...source.explosion },
    };
    this.level = 1;
    this.nextThrowAt = scene.time.now + this.config.cooldownMs;
    this.flights = new Set();
  }

  update(time) {
    this.updateFlights(time);
    if (time < this.nextThrowAt) return;

    const target = this.findNearest(this.player.body.center, this.getLiveTargets());
    if (!target) return;

    this.nextThrowAt = time + this.config.cooldownMs;
    this.launch(this.player.body.center, target, { chain: false });
  }

  getLiveTargets() {
    return this.zombieManager
      .getLiveZombies()
      .filter((zombie) => !zombie.dead && zombie.body);
  }

  findNearest(point, zombies) {
    let nearest = null;
    let bestDistance = Infinity;
    for (const zombie of zombies) {
      const center = zombie.body.center;
      const distance = Phaser.Math.Distance.Squared(point.x, point.y, center.x, center.y);
      if (distance < bestDistance) {
        nearest = zombie;
        bestDistance = distance;
      }
    }
    return nearest;
  }

  launch(from, target, { chain }) {
    const animation = this.config.animation;
    const sprite = this.scene.add
      .sprite(from.x, from.y, animation.textureKey)
      .setDepth(BOMB_DEPTH);
    sprite.setScale(animation.displayHeight / animation.frameHeight);
    sprite.play(animation.animationKey);

    const landing = target.body.center;
    this.flights.add({
      sprite,
      from: { x: from.x, y: from.y },
      target,
      landing: { x: landing.x, y: landing.y },
      startedAt: this.scene.time.now,
      duration: (animation.frameCount / animation.frameRate) * 1000,
      chain,
    });
  }

  updateFlights(time) {
    for (const flight of [...this.flights]) {
      const progress = Math.min(1, (time - flight.startedAt) / flight.duration);
      // Keep aiming at the target while it walks; a dead target keeps the last
      // known landing point so the bomb still resolves.
      if (flight.target && !flight.target.dead && flight.target.body) {
        const center = flight.target.body.center;
        flight.landing.x = center.x;
        flight.landing.y = center.y;
      }
      flight.sprite.setPosition(
        Phaser.Math.Linear(flight.from.x, flight.landing.x, progress),
        Phaser.Math.Linear(flight.from.y, flight.landing.y, progress),
      );

      if (progress < 1) continue;
      this.flights.delete(flight);
      flight.sprite.destroy();
      this.settle(flight);
    }
  }

  settle(flight) {
    const point = flight.landing;
    const radius = this.config.radius;

    for (const zombie of this.getLiveTargets()) {
      const center = zombie.body.center;
      if (Phaser.Math.Distance.Between(point.x, point.y, center.x, center.y) > radius) {
        continue;
      }
      zombie.takeDamage(this.config.damage, this.config.damageType);
    }

    this.showExplosion(point);
    this.tryChain(flight, point);
  }

  tryChain(flight, point) {
    if (flight.chain || this.level < 8 || this.config.chainChance <= 0) return;
    if (Math.random() >= this.config.chainChance) return;

    // Bounce to the nearest enemy still alive after the blast, even when the
    // first explosion killed everything inside its radius.
    const candidates = this.getLiveTargets().filter((zombie) => zombie !== flight.target);
    const next = this.findNearest(point, candidates);
    if (next) this.launch(point, next, { chain: true });
  }

  showExplosion(point) {
    const explosion = this.config.explosion;
    const fx = this.scene.add.image(point.x, point.y, explosion.textureKey).setDepth(EXPLOSION_DEPTH);
    const targetScale = (this.config.radius * explosion.sizeRatio) / fx.height;
    fx.setScale(targetScale * 0.7);
    this.scene.tweens.add({
      targets: fx,
      scale: targetScale,
      alpha: 0,
      duration: explosion.durationMs,
      ease: 'Cubic.Out',
      onComplete: () => fx.destroy(),
    });
  }

  applyUpgrade(step, level) {
    if (!step) return false;

    Object.assign(this.config, step);
    this.level = level;

    if (typeof step.cooldownMs === 'number') {
      this.nextThrowAt = Math.min(
        this.nextThrowAt,
        this.scene.time.now + this.config.cooldownMs,
      );
    }
    return true;
  }
}
