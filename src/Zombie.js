import { DAMAGE_TYPES, ZOMBIES } from './config.js';
import ZombieArt, { ARM_PARTS } from './ZombieArt.js';
import CharredZombieArt from './CharredZombieArt.js';
import { CHARRED_ZOMBIE_REANIM } from './zombieCharredData.js';
import { ZOMBIE_REANIM } from './zombieReanimData.js';

const DEG_TO_RAD = Math.PI / 180;
// Same back-to-front order as the reanim: head, jaw, tongue, mustache, then hair.
const FLYING_HEAD_PARTS = ['head', 'jaw', 'tongue', 'mustache', 'hair'];

export default class Zombie {
  constructor(scene, x, y, typeId = 'normal', stats = {}, callbacks = {}) {
    this.scene = scene;
    this.config = ZOMBIES[typeId];
    this.onDeath = callbacks.onDeath || null;
    this.onAttack = callbacks.onAttack || null;
    this.speed = stats.speed ?? this.config.speed;
    this.maxHp = stats.maxHp ?? this.config.maxHp;
    this.hp = this.maxHp;
    this.dead = false;
    this.attacking = false;
    this.lastDamageType = null;
    this.nextAttackAt = 0;
    this.flashTimer = null;
    this.headSprite = null;
    this.charredArt = null;
    this.armLost = false;
    this.destroyed = false;

    const variants = this.config.walk.variants;
    const variantIndex = Number.isInteger(stats.walkVariant)
      ? stats.walkVariant % variants.length
      : Math.floor(Math.random() * variants.length);
    this.walkConfig = variants[variantIndex];
    this.walkAnimationName = variantIndex % 2 === 0 ? 'walk' : 'walk2';

    const decorations = this.config.decorations || {};
    this.hasMustache =
      typeof stats.mustache === 'boolean'
        ? stats.mustache
        : Math.random() < (decorations.mustacheChance ?? 0);
    this.hasTongue =
      typeof stats.tongue === 'boolean'
        ? stats.tongue
        : Math.random() < (decorations.tongueChance ?? 0);

    // The legacy frame stays as an invisible Arcade physics proxy so the
    // zombie body radius, offsets and every collision path remain unchanged.
    this.gameObject = scene.add.sprite(x, y, this.walkConfig.textureKey);
    this.gameObject.setScale(this.config.displayHeight / this.gameObject.height);
    this.gameObject.setDepth(this.config.depth);
    this.gameObject.setVisible(false);
    scene.physics.world.enable(this.gameObject);
    this.body = this.gameObject.body;

    this.body.setCircle(
      this.config.body.radius,
      this.config.body.offsetX,
      this.config.body.offsetY,
    );
    this.body.setCollideWorldBounds(true);
    // Legacy spritesheet animation (superseded by the reanim parts below):
    // this.gameObject.play(this.walkConfig.animationKey);

    this.art = new ZombieArt(scene, x, y, {
      scale: this.config.displayHeight / ZOMBIE_REANIM.imageHeight,
      depth: this.config.depth,
      decorations: { mustache: this.hasMustache, tongue: this.hasTongue },
    });
    this.art.setFacing(false);
    this.art.play(this.walkAnimationName);
    this.syncArt();
  }

  update(player, time = this.scene.time.now) {
    if (this.dead) return;

    this.syncArt();

    const playerBody = player.body;
    const targetX = playerBody ? playerBody.center.x : player.x;
    const targetY = playerBody ? playerBody.center.y : player.y;
    const centerX = this.body.center.x;
    const centerY = this.body.center.y;
    const dx = targetX - centerX;
    const dy = targetY - centerY;
    const distance = Math.hypot(dx, dy);
    const contactRange = playerBody
      ? this.body.halfWidth + playerBody.halfWidth + this.config.contact.rangePadding
      : this.body.halfWidth + this.config.contact.rangePadding;

    if (distance <= contactRange) {
      this.updateAttack(time, dx);
      return;
    }

    if (this.attacking) this.stopAttack();

    const map = this.scene.gameMap;
    const nav = map ? map.navigationTarget(centerX, centerY, targetX, targetY) : null;
    const moveX = nav ? nav.x - centerX : dx;
    const moveY = nav ? nav.y - centerY : dy;
    const moveDistance = Math.hypot(moveX, moveY);

    if (moveDistance > 0) {
      const speed = this.speed * (map ? map.speedMultiplierAt(centerX, centerY) : 1);
      this.body.velocity.set(
        (moveX / moveDistance) * speed,
        (moveY / moveDistance) * speed,
      );
    } else {
      this.body.velocity.set(0, 0);
    }

    if (Math.abs(this.body.velocity.x) >= this.config.minFlipSpeed) {
      this.setFacing(this.body.velocity.x > 0);
    }
  }

