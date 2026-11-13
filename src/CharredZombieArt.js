import { CHARRED_ZOMBIE_REANIM } from './zombieCharredData.js';

const DEG_TO_RAD = Math.PI / 180;

/**
 * Plays the Plants vs Zombies ash death (Zombie_charred.reanim) as a sprite
 * strip: the zombie is already charred on frame 0, then crumbles into ash.
 */
export default class CharredZombieArt {
  constructor(scene, x, y, { scale = 1, depth = 0, facingRight = false } = {}) {
    this.scene = scene;
    this.scale = scale;
    this.container = scene.add.container(x, y);
    this.container.setDepth(depth);
    this.container.setScale(facingRight ? -scale : scale, scale);

    this.sprites = [];
    this.frame = -1;
    this.timer = null;
    this.finished = false;
    this.onComplete = null;

    this.applyFrame(0);
  }

  applyFrame(frame) {
    const entries = CHARRED_ZOMBIE_REANIM.frames[frame] || [];
    const [anchorX, anchorY] = CHARRED_ZOMBIE_REANIM.anchor;

    while (this.sprites.length < entries.length) {
      const sprite = this.scene.add.image(0, 0, entries[this.sprites.length][0]);
      sprite.setOrigin(0, 0);
      this.container.add(sprite);
      this.sprites.push(sprite);
    }

    for (let index = 0; index < this.sprites.length; index += 1) {
      const sprite = this.sprites[index];
      const entry = entries[index];
      if (!entry) {
        sprite.setVisible(false);
        continue;
      }

      const [textureKey, x, y, rotation, scaleX, scaleY, alpha] = entry;
      if (sprite.texture.key !== textureKey) sprite.setTexture(textureKey);
      sprite.setVisible(true);
      sprite.setPosition(x - anchorX, y - anchorY);
      sprite.setRotation(rotation * DEG_TO_RAD);
      sprite.setScale(scaleX, scaleY);
      sprite.setAlpha(alpha);
    }

    this.frame = frame;
  }

  play({ onComplete } = {}) {
    this.stop();
    this.onComplete = onComplete || null;
    this.finished = false;
    this.applyFrame(0);
    this.timer = this.scene.time.addEvent({
      delay: 1000 / CHARRED_ZOMBIE_REANIM.fps,
      loop: true,
      callback: this.advance,
      callbackScope: this,
    });
  }

  advance() {
    if (this.finished) return;

    const next = this.frame + 1;
    if (next >= CHARRED_ZOMBIE_REANIM.sourceFrames) {
      this.finished = true;
      this.stopTimer();
      const done = this.onComplete;
      this.onComplete = null;
      if (done) done();
      return;
    }

    this.applyFrame(next);
  }

  stopTimer() {
    if (!this.timer) return;
    this.timer.remove(false);
    this.timer = null;
  }

  stop() {
    this.stopTimer();
    this.onComplete = null;
    this.finished = true;
  }

  fadeOut(duration, onComplete) {
    this.stopTimer();
    this.scene.tweens.add({
      targets: this.container,
      alpha: 0,
      duration,
      ease: 'Quad.easeOut',
      onComplete: () => {
        if (onComplete) onComplete();
      },
    });
  }

  destroy() {
    this.stopTimer();
    if (this.container.active) this.container.destroy();
  }
}
