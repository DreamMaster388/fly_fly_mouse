import { DOGS, getEnemyConfig } from './config.js';

function ensureAnimations(scene, config) {
  for (const animation of [config.walk, config.howl, config.angry, config.angryWalk]) {
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

export default class Dog {
  constructor(scene, x, y, typeId = 'dog', stats = {}, callbacks = {}) {
    this.scene = scene;
    this.typeId = typeId;
    this.config = getEnemyConfig(typeId) || DOGS.dog;
    this.onDeath = callbacks.onDeath || null;
    this.onContact = callbacks.onContact || null;
    this.baseSpeed = stats.speed ?? this.config.speed;
    this.maxHp = stats.maxHp ?? this.config.maxHp;
    this.hp = this.maxHp;
    this.dead = false;
    this.destroyed = false;
    this.selfDestructed = false;
    this.phase = 'walk';
    this.seen = false;
    this.seenMs = 0;
    this.howled = false;
    this.enraged = false;
    this.enraging = false;
    this.waitTimer = null;
    this.flashTimer = null;
    this.fadeTween = null;
    this.currentAnimation = this.config.walk;

    ensureAnimations(scene, this.config);

    this.gameObject = scene.add.sprite(x, y, this.currentAnimation.textureKey);
    this.gameObject.setDepth(this.config.depth);
    this.applyAnimation(this.currentAnimation, { play: true });

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
      this.touchPlayer();
      return;
    }

    if (!this.enraged) {
      if (!this.seen) {
        const camera = this.scene.cameras.main;
        if (camera && camera.worldView.contains(centerX, centerY)) this.seen = true;
      }

      if (this.seen && !this.howled) {
        this.seenMs += delta;
        if (this.seenMs >= this.config.howlDelayMs) {
          this.beginHowl();
          return;
        }
      }
    }

    if (this.phase !== 'walk' && this.phase !== 'chase') {
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

  beginHowl() {
    if (this.dead || this.howled || this.enraged) return;
    this.howled = true;
    this.phase = 'howl';
    this.body.velocity.set(0, 0);
    this.applyAnimation(this.config.howl, { play: true });
    if (this.scene.handleDogHowl) this.scene.handleDogHowl();
    this.gameObject.once(`animationcomplete-${this.config.howl.animationKey}`, () => {
      if (this.dead) return;
      this.finishHowl();
    });
  }

  finishHowl() {
    if (this.dead || this.enraged) return;
    this.phase = 'wait';
    this.body.velocity.set(0, 0);
    this.applyAnimation(this.config.walk, { play: false });
    this.waitTimer = this.scene.time.delayedCall(this.config.howlWaitMs, () => {
      this.waitTimer = null;
      this.beginAngry();
    });
  }

  beginAngry() {
    if (this.dead || this.destroyed || this.enraged) return;
    this.clearWaitTimer();
    this.phase = 'angry';
    this.enraged = true;
    this.enraging = true;
    this.body.velocity.set(0, 0);
    this.applyAnimation(this.config.angry, { play: true });
    this.gameObject.once(`animationcomplete-${this.config.angry.animationKey}`, () => {
      if (this.dead) return;
      this.finishEnrage();
    });
  }

  finishEnrage() {
    if (this.dead) return;
    this.enraging = false;
    this.phase = 'chase';
    this.applyAnimation(this.config.angryWalk, { play: true });
  }

  touchPlayer() {
    this.selfDestructed = true;
    this.body.velocity.set(0, 0);
    if (this.onContact) this.onContact(this);
    this.die();
  }

  getSpeed() {
    return this.baseSpeed * (this.enraged ? this.config.enrageSpeedMultiplier : 1);
  }

  takeDamage(amount) {
    if (this.dead) return;

    this.hp -= amount;
    if (this.hp <= 0) {
      this.die();
      return;
    }

    this.flash();
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
    this.phase = 'dead';
    this.enraging = false;
    this.hp = 0;
    this.body.velocity.set(0, 0);
    this.body.enable = false;
    this.clearWaitTimer();
    this.clearFlash();
    this.gameObject.clearTint();
    this.gameObject.anims.stop();

    if (this.onDeath) this.onDeath(this);
    this.fadeOut();
  }

  fadeOut() {
    this.fadeTween = this.scene.tweens.add({
      targets: this.gameObject,
      alpha: 0,
      duration: this.config.fadeMs,
      onComplete: () => {
        this.fadeTween = null;
        this.destroy();
      },
    });
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

  clearWaitTimer() {
    if (!this.waitTimer) return;
    this.waitTimer.remove(false);
    this.waitTimer = null;
  }

  clearFlash() {
    if (!this.flashTimer) return;
    this.flashTimer.remove(false);
    this.flashTimer = null;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearWaitTimer();
    this.clearFlash();
    if (this.fadeTween) {
      this.fadeTween.stop();
      this.fadeTween = null;
    }
    if (this.gameObject && this.gameObject.active) this.gameObject.destroy();
  }
}