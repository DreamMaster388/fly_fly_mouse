const DISPLAY_HEIGHT = 110;
const BODY_RADIUS = 33;
const BODY_OFFSET_X = 50;
const BODY_OFFSET_Y = 78;
const MIN_FLIP_SPEED = 1;

export const ZOMBIE_ANIMATION_KEY = 'zombie-walk';

export default class Zombie {
  constructor(scene, x, y, config) {
    this.config = config;
    this.gameObject = scene.add.sprite(x, y, 'zombie');
    this.gameObject.setScale(DISPLAY_HEIGHT / this.gameObject.height);
    this.gameObject.setDepth(-1);
    scene.physics.world.enable(this.gameObject);
    this.body = this.gameObject.body;

    this.body.setCircle(BODY_RADIUS, BODY_OFFSET_X, BODY_OFFSET_Y);
    this.body.setCollideWorldBounds(true);
    this.gameObject.play(ZOMBIE_ANIMATION_KEY);
  }

  update(player) {
    const dx = player.x - this.gameObject.x;
    const dy = player.y - this.gameObject.y;
    const distance = Math.hypot(dx, dy);

    if (distance > 0) {
      this.body.velocity.set(
        (dx / distance) * this.config.speed,
        (dy / distance) * this.config.speed,
      );
    } else {
      this.body.velocity.set(0, 0);
    }

    if (Math.abs(this.body.velocity.x) >= MIN_FLIP_SPEED) {
      this.gameObject.setFlipX(this.body.velocity.x > 0);
    }
  }
}
