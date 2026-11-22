import Phaser from 'phaser';
import Player from './Player.js';
import WeaponOrbit from './WeaponOrbit.js';
import BombWeapon from './BombWeapon.js';
import ZombieManager from './ZombieManager.js';
import Combat from './Combat.js';
import Population from './Population.js';
import Hud from './Hud.js';
import ResultOverlay from './ResultOverlay.js';
import DevConsole from './DevConsole.js';
import GameMap, { MAP_TEXTURE } from './GameMap.js';
import Minimap from './Minimap.js';
import UiFade from './UiFade.js';
import Slimes from './Slimes.js';
import Inventory, {
  getItem,
  nextUpgradeStats,
} from './items.js';
import { SPAWN, WORLD } from './mapLayout.js';
import { AUDIO, CONSOLE, DOGS, GAMEPLAY, LOCUSTS, MAX_WEAPON_LEVEL, WEAPONS, ZOMBIES } from './config.js';
import { ZOMBIE_ARM_BONE_ASSET, ZOMBIE_PART_ASSETS } from './zombieArtAssets.js';
import { ZOMBIE_CHARRED_ASSETS } from './zombieCharredAssets.js';
import playerTextureUrl from '../resource/character/飞飞鼠完整-透明.png';
import avatarTextureUrl from '../resource/character/avatar.png';
import upgradeButtonUrl from '../resource/ui/upgrade-button.png';

export const WORLD_WIDTH = WORLD.width;
export const WORLD_HEIGHT = WORLD.height;

export default class WorldScene extends Phaser.Scene {
  constructor() {
    super('world');
  }

  preload() {
    this.load.image('player', playerTextureUrl);
    this.load.image('player-avatar', avatarTextureUrl);
    this.load.image('upgrade-button', upgradeButtonUrl);
    this.load.image(MAP_TEXTURE.key, MAP_TEXTURE.url);

    for (const weapon of Object.values(WEAPONS)) {
      this.load.image(weapon.textureKey, weapon.textureUrl);
      if (weapon.projectileTextureKey && weapon.projectileTextureUrl) {
        this.load.image(weapon.projectileTextureKey, weapon.projectileTextureUrl);
      }
      if (weapon.animation) {
        this.load.spritesheet(weapon.animation.textureKey, weapon.animation.textureUrl, {
          frameWidth: weapon.animation.frameWidth,
          frameHeight: weapon.animation.frameHeight,
        });
      }
      if (weapon.explosion) {
        this.load.image(weapon.explosion.textureKey, weapon.explosion.textureUrl);
      }
    }
    for (const asset of ZOMBIE_PART_ASSETS) {
      this.load.image(asset.key, asset.url);
    }
    this.load.image(ZOMBIE_ARM_BONE_ASSET.key, ZOMBIE_ARM_BONE_ASSET.url);
    for (const asset of ZOMBIE_CHARRED_ASSETS) {
      this.load.image(asset.key, asset.url);
    }

    for (const zombie of Object.values(ZOMBIES)) {
      const animations = [
        ...zombie.walk.variants,
        zombie.attack,
        zombie.die,
        zombie.head,
      ];
      for (const animation of animations) {
        this.load.spritesheet(animation.textureKey, animation.textureUrl, {
          frameWidth: animation.frameWidth,
          frameHeight: animation.frameHeight,
        });
      }
      this.load.audio(zombie.sounds.hitKey, zombie.sounds.hitUrl);
      this.load.audio(zombie.sounds.dieKey, zombie.sounds.dieUrl);
    }

    for (const locust of Object.values(LOCUSTS)) {
      for (const animation of [
        locust.walk,
        locust.hurt,
        locust.enrage,
        locust.enrageWalk,
        locust.death,
        locust.slime,
      ]) {
        this.load.spritesheet(animation.textureKey, animation.textureUrl, {
          frameWidth: animation.frameWidth,
          frameHeight: animation.frameHeight,
        });
      }
    }

    for (const dog of Object.values(DOGS)) {
      for (const animation of [dog.walk, dog.howl, dog.angry, dog.angryWalk]) {
        this.load.spritesheet(animation.textureKey, animation.textureUrl, {
          frameWidth: animation.frameWidth,
          frameHeight: animation.frameHeight,
        });
      }
    }
  }