  updateAttack(time, dx) {
    this.body.velocity.set(0, 0);

    if (dx !== 0) this.setFacing(dx > 0);

    if (!this.attacking) {
      this.attacking = true;
      this.nextAttackAt = time;
      // Legacy spritesheet animation:
      // this.gameObject.play(this.config.attack.animationKey, true);
      this.art.play('eat');
    }

    if (time >= this.nextAttackAt) {
      this.nextAttackAt = time + this.config.contact.intervalMs;
      if (this.onAttack) this.onAttack(this);
    }
  }

  stopAttack() {
    this.attacking = false;
    this.nextAttackAt = 0;
    // Legacy spritesheet animation:
    // this.gameObject.play(this.walkConfig.animationKey, true);
    this.art.play(this.walkAnimationName);
  }

  setFacing(right) {
    this.gameObject.setFlipX(right);
    this.art.setFacing(right);
  }

  syncArt() {
    if (!this.art || !this.body) return;
    this.art.setPosition(this.body.center.x, this.body.center.y);
  }

  takeDamage(amount, type = DAMAGE_TYPES.normal) {
    if (this.dead) return;

    this.lastDamageType = type;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.die();
      return;
    }

    if (!this.armLost && this.hp <= this.maxHp / 2) this.loseArm();

    this.flash();
    this.playSound(this.config.sounds.hitKey);
  }

  loseArm() {
    if (this.armLost) return;
    this.armLost = true;
    this.art.setArmLost(true);
    this.spawnFallingArm();
  }

  spawnFallingArm() {
    const upper = this.art.getPose('outerarm_upper');
    if (!upper) return;

    const origin = this.art.getWorldPoint(upper[0], upper[1]);
    const container = this.scene.add.container(origin.x, origin.y);
    container.setDepth(this.config.depth + 0.1);
    container.setScale(this.art.container.scaleX, this.art.container.scaleY);

    for (const partKey of ARM_PARTS) {
      const pose = this.art.getPose(partKey);
      if (!pose) continue;
      const sprite = this.scene.add.image(
        pose[0] - upper[0],
        pose[1] - upper[1],
        ZOMBIE_REANIM.parts[partKey].key,
      );
      sprite.setOrigin(0, 0);
      sprite.setRotation(pose[2] * DEG_TO_RAD);
      sprite.setScale(pose[3], pose[4]);
      container.add(sprite);
    }

    const direction = this.art.facingRight ? 1 : -1;
    this.scene.tweens.add({
      targets: container,
      x: origin.x - direction * 18,
      y: origin.y + 110,
      angle: direction * 150,
      alpha: 0,
      duration: 700,
      ease: 'Quad.easeIn',
      onComplete: () => container.destroy(),
    });
  }

  playSound(key) {
    const sound = this.scene.sound.add(key);
    sound.once('complete', () => sound.destroy());
    sound.play();
  }

  flash() {
    if (this.flashTimer) return;

    this.gameObject.setTint(this.config.flashTint);
    this.art.flash(this.config.flashTint);
    this.flashTimer = this.scene.time.delayedCall(this.config.flashDurationMs, () => {
      this.flashTimer = null;
      if (!this.dead && this.gameObject.active) this.gameObject.clearTint();
      if (!this.dead && this.art) this.art.clearTint();
    });
  }

  die() {
    this.dead = true;
    this.attacking = false;
    this.hp = 0;

    this.body.velocity.set(0, 0);
    this.body.enable = false;

    if (this.flashTimer) {
      this.flashTimer.remove(false);
      this.flashTimer = null;
    }
    this.gameObject.clearTint();
    this.art.clearTint();
    this.syncArt();

    const specialDeath = this.config.specialDeaths?.[this.lastDamageType];
    const charred = specialDeath === 'charred' && this.playCharredDeath();

    if (!charred) {
      this.spawnFlyingHead();

      const deathAnimation = Math.random() < 0.5 ? 'death' : 'death2';
      this.art.play(deathAnimation, { onComplete: () => this.destroy() });
    }
    // Legacy spritesheet death animation:
    // this.createHead();
    // this.gameObject.play(this.config.die.animationKey);
    // this.gameObject.once(
    //   `animationcomplete-${this.config.die.animationKey}`,
    //   () => {
    //     if (this.headSprite) {
    //       this.headSprite.destroy();
    //       this.headSprite = null;
    //     }
    //     this.gameObject.destroy();
    //   },
    // );
    this.playSound(this.config.sounds.dieKey);

    if (this.onDeath) this.onDeath(this);
  }

  playCharredDeath() {
    if (!this.art) return false;

    const center = this.body.center;
    const facingRight = this.art.facingRight;
    const scale = this.config.displayHeight / CHARRED_ZOMBIE_REANIM.imageHeight;

    this.art.destroy();
    this.art = null;

    this.charredArt = new CharredZombieArt(this.scene, center.x, center.y, {
      scale,
      depth: this.config.depth,
      facingRight,
    });
    this.charredArt.play({
      onComplete: () => {
        if (!this.charredArt) return;
        this.charredArt.fadeOut(260, () => this.destroy());
      },
    });
    return true;
  }

  spawnFlyingHead() {
    const poses = this.art.poses;
    const headPose = poses.head;
    if (!headPose) return;

    const headMeta = ZOMBIE_REANIM.parts.head;
    const headCenterX = headPose[0] + (headMeta.width * headPose[3]) / 2;
    const headCenterY = headPose[1] + (headMeta.height * headPose[4]) / 2;
    const origin = this.art.getWorldPoint(headCenterX, headCenterY);
    // The reanim art faces left; a right-facing zombie is the mirrored (-x)
    // container, so the detached head has to reuse that same signed scale.
    const direction = this.art.facingRight ? -1 : 1;

    const container = this.scene.add.container(origin.x, origin.y);
    container.setDepth(this.config.depth + 0.1);
    container.setScale(direction * this.art.scale, this.art.scale);

    for (const partKey of FLYING_HEAD_PARTS) {
      const pose = poses[partKey];
      // Only the decorations this zombie actually wears fly off with its head.
      if (!pose || !this.art.isDecorationVisible(partKey)) continue;
      const sprite = this.scene.add.image(
        pose[0] - headCenterX,
        pose[1] - headCenterY,
        ZOMBIE_REANIM.parts[partKey].key,
      );
      sprite.setOrigin(0, 0);
      sprite.setRotation(pose[2] * DEG_TO_RAD);
      sprite.setScale(pose[3], pose[4]);
      container.add(sprite);
    }

    this.headSprite = container;

    this.scene.tweens.add({
      targets: container,
      x: origin.x - direction * 12,
      y: origin.y - 14,
      angle: direction * 45,
      duration: 200,
      ease: 'Quad.easeOut',
      onComplete: () => {
        if (!container.active) return;
        this.scene.tweens.add({
          targets: container,
          x: origin.x - direction * 34,
          y: origin.y + 92,
          angle: direction * 150,
          alpha: 0,
          duration: 680,
          ease: 'Quad.easeIn',
          onComplete: () => container.destroy(),
        });
      },
    });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;

    if (this.headSprite && this.headSprite.active) this.headSprite.destroy();
    this.headSprite = null;

    if (this.art) {
      this.art.destroy();
      this.art = null;
    }

    if (this.charredArt) {
      this.charredArt.destroy();
      this.charredArt = null;
    }

    if (this.gameObject && this.gameObject.active) this.gameObject.destroy();
  }

  // Legacy head split (superseded by spawnFlyingHead):
  // createHead() {
  //   const scale = this.gameObject.scaleX;
  //   const direction = this.gameObject.flipX ? -1 : 1;
  //   const { neckOffset } = this.config.head;
  //
  //   const head = this.scene.add.sprite(
  //     this.gameObject.x + direction * neckOffset.x * scale,
  //     this.gameObject.y + neckOffset.y * scale,
  //     this.config.head.textureKey,
  //   );
  //   head.setScale(scale);
  //   head.setFlipX(this.gameObject.flipX);
  //   head.setDepth(this.gameObject.depth);
  //   head.play(this.config.head.animationKey);
  //   this.headSprite = head;
  // }
}
