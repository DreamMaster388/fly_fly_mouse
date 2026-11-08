import Phaser from 'phaser';
import Player from './Player.js';
import WeaponOrbit from './WeaponOrbit.js';
import ZombieManager from './ZombieManager.js';
import playerTextureUrl from '../resource/character/飞飞鼠完整-透明.png';
import dartTextureUrl from '../resource/weapon/武器-飞镖-透明.png';
import zombieSpritesheetUrl from '../resource/enemy/zombie-walk-spritesheet.png';

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
    this.load.image('dart', dartTextureUrl);
    this.load.spritesheet('zombie', zombieSpritesheetUrl, {
      frameWidth: 166,
      frameHeight: 144,
    });
  }

  create() {
    this.cameras.main.setBackgroundColor(0xffffff);
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    for (const [dx, dy] of REFERENCE_OFFSETS) {
      this.add.circle(WORLD_WIDTH / 2 + dx, WORLD_HEIGHT / 2 + dy, 12, 0xff0000);
    }

    this.player = new Player(this, WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
    this.weaponOrbit = new WeaponOrbit(this, this.player);
    this.cameras.main.startFollow(this.player.gameObject);
    this.cameras.main.centerOn(this.player.gameObject.x, this.player.gameObject.y);
    this.zombieManager = new ZombieManager(this, this.player);
  }

  update(time) {
    this.player.update();
    this.weaponOrbit.update(time);
    this.zombieManager.update();
  }
}