  create() {
    this.physics.resume();
    this.hp = GAMEPLAY.initialHp;
    this.maxHp = GAMEPLAY.initialHp;
    this.level = GAMEPLAY.initialLevel;
    this.xp = 0;
    this.xpToNext = GAMEPLAY.levelXp[this.level - 1];
    this.elapsedMs = 0;
    this.remainingMs = GAMEPLAY.survivalGoalMs;
    this.gameOver = false;
    this.result = null;
    this.hpLocked = false;
    this.slimeStacks = 0;
    this.inventory = new Inventory({ weapons: ['dart'] });
    this.weaponLevels = { dart: 1 };
    this.upgradePoints = 0;

    this.cameras.main.setBackgroundColor(0x2a2118);
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    this.createWeaponAnimations();

    this.gameMap = new GameMap(this);
    this.player = new Player(this, SPAWN.x, SPAWN.y);
    this.population = new Population(GAMEPLAY.maxPopulation);
    this.slimes = new Slimes(this);
    this.weaponInstances = new Map();
    this.weaponOrbit = new WeaponOrbit(this, this.player, 'dart');
    this.weaponInstances.set('dart', this.weaponOrbit);
    this.cameras.main.startFollow(this.player.gameObject);
    this.cameras.main.centerOn(this.player.gameObject.x, this.player.gameObject.y);
    this.physics.add.collider(this.player.gameObject, this.gameMap.colliders);
    this.zombieManager = new ZombieManager(this, this.player, this.population, 'normal', {
      onReachPlayer: (zombie) => this.handlePlayerHit(zombie.config.contact.damage),
      onKill: (zombie) => this.handleZombieKilled(zombie),
    });
    this.physics.add.collider(this.zombieManager.group, this.gameMap.colliders);
    this.combat = new Combat(this, this.weaponOrbit, this.zombieManager);

    this.hud = new Hud(this, {
      hp: this.hp,
      maxHp: this.maxHp,
      level: this.level,
      xp: this.xp,
      xpToNext: this.xpToNext,
      inventory: this.inventory,
    });
    this.hud.setHp(this.hp, this.maxHp);
    this.hud.setTime(this.formatCountdown(this.remainingMs));
    this.minimap = new Minimap(this);

    const slimeConfig = LOCUSTS.locust.slime;
    this.slimeFlash = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, 0xff2b2b, 0)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(1500);
    this.time.addEvent({
      delay: slimeConfig.dotTickMs,
      loop: true,
      callback: this.tickSlimeDamage,
      callbackScope: this,
    });

    if (CONSOLE.enabled) this.devConsole = new DevConsole(this);

