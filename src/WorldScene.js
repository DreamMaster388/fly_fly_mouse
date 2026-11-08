import Phaser from 'phaser';
import Player from './Player.js';
import WeaponOrbit from './WeaponOrbit.js';
import ZombieManager from './ZombieManager.js';
import Combat from './Combat.js';
import Difficulty from './Difficulty.js';
import Hud from './Hud.js';
import ResultOverlay from './ResultOverlay.js';
import { AUDIO, GAMEPLAY, WEAPONS, ZOMBIES } from './config.js';
import playerTextureUrl from '../resource/character/飞飞鼠完整-透明.png';

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

    for (const weapon of Object.values(WEAPONS)) {
      this.load.image(weapon.textureKey, weapon.textureUrl);
    }

    for (const zombie of Object.values(ZOMBIES)) {
      for (const animation of [zombie.walk, zombie.die]) {
        this.load.spritesheet(animation.textureKey, animation.textureUrl, {
          frameWidth: animation.frameWidth,
          frameHeight: animation.frameHeight,
        });
      }
      this.load.audio(zombie.sounds.hitKey, zombie.sounds.hitUrl);
      this.load.audio(zombie.sounds.dieKey, zombie.sounds.dieUrl);
    }
  }

  create() {
    this.physics.resume();
    this.hp = GAMEPLAY.initialHp;
    this.maxHp = GAMEPLAY.initialHp;
    this.score = 0;
    this.elapsedMs = 0;
    this.gameOver = false;
    this.difficulty = new Difficulty();

    this.cameras.main.setBackgroundColor(0xffffff);
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    for (const [dx, dy] of REFERENCE_OFFSETS) {
      this.add.circle(WORLD_WIDTH / 2 + dx, WORLD_HEIGHT / 2 + dy, 12, 0xff0000);
    }

    this.player = new Player(this, WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
    this.weaponOrbit = new WeaponOrbit(
      this,
      this.player,
      'dart',
      this.difficulty.tier.refillIntervalMs,
    );
    this.cameras.main.startFollow(this.player.gameObject);
    this.cameras.main.centerOn(this.player.gameObject.x, this.player.gameObject.y);
    this.zombieManager = new ZombieManager(this, this.player, this.difficulty, 'walker', {
      onReachPlayer: () => this.handlePlayerHit(),
      onKill: () => this.handleZombieKilled(),
    });
    this.combat = new Combat(this, this.weaponOrbit, this.zombieManager);

    this.hud = new Hud(this);
    this.hud.setHp(this.hp, this.maxHp);
    this.hud.setScore(this.score);
    this.hud.setTime(this.formatTime(this.elapsedMs));
    this.hud.setDifficulty(this.difficulty.tier.name, this.difficulty.tier.color);
  }

  update(time, delta) {
    if (this.gameOver) return;

    this.player.update();
    this.weaponOrbit.update(time);
    this.zombieManager.update();
    this.combat.update();

    this.elapsedMs += delta;
    this.hud.setTime(this.formatTime(this.elapsedMs));

    if (this.difficulty.update(this.elapsedMs)) this.applyDifficulty();
  }

  applyDifficulty() {
    this.hud.setDifficulty(this.difficulty.tier.name, this.difficulty.tier.color);
    this.weaponOrbit.setRefillInterval(this.difficulty.tier.refillIntervalMs);
  }

  handlePlayerHit() {
    if (this.gameOver) return;

    this.hp = Math.max(0, this.hp - GAMEPLAY.contactDamage);
    this.sound.play(AUDIO.chompKey);
    this.hud.setHp(this.hp, this.maxHp);

    if (this.hp <= 0) this.endGame();
  }

  handleZombieKilled() {
    this.score += this.difficulty.tier.killScore;
    this.hud.setScore(this.score);
  }

  endGame() {
    this.gameOver = true;
    this.zombieManager.stop();
    this.physics.pause();
    new ResultOverlay(this, {
      score: this.score,
      survivalTime: this.formatTime(this.elapsedMs),
      onRestart: () => this.scene.restart(),
    });
  }

  formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }
}
