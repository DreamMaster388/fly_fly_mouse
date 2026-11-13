import Phaser from 'phaser';

const SPEED = 300;
const DISPLAY_HEIGHT = 110;
const BODY_RADIUS_RATIO = 0.28;
const BODY_CENTER_Y_RATIO = 0.82;

export default class Player {
  constructor(scene, x, y) {
    this.gameObject = scene.add.image(x, y, 'player');
    this.gameObject.setScale(DISPLAY_HEIGHT / this.gameObject.height);
    scene.physics.world.enable(this.gameObject);
    this.body = this.gameObject.body;

    const sourceWidth = this.gameObject.width;
    const sourceHeight = this.gameObject.height;
    const radius = sourceWidth * BODY_RADIUS_RATIO;
    this.body.setCircle(
      radius,
      sourceWidth / 2 - radius,
      sourceHeight * BODY_CENTER_Y_RATIO - radius,
    );
    this.body.setCollideWorldBounds(true);

    const keyCodes = Phaser.Input.Keyboard.KeyCodes;
    this.cursors = scene.input.keyboard.createCursorKeys();
    this.wasd = scene.input.keyboard.addKeys({
      up: keyCodes.W,
      down: keyCodes.S,
      left: keyCodes.A,
      right: keyCodes.D,
    });
    this.direction = new Phaser.Math.Vector2();
    this.speedMultiplier = 1;
  }

  update() {
    const direction = this.direction.set(0, 0);
    if (this.cursors.left.isDown || this.wasd.left.isDown) direction.x -= 1;
    if (this.cursors.right.isDown || this.wasd.right.isDown) direction.x += 1;
    if (this.cursors.up.isDown || this.wasd.up.isDown) direction.y -= 1;
    if (this.cursors.down.isDown || this.wasd.down.isDown) direction.y += 1;

    if (direction.x !== 0 || direction.y !== 0) direction.normalize();
    if (direction.x !== 0) this.gameObject.setFlipX(direction.x > 0);
    const speed = SPEED * this.speedMultiplier;
    this.body.velocity.set(direction.x * speed, direction.y * speed);
  }
}
