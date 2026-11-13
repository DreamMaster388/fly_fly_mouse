import Phaser from 'phaser';
import { WEAPONS } from './config.js';

export default class WeaponOrbit {
  constructor(scene, player, typeId = 'dart') {
    this.scene = scene;
    this.player = player;
    this.typeId = typeId;
    // Work on a copy: upgrades change these stats, and a scene restart must
    // start again from the catalogue values.
    this.config = { ...WEAPONS[typeId] };
    this.level = 1;
    this.startTime = null;
    this.orbitPhaseOffsetRad = 0;
    this.centerOffsetX = 0;
    this.centerOffsetY = 0;
    this.slots = new Array(this.config.slotCount).fill(null);
    this.refillCursor = 0;
    this.refillIntervalMs = this.config.refillIntervalMs;

    for (let i = 0; i < this.config.initialCount; i += 1) {
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

  createDart() {
    const dart = this.scene.add.image(
      this.player.gameObject.x,
      this.player.gameObject.y,
      this.config.projectileTextureKey || this.config.textureKey,
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

  findEmptySlot() {
    // Inner ring always refills first; the outer ring only receives darts once
    // every inner slot is full.
    const ringSize = this.config.ringSize || this.config.slotCount;
    const ringCount = this.config.ringCount || 1;
    for (let ring = 0; ring < ringCount; ring += 1) {
      for (let step = 0; step < ringSize; step += 1) {
        const index = ring * ringSize + ((this.refillCursor + step) % ringSize);
        if (index < this.slots.length && this.slots[index] === null) return index;
      }
    }
    return -1;
  }

  refillOne() {
    const count = Math.max(1, this.config.refillCount || 1);
    let added = 0;
    for (let n = 0; n < count; n += 1) {
      const index = this.findEmptySlot();
      if (index === -1) break;

      this.slots[index] = this.createDart();
      this.refillCursor = (index + 1) % Math.max(1, this.config.slotCount);
      added += 1;
    }
    if (added > 0) this.update(this.scene.time.now);
  }

  getUpgradeStep() {
    return this.config.upgradeSteps?.[this.level - 1] || null;
  }

  applyUpgrade(step, level) {
    if (!step) return false;

    if (typeof step.orbitDegreesPerSecond === 'number' && this.startTime !== null) {
      const seconds = (this.scene.time.now - this.startTime) / 1000;
      const previous = this.config.orbitDegreesPerSecond;
      this.orbitPhaseOffsetRad += Phaser.Math.DegToRad(
        seconds * (previous - step.orbitDegreesPerSecond),
      );
    }

    Object.assign(this.config, step);
    this.level = level;

    const targetSlots = this.config.slotCount;
    if (targetSlots > this.slots.length) {
      this.slots.push(...new Array(targetSlots - this.slots.length).fill(null));
    }

    if (step.refillIntervalMs && step.refillIntervalMs !== this.refillIntervalMs) {
      this.refillIntervalMs = step.refillIntervalMs;
      if (this.refillTimer) {
        this.refillTimer.remove(false);
        this.refillTimer = null;
        this.createRefillTimer();
      }
    }

    this.update(this.scene.time.now);
    return true;
  }

  update(time) {
    if (this.startTime === null) {
      this.startTime = time;
      this.centerOffsetX = this.player.gameObject.x - this.player.body.center.x;
      this.centerOffsetY = this.player.gameObject.y - this.player.body.center.y;
    }

    const seconds = (time - this.startTime) / 1000;
    const orbitRotation =
      Phaser.Math.DegToRad(seconds * this.config.orbitDegreesPerSecond) +
      this.orbitPhaseOffsetRad;
    const spin = Phaser.Math.DegToRad(seconds * this.config.spinDegreesPerSecond);
    const centerX = this.player.body.center.x + this.centerOffsetX;
    const centerY = this.player.body.center.y + this.centerOffsetY;
    const ringSize = this.config.ringSize || this.config.slotCount;

    for (let i = 0; i < this.slots.length; i += 1) {
      const dart = this.slots[i];
      if (!dart) continue;

      const ring = Math.floor(i / ringSize);
      const slotInRing = i % ringSize;
      const radius = ring === 0 ? this.config.orbitRadius : this.config.outerOrbitRadius;
      const angle = -Math.PI / 2
        + (slotInRing * Math.PI * 2) / ringSize
        + orbitRotation;
      dart.setPosition(
        centerX + Math.cos(angle) * radius,
        centerY + Math.sin(angle) * radius,
      );
      dart.setRotation(spin);
    }
  }
}
