import Phaser from 'phaser';

const DART_COUNT = 8;
const ORBIT_RADIUS = 90;
const DART_DISPLAY_HEIGHT = 27;
const ORBIT_DEGREES_PER_SECOND = 90;
const SPIN_DEGREES_PER_SECOND = 360;
const BODY_RADIUS_RATIO = 0.35;

export default class WeaponOrbit {
  constructor(scene, player) {
    this.player = player;
    this.startTime = null;
    this.centerOffsetX = 0;
    this.centerOffsetY = 0;
    this.darts = [];

    for (let i = 0; i < DART_COUNT; i += 1) {
      const dart = scene.add.image(player.gameObject.x, player.gameObject.y, 'dart');
      dart.setScale(DART_DISPLAY_HEIGHT / dart.height);
      dart.setDepth(player.gameObject.depth + 1);
      scene.physics.world.enable(dart);

      const bodyRadius = dart.height * BODY_RADIUS_RATIO;
      dart.body.setCircle(
        bodyRadius,
        dart.width / 2 - bodyRadius,
        dart.height / 2 - bodyRadius,
      );
      dart.body.setAllowGravity(false);
      this.darts.push(dart);
    }
  }

  update(time) {
    if (this.startTime === null) {
      this.startTime = time;
      this.centerOffsetX = this.player.gameObject.x - this.player.body.center.x;
      this.centerOffsetY = this.player.gameObject.y - this.player.body.center.y;
    }

    const seconds = (time - this.startTime) / 1000;
    const orbitRotation = Phaser.Math.DegToRad(seconds * ORBIT_DEGREES_PER_SECOND);
    const spin = Phaser.Math.DegToRad(seconds * SPIN_DEGREES_PER_SECOND);
    const centerX = this.player.body.center.x + this.centerOffsetX;
    const centerY = this.player.body.center.y + this.centerOffsetY;

    for (let i = 0; i < this.darts.length; i += 1) {
      const dart = this.darts[i];
      const angle = -Math.PI / 2 + (i * Math.PI * 2) / DART_COUNT + orbitRotation;
      dart.setPosition(
        centerX + Math.cos(angle) * ORBIT_RADIUS,
        centerY + Math.sin(angle) * ORBIT_RADIUS,
      );
      dart.setRotation(spin);
    }
  }
}
