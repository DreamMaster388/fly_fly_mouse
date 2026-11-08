import Phaser from 'phaser';
import Player from './Player.js';
import playerTextureUrl from '../resource/飞飞鼠完整-透明.png';

export const WORLD_WIDTH = 2000;
export const WORLD_HEIGHT = 2000;

const REFERENCE_OFFSETS = [
  [-400, -200],
  [400, -200],
  [-400, 200],
  [400, 200],
];

export default class WorldScene extends Phaser.Scene {
  constructor() {
    super('world');
  }

  preload() {
    this.load.image('player', playerTextureUrl);
  }

  create() {
    this.cameras.main.setBackgroundColor(0xffffff);
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    for (const [dx, dy] of REFERENCE_OFFSETS) {
      this.add.circle(WORLD_WIDTH / 2 + dx, WORLD_HEIGHT / 2 + dy, 12, 0xff0000);
    }

    this.player = new Player(this, WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
    this.cameras.main.startFollow(this.player.gameObject);
  }

  update() {
    this.player.update();
  }
}
