import { LOCUSTS, getEnemyConfig } from './config.js';

function ensureAnimations(scene, config) {
  const animations = [config.walk, config.hurt, config.enrage, config.enrageWalk, config.death];
  for (const animation of animations.filter(Boolean)) {
    if (scene.anims.exists(animation.animationKey)) continue;
    scene.anims.create({
      key: animation.animationKey,
      frames: scene.anims.generateFrameNumbers(animation.textureKey, {
        start: 0,
        end: animation.frameCount - 1,
      }),
      frameRate: animation.frameRate,
      repeat: animation.repeat ?? -1,
    });
  }
}

export default class Locust {
  constructor(scene, x, y, typeId = 'locust', stats = {}, callbacks = {}) {
    this.scene = scene;
    this.typeId = typeId;
    this.config = getEnemyConfig(typeId) || LOCUSTS.locust;
    this.onDeath = callbacks.onDeath || null;
    this.onSelfDestruct = callbacks.onSelfDestruct || null;
    this.baseSpeed = stats.speed ?? this.config.speed;
    this.maxHp = stats.maxHp ?? this.config.maxHp;
    this.hp = this.maxHp;
    this.dead = false;
    this.destroyed = false;
    this.injured = false;
    this.enraged = false;
    this.enraging = false;
    this.flashTimer = null;
    this.exploded = false;
    this.selfDestructed = false;
    this.deathPoint = null;
    this.explosionTimer = null;
    this.currentAnimation = this.config.walk;

    ensureAnimations(scene, this.config);

    this.gameObject = scene.add.sprite(x, y, this.currentAnimation.textureKey);
    this.gameObject.setDepth(this.config.depth);
    this.applyAnimation(this.currentAnimation, { play: true });
    this.standingScale = this.gameObject.scaleX;

    scene.physics.world.enable(this.gameObject);
    this.body = this.gameObject.body;
    this.body.setCircle(
      this.currentAnimation.body.radius,
      this.currentAnimation.body.offsetX,
      this.currentAnimation.body.offsetY,
    );
    this.body.setCollideWorldBounds(true);
    this.setFacing(false);
  }

  update(player, time, delta = 0) {
    if (this.dead) return;

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
      this.selfDestruct();
      return;
    }

    if (this.enraging) {
      this.body.velocity.set(0, 0);
      return;
    }

    const map = this.scene.gameMap;
    const nav = map ? map.navigationTarget(centerX, centerY, targetX, targetY) : null;
    const moveX = nav ? nav.x - centerX : dx;
    const moveY = nav ? nav.y - centerY : dy;
    const moveDistance = Math.hypot(moveX, moveY);

    if (moveDistance > 0) {
      const speed = this.getSpeed() * (map ? map.speedMultiplierAt(centerX, centerY) : 1);
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

  beginEnrage() {
    if (this.enraged || this.injured || this.dead) return;
    this.enraged = true;
    this.enraging = true;
    this.body.velocity.set(0, 0);
    this.applyAnimation(this.config.enrage, { play: true });
    this.gameObject.once(`animationcomplete-${this.config.enrage.animationKey}`, () => {
      if (this.dead || !this.enraging) return;
      this.enraging = false;
      this.applyAnimation(this.config.enrageWalk, { play: true });
    });
  }

  getSpeed() {
    if (this.enraged) return this.baseSpeed * this.config.enrageSpeedMultiplier;
    return this.baseSpeed * (this.injured ? this.config.injuredSpeedMultiplier : 1);
  }

  takeDamage(amount) {
    if (this.dead) return;

    this.hp -= amount;
    if (this.hp <= 0) {
      this.die();
      return;
    }

    if (!this.enraged && !this.injured && this.hp <= this.maxHp * this.config.injuredHpRatio) {
      this.enterInjured();
    }

    this.flash();
    this.playSound(this.config.sounds.hitKey);
  }

  enterInjured() {
    if (this.injured || this.enraged) return;
    this.injured = true;
    this.applyAnimation(this.config.hurt, { play: true });
  }

  flash() {
    if (this.flashTimer) return;

    this.gameObject.setTint(this.config.flashTint);
    this.flashTimer = this.scene.time.delayedCall(this.config.flashDurationMs, () => {
      this.flashTimer = null;
      if (!this.dead && this.gameObject.active) this.gameObject.clearTint();
    });
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.enraging = false;
    this.hp = 0;
    this.deathPoint = { x: this.body.center.x, y: this.body.center.y };

    this.body.velocity.set(0, 0);
    this.body.enable = false;
    this.clearFlash();
    this.gameObject.clearTint();
    this.playDeathAnimation();
    this.playSound(this.config.sounds.dieKey);
    this.scheduleExplosion();

    if (this.onDeath) this.onDeath(this);
  }

  scheduleExplosion() {
    this.explosionTimer = this.scene.time.delayedCall(
      this.config.explosion.atMs,
      () => this.explode(),
    );
  }

  explode() {
    if (this.exploded || this.scene.gameOver) return;
    this.exploded = true;
    this.scene.handleLocustExplosion(this);
  }

  playDeathAnimation() {
    const death = this.config.death;
    this.currentAnimation = death;
    this.gameObject.setTexture(death.textureKey, 0);
    this.gameObject.setScale(this.standingScale);
    this.gameObject.play(death.animationKey);
    this.gameObject.once(`animationcomplete-${death.animationKey}`, () => {
      this.scene.slimes.spawn(this.deathPoint.x, this.deathPoint.y, this.standingScale);
      this.destroy();
    });
  }

  selfDestruct() {
    if (this.dead) return;
    this.selfDestructed = true;
    this.die();
  }

  applyAnimation(animation, { play }) {
    this.currentAnimation = animation;
    this.gameObject.setTexture(animation.textureKey, 0);
    this.gameObject.setScale(this.config.displayHeight / this.gameObject.height);
    if (this.body) {
      this.body.setCircle(
        animation.body.radius,
        animation.body.offsetX,
        animation.body.offsetY,
      );
    }
    if (play) this.gameObject.play(animation.animationKey, true);
  }

  setFacing(right) {
    this.gameObject.setFlipX(right);
  }

  clearFlash() {
    if (!this.flashTimer) return;
    this.flashTimer.remove(false);
    this.flashTimer = null;
  }

  playSound(key) {
    const sound = this.scene.sound.add(key);
    sound.once('complete', () => sound.destroy());
    sound.play();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearFlash();
    if (this.explosionTimer) {
      this.explosionTimer.remove(false);
      this.explosionTimer = null;
    }
    if (this.gameObject && this.gameObject.active) this.gameObject.destroy();
  }
}