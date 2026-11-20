import { LOCUSTS } from './config.js';

/**
 * Death puddles left by locusts. A puddle is pure decoration: it has no
 * physics body, never joins the population and only disappears when its
 * lifetime runs out.
 */
export default class Slimes {
  constructor(scene) {
    this.scene = scene;
    this.config = LOCUSTS.locust.slime;
    this.items = [];
    this.ensureAnimation();
  }

  ensureAnimation() {
    const config = this.config;
    if (this.scene.anims.exists(config.animationKey)) return;
    this.scene.anims.create({
      key: config.animationKey,
      frames: this.scene.anims.generateFrameNumbers(config.textureKey, {
        start: 0,
        end: config.frameCount - 1,
      }),
      frameRate: config.frameRate,
      repeat: -1,
    });
  }

  spawn(x, y, scale) {
    const sprite = this.scene.add
      .sprite(x, y, this.config.textureKey)
      .setDepth(this.config.depth)
      .setScale(scale);
    sprite.play(this.config.animationKey);

    const slime = { x, y, sprite, lifetimeTimer: null, nextTouchAt: 0 };
    this.items.push(slime);
    slime.lifetimeTimer = this.scene.time.delayedCall(this.config.lifetimeMs, () =>
      this.fadeOut(slime),
    );
    return slime;
  }

  update(player, time) {
    if (this.scene.gameOver) return;

    const { touchRadius, touchCooldownMs } = this.config;
    const radiusSq = touchRadius * touchRadius;
    const center = player.body.center;

    for (const slime of this.items) {
      if (time < slime.nextTouchAt) continue;
      const dx = center.x - slime.x;
      const dy = center.y - slime.y;
      if (dx * dx + dy * dy > radiusSq) continue;
      slime.nextTouchAt = time + touchCooldownMs;
      this.scene.addSlimeStack();
    }
  }

  fadeOut(slime) {
    this.scene.tweens.add({
      targets: slime.sprite,
      alpha: 0,
      duration: this.config.fadeMs,
      onComplete: () => this.remove(slime),
    });
  }

  remove(slime) {
    const index = this.items.indexOf(slime);
    if (index !== -1) this.items.splice(index, 1);
    if (slime.lifetimeTimer) {
      slime.lifetimeTimer.remove(false);
      slime.lifetimeTimer = null;
    }
    if (slime.sprite && slime.sprite.active) slime.sprite.destroy();
  }
}
