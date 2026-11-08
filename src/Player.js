import Phaser from 'phaser';

const SPEED = 300;
const RADIUS = 20;

export default class Player {
  constructor(scene, x, y) {
    this.gameObject = scene.add.circle(x, y, RADIUS, 0x000000);
    scene.physics.world.enable(this.gameObject);
    this.body = this.gameObject.body;
    this.body.setCircle(RADIUS);
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
  }

  update() {
    const direction = this.direction.set(0, 0);
    if (this.cursors.left.isDown || this.wasd.left.isDown) direction.x -= 1;
    if (this.cursors.right.isDown || this.wasd.right.isDown) direction.x += 1;
    if (this.cursors.up.isDown || this.wasd.up.isDown) direction.y -= 1;
    if (this.cursors.down.isDown || this.wasd.down.isDown) direction.y += 1;

    if (direction.x !== 0 || direction.y !== 0) direction.normalize();
    this.body.velocity.set(direction.x * SPEED, direction.y * SPEED);
  }
}
