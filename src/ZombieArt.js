import Phaser from 'phaser';
import { ZOMBIE_REANIM } from './zombieReanimData.js';
import { ZOMBIE_ARM_BONE_ASSET, ZOMBIE_PART_ASSETS } from './zombieArtAssets.js';

const DEG_TO_RAD = Math.PI / 180;
const TEXTURE_KEYS = new Map(ZOMBIE_PART_ASSETS.map((asset) => [asset.partKey, asset.key]));
const ARM_PARTS = ['outerarm_hand', 'outerarm_upper', 'outerarm_lower'];
const BONE_SCALE = 1.2;
const BONE_OFFSET = { x: 0, y: 12 };

/**
 * Renders the normal zombie from the original Plants vs Zombies reanim parts.
 * Every part is a top-left anchored image inside a container; the reanim data
 * already contains the resolved per-frame transforms (x, y, rotation, scale).
 */
export default class ZombieArt {
  constructor(scene, x, y, { scale = 1, depth = 0, decorations = {} } = {}) {
    this.scene = scene;
    this.scale = scale;
    this.depth = depth;
    this.container = scene.add.container(x, y);
    this.container.setDepth(depth);
    this.container.setScale(scale);

    this.decorations = {
      mustache: !!decorations.mustache,
      tongue: !!decorations.tongue,
    };

    this.sprites = {};
    for (const partKey of ZOMBIE_REANIM.drawOrder) {
      const sprite = scene.add.image(0, 0, TEXTURE_KEYS.get(partKey));
      sprite.setOrigin(0, 0);
      sprite.setVisible(false);
      this.container.add(sprite);
      this.sprites[partKey] = sprite;
    }

    // Drawn above the jacket so the stump shows through the torn shoulder.
    this.boneSprite = scene.add.image(0, 0, ZOMBIE_ARM_BONE_ASSET.key);
    this.boneSprite.setOrigin(0, 0);
    this.boneSprite.setVisible(false);
    this.container.add(this.boneSprite);

    this.frame = 0;
    this.poses = ZOMBIE_REANIM.frames[0];
    this.animationName = null;
    this.animation = null;
    this.onComplete = null;
    this.timer = null;
    this.facingRight = false;
    this.armLost = false;

    this.applyFrame(0);
  }

  setPosition(x, y) {
    this.container.setPosition(x, y);
  }

  setDepth(depth) {
    this.depth = depth;
    this.container.setDepth(depth);
  }

  setFacing(right) {
    if (this.facingRight === right) return;
    this.facingRight = right;
    this.container.setScale(right ? -this.scale : this.scale, this.scale);
  }

  play(name, { fps, onComplete } = {}) {
    const config = ZOMBIE_REANIM.animations[name];
    if (!config) return;

    this.stopTimer();
    this.animation = { ...config, name, fps: fps ?? config.fps };
    this.animationName = name;
    this.onComplete = onComplete || null;
    this.applyFrame(config.start);

    this.timer = this.scene.time.addEvent({
      delay: 1000 / this.animation.fps,
      loop: true,
      callback: this.advance,
      callbackScope: this,
    });
  }

  advance() {
    const animation = this.animation;
    if (!animation) return;

    let next = this.frame + 1;
    if (next > animation.end) {
      if (animation.loop) {
        next = animation.start;
      } else {
        this.stopTimer();
        this.applyFrame(animation.end);
        const done = this.onComplete;
        this.animation = null;
        this.animationName = null;
        this.onComplete = null;
        if (done) done();
        return;
      }
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
    this.animation = null;
    this.animationName = null;
    this.onComplete = null;
  }

  applyFrame(frame) {
    const poses = ZOMBIE_REANIM.frames[frame] || {};
    const [anchorX, anchorY] = ZOMBIE_REANIM.anchor;
    this.frame = frame;
    this.poses = poses;

    for (const partKey of ZOMBIE_REANIM.drawOrder) {
      const sprite = this.sprites[partKey];
      const pose = poses[partKey];
      const hidden =
        !pose || !this.isDecorationVisible(partKey) || (this.armLost && ARM_PARTS.includes(partKey));

      if (hidden) {
        sprite.setVisible(false);
        continue;
      }

      sprite.setVisible(true);
      sprite.setPosition(pose[0] - anchorX, pose[1] - anchorY);
      sprite.setRotation(pose[2] * DEG_TO_RAD);
      sprite.setScale(pose[3], pose[4]);
    }

    this.applyBone(poses, anchorX, anchorY);
  }

  applyBone(poses, anchorX, anchorY) {
    const upper = poses.outerarm_upper;
    if (!this.armLost || !upper) {
      this.boneSprite.setVisible(false);
      return;
    }

    this.boneSprite.setVisible(true);
    this.boneSprite.setPosition(
      upper[0] - anchorX + BONE_OFFSET.x,
      upper[1] - anchorY + BONE_OFFSET.y,
    );
    this.boneSprite.setRotation(upper[2] * DEG_TO_RAD);
    this.boneSprite.setScale(upper[3] * BONE_SCALE, upper[4] * BONE_SCALE);
  }

  isDecorationVisible(partKey) {
    if (partKey === 'mustache') return this.decorations.mustache;
    if (partKey === 'tongue') return this.decorations.tongue;
    return true;
  }

  setArmLost(lost = true) {
    if (this.armLost === lost) return;
    this.armLost = lost;
    this.applyFrame(this.frame);
  }

  getPose(partKey) {
    return this.poses[partKey] || null;
  }

  getWorldPoint(artX, artY) {
    const [anchorX, anchorY] = ZOMBIE_REANIM.anchor;
    return {
      x: this.container.x + (artX - anchorX) * this.container.scaleX,
      y: this.container.y + (artY - anchorY) * this.container.scaleY,
    };
  }

  flash(tint) {
    for (const sprite of Object.values(this.sprites)) sprite.setTint(tint);
    this.boneSprite.setTint(tint);
  }

  clearTint() {
    for (const sprite of Object.values(this.sprites)) sprite.clearTint();
    this.boneSprite.clearTint();
  }

  destroy() {
    this.stop();
    if (this.container.active) this.container.destroy();
  }
}

export { ARM_PARTS };
