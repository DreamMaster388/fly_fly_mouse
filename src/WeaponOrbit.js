import Phaser from 'phaser';
import { WEAPONS } from './config.js';

export default class WeaponOrbit {
  constructor(scene, player, typeId = 'dart', refillIntervalMs = 250) {
    this.scene = scene;
    this.player = player;
    this.config = WEAPONS[typeId];
    this.startTime = null;
    this.centerOffsetX = 0;
    this.centerOffsetY = 0;
    this.slots = new Array(this.config.slotCount).fill(null);
    this.refillCursor = 0;
    this.refillIntervalMs = refillIntervalMs;

    for (let i = 0; i < this.config.slotCount; i += 1) {
      this.slots[i] = this.createDart();
    }

    this.createRefillTimer();
  }

  createRefillTimer() {
    this.refillTimer = this.scene.time.addEvent({
      delay: this.refillIntervalMs,
      loop: true,
      callback: this.refillOne,
      callbackScope: this,
    });
  }

  setRefillInterval(ms) {
    if (ms === this.refillIntervalMs) return;

    this.refillIntervalMs = ms;
    if (this.refillTimer) this.refillTimer.remove(false);
    this.createRefillTimer();
  }

  createDart() {
    const dart = this.scene.add.image(
      this.player.gameObject.x,
      this.player.gameObject.y,
      this.config.textureKey,
    );
    dart.setScale(this.config.displayHeight / dart.height);
    dart.setDepth(this.player.gameObject.depth + 1);
    this.scene.physics.world.enable(dart);

    const bodyRadius = dart.height * this.config.bodyRadiusRatio;
    dart.body.setCircle(
      bodyRadius,
      dart.width / 2 - bodyRadius,
      dart.height / 2 - bodyRadius,
    );
    dart.body.setAllowGravity(false);
    return dart;
  }

  getActiveDarts() {
    return this.slots.filter(Boolean);
  }

  consume(dart) {
    const index = this.slots.indexOf(dart);
    if (index === -1) return;
    this.slots[index] = null;
    dart.destroy();
  }

  refillOne() {
    for (let step = 0; step < this.config.slotCount; step += 1) {
      const index = (this.refillCursor + step) % this.config.slotCount;
      if (this.slots[index] !== null) continue;

      this.slots[index] = this.createDart();
      this.refillCursor = (index + 1) % this.config.slotCount;
      this.update(this.scene.time.now);
      return;
    }
  }

  update(time) {
    if (this.startTime === null) {
      this.startTime = time;
      this.centerOffsetX = this.player.gameObject.x - this.player.body.center.x;
      this.centerOffsetY = this.player.gameObject.y - this.player.body.center.y;
    }

    const seconds = (time - this.startTime) / 1000;
    const orbitRotation = Phaser.Math.DegToRad(seconds * this.config.orbitDegreesPerSecond);
    const spin = Phaser.Math.DegToRad(seconds * this.config.spinDegreesPerSecond);
    const centerX = this.player.body.center.x + this.centerOffsetX;
    const centerY = this.player.body.center.y + this.centerOffsetY;

    for (let i = 0; i < this.slots.length; i += 1) {
      const dart = this.slots[i];
      if (!dart) continue;

      const angle = -Math.PI / 2
        + (i * Math.PI * 2) / this.config.slotCount
        + orbitRotation;
      dart.setPosition(
        centerX + Math.cos(angle) * this.config.orbitRadius,
        centerY + Math.sin(angle) * this.config.orbitRadius,
      );
      dart.setRotation(spin);
    }
  }
}
