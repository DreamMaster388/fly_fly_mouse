import { ZOMBIES } from './config.js';

export default class Zombie {
  constructor(scene, x, y, typeId = 'walker', stats, onDeath = null) {
    this.scene = scene;
    this.config = ZOMBIES[typeId];
    this.onDeath = onDeath;
    this.speed = stats.speed;
    this.hp = stats.maxHp;
    this.dead = false;
    this.flashTimer = null;

    this.gameObject = scene.add.sprite(x, y, this.config.walk.textureKey);
    this.gameObject.setScale(this.config.displayHeight / this.gameObject.height);
    this.gameObject.setDepth(this.config.depth);
    scene.physics.world.enable(this.gameObject);
    this.body = this.gameObject.body;

    this.body.setCircle(
      this.config.body.radius,
      this.config.body.offsetX,
      this.config.body.offsetY,
    );
    this.body.setCollideWorldBounds(true);
    this.gameObject.play(this.config.walk.animationKey);
  }

  update(player) {
    if (this.dead) return;

    const dx = player.x - this.gameObject.x;
    const dy = player.y - this.gameObject.y;
    const distance = Math.hypot(dx, dy);

    if (distance > 0) {
      this.body.velocity.set(
        (dx / distance) * this.speed,
        (dy / distance) * this.speed,
      );
    } else {
      this.body.velocity.set(0, 0);
    }

    if (Math.abs(this.body.velocity.x) >= this.config.minFlipSpeed) {
      this.gameObject.setFlipX(this.body.velocity.x > 0);
    }
  }

  takeDamage(amount) {
    if (this.dead) return;

    this.hp -= amount;
    if (this.hp <= 0) {
      this.die();
      return;
    }

    this.flash();
    this.scene.sound.play(this.config.sounds.hitKey);
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
    this.dead = true;
    this.hp = 0;

    this.body.velocity.set(0, 0);
    this.body.enable = false;

    if (this.flashTimer) {
      this.flashTimer.remove(false);
      this.flashTimer = null;
    }
    this.gameObject.clearTint();

    this.gameObject.play(this.config.die.animationKey);
    this.gameObject.once(
      `animationcomplete-${this.config.die.animationKey}`,
      () => this.gameObject.destroy(),
    );
    this.scene.sound.play(this.config.sounds.dieKey);

    if (this.onDeath) this.onDeath(this);
  }
}