    this.uiFade = new UiFade(this, {
      player: this.player,
      zombieManager: this.zombieManager,
    });
    this.uiFade.addTarget('hud', this.hud);
    this.uiFade.addTarget('minimap', this.minimap);
    if (this.devConsole) this.uiFade.addTarget('console', this.devConsole);
  }

  createWeaponAnimations() {
    for (const weapon of Object.values(WEAPONS)) {
      const animation = weapon.animation;
      if (!animation || this.anims.exists(animation.animationKey)) continue;
      this.anims.create({
        key: animation.animationKey,
        frames: this.anims.generateFrameNumbers(animation.textureKey, {
          start: 0,
          end: animation.frameCount - 1,
        }),
        frameRate: animation.frameRate,
        repeat: 0,
      });
    }
  }

  mountWeapon(id) {
    if (this.weaponInstances.has(id)) return this.weaponInstances.get(id);

    const item = getItem(id);
    let weapon = null;
    if (item?.mechanic === 'orbit') {
      weapon = new WeaponOrbit(this, this.player, id);
    } else if (item?.mechanic === 'bomb') {
      weapon = new BombWeapon(this, this.player, this.zombieManager, id);
    }
    if (!weapon) return null;

    this.weaponInstances.set(id, weapon);
    return weapon;
  }

  update(time, delta) {
    if (this.gameOver) return;

    const playerCenter = this.player.body.center;
    this.player.speedMultiplier = this.gameMap.speedMultiplierAt(playerCenter.x, playerCenter.y);
    this.player.update();
    for (const weapon of this.weaponInstances.values()) weapon.update(time);
    this.zombieManager.update(time, delta);
    this.slimes.update(this.player, time);
    this.combat.update();
    this.minimap.update(this.player, this.zombieManager.zombies);
    this.uiFade.update(delta);

    if (this.gameOver) return;

    this.elapsedMs += delta;
    this.remainingMs = Math.max(0, this.remainingMs - delta);
    this.hud.setTime(this.formatCountdown(this.remainingMs));

    if (this.remainingMs <= 0) this.winGame();
  }

  handlePlayerHit(amount) {
    if (this.gameOver || this.hpLocked) return;

    this.hp = Math.max(0, this.hp - amount);
    this.sound.play(AUDIO.chompKey);
    this.hud.setHp(this.hp, this.maxHp);

    if (this.hp <= 0) this.endGame();
  }

  handleDogHowl() {
    const camera = this.cameras.main;
    for (const enemy of this.zombieManager.getLiveZombies()) {
      if (enemy.typeId !== 'locust') continue;
      if (enemy.dead || enemy.enraged || enemy.injured) continue;
      const center = enemy.body.center;
      if (camera.worldView.contains(center.x, center.y)) enemy.beginEnrage();
    }
  }

  handleLocustExplosion(locust) {
    if (this.gameOver) return;

    const { damage, enragedDamage, radius } = locust.config.explosion;
    const blast = locust.deathPoint;
    const center = this.player.body.center;
    if (Math.hypot(center.x - blast.x, center.y - blast.y) <= radius) {
      this.handlePlayerHit(locust.enraged ? enragedDamage : damage);
    }
  }

  addSlimeStack() {
    if (this.gameOver) return;
    this.slimeStacks += 1;
  }

  tickSlimeDamage() {
    if (this.gameOver || this.hpLocked || this.slimeStacks <= 0) return;

    const damage = this.slimeStacks * LOCUSTS.locust.slime.dotDamagePerStack;
    this.hp = Math.max(0, this.hp - damage);
    this.hud.setHp(this.hp, this.maxHp);
    this.flashSlimeDamage();
    if (this.hp <= 0) this.endGame();
  }

  flashSlimeDamage() {
    if (!this.slimeFlash) return;
    this.slimeFlash.setAlpha(0.16);
    this.tweens.add({
      targets: this.slimeFlash,
      alpha: 0,
      duration: 320,
      ease: 'Sine.easeOut',
    });
  }

  handleZombieKilled(zombie) {
    this.addXp(zombie.config.reward.xp);
    this.hud.setXp(this.level, this.xp, this.xpToNext);
  }

  restoreHp() {
    this.hp = this.maxHp;
    this.hud.setHp(this.hp, this.maxHp);
  }

  toggleHpLock() {
    this.hpLocked = !this.hpLocked;
    return this.hpLocked;
  }

  addXp(amount) {
    this.xp += amount;
    let levelsGained = 0;
    while (this.level < GAMEPLAY.maxLevel && this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level += 1;
      levelsGained += 1;
      this.xpToNext = GAMEPLAY.levelXp[Math.min(this.level, GAMEPLAY.levelXp.length) - 1];
    }
    if (this.level >= GAMEPLAY.maxLevel) this.xp = this.xpToNext;

    if (levelsGained > 0) {
      this.upgradePoints += levelsGained;
      if (this.hud) this.hud.refreshItems();
    }
  }

  getWeaponStats(id) {
    const weapon = this.weaponInstances.get(id);
    return weapon ? weapon.config : getItem(id);
  }

  getWeaponLevel(id) {
    return this.weaponLevels[id] || 1;
  }

  upgradeWeapon(index) {
    if (this.gameOver || this.upgradePoints <= 0) return false;
    const id = this.inventory.weapons[index];
    if (!id) return false;

    const level = this.getWeaponLevel(id);
    if (level >= MAX_WEAPON_LEVEL) return false;

    const weapon = this.weaponInstances.get(id);
    if (!weapon) return false;

    const step = nextUpgradeStats(getItem(id), level);
    if (!step || !weapon.applyUpgrade(step, level + 1)) return false;

    this.weaponLevels[id] = level + 1;
    this.upgradePoints -= 1;
    if (this.hud) this.hud.refreshItems();
    return true;
  }

  endGame(result = 'defeat') {
    if (this.gameOver) return;

    this.gameOver = true;
    this.result = result;
    this.zombieManager.stop();
    this.physics.pause();
    if (this.devConsole) this.devConsole.setVisible(false);
    const survivalMs =
      result === 'victory' ? GAMEPLAY.survivalGoalMs : this.elapsedMs;
    new ResultOverlay(this, {
      result,
      survivalTime: this.formatTime(survivalMs),
      onRestart: () => this.scene.restart(),
    });
  }

  winGame() {
    if (this.gameOver || this.hp <= 0) return;

    this.remainingMs = 0;
    this.elapsedMs = GAMEPLAY.survivalGoalMs;
    this.hud.setTime(this.formatCountdown(0));
    this.endGame('victory');
  }

  formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  formatCountdown(ms) {
    const totalSeconds = Math.ceil(Math.max(0, ms) / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }
}
