import dartProjectileTextureUrl from '../resource/weapon/武器-飞镖-透明.png';
import dartTextureUrl from '../resource/weapon/ZedShuriken.png';
import bombTextureUrl from '../resource/weapon/ZiggsE.png';
import cherryBombSpritesheetUrl from '../resource/weapon/cherry-bomb-spritesheet.png';
import bombExplosionTextureUrl from '../resource/weapon/bomb-explosion.png';
import zombieWalk1SpritesheetUrl from '../resource/enemy/zombie-walk-spritesheet.png';
import zombieWalk2SpritesheetUrl from '../resource/enemy/zombie-walk-2-spritesheet.png';
import zombieWalk3SpritesheetUrl from '../resource/enemy/zombie-walk-3-spritesheet.png';
import zombieAttackSpritesheetUrl from '../resource/enemy/zombie-attack-spritesheet.png';
import zombieDieSpritesheetUrl from '../resource/enemy/zombie-die-spritesheet.png';
import zombieHeadSpritesheetUrl from '../resource/enemy/zombie-head-spritesheet.png';
import zombieHitSoundUrl from '../resource/audio/zombie-hit.mp3';
import zombieDieSoundUrl from '../resource/audio/zombie-die.mp3';
import chompSoundUrl from '../resource/audio/chomp.mp3';
import bgmSoundUrl from '../resource/audio/2.75.mp3';
import rubyTextureUrl from '../resource/item/ruby.png';

export const GAMEPLAY = {
  initialHp: 648,
  maxPopulation: 25,
  initialLevel: 1,
  maxLevel: 18,
  levelXp: [
    280, 340, 460, 640, 860, 1140, 1480, 1880, 2360, 2920, 3560, 4280, 5080, 5960, 6920, 7960, 9080,
  ],
};

// 测试控制台默认开启，正式发布前改为 false。
export const CONSOLE = {
  enabled: true,
};

export const MAX_WEAPON_LEVEL = 8;

export const DAMAGE_TYPES = {
  normal: 'normal',
  explosion: 'explosion',
};

export const AUDIO = {
  chompKey: 'chomp',
  chompUrl: chompSoundUrl,
  bgmKey: 'bgm',
  bgmUrl: bgmSoundUrl,
  bgmVolume: 0.4,
};

export const WEAPONS = {
  dart: {
    name: '旋转飞镖',
    mechanic: 'orbit',
    // The HUD/shop icon and the airborne projectile are separate art.
    textureKey: 'dart',
    textureUrl: dartTextureUrl,
    projectileTextureKey: 'dart-projectile',
    projectileTextureUrl: dartProjectileTextureUrl,
    damageType: DAMAGE_TYPES.normal,
    damage: 2,
    slotCount: 8,
    ringSize: 8,
    ringCount: 1,
    initialCount: 0,
    refillCount: 1,
    refillIntervalMs: 1000,
    displayHeight: 27,
    orbitRadius: 90,
    outerOrbitRadius: 150,
    orbitDegreesPerSecond: 90,
    spinDegreesPerSecond: 360,
    bodyRadiusRatio: 0.35,
    maxLevel: MAX_WEAPON_LEVEL,
    upgradeLabels: {
      damage: '伤害',
      refillIntervalMs: '补充间隔',
      orbitDegreesPerSecond: '旋转速度',
      slotCount: '飞镖上限',
    },
    // Absolute stats for the next level: index 0 upgrades level 1 -> 2.
    upgradeSteps: [
      { damage: 4 },
      { refillIntervalMs: 800 },
      { damage: 6 },
      { orbitDegreesPerSecond: 180 },
      { damage: 8 },
      { refillIntervalMs: 600 },
      { slotCount: 16, ringCount: 2 },
    ],
    description: [
      '召唤围绕主角的飞镖。',
      [
        { text: '每隔' },
        { stat: 'refillIntervalMs', format: 'seconds', tone: 'interval' },
        { text: '秒，召唤' },
        { stat: 'refillCount', tone: 'count' },
        { text: '枚飞镖，最多' },
        { stat: 'slotCount', tone: 'max' },
        { text: '枚，每枚造成' },
        { stat: 'damage', tone: 'damage' },
        { text: '点伤害。' },
      ],
    ],
    flavor: '影流之主！',
  },
  bomb: {
    name: '蹦蹦炸弹',
    mechanic: 'bomb',
    textureKey: 'bomb',
    textureUrl: bombTextureUrl,
    price: 600,
    damageType: DAMAGE_TYPES.explosion,
    damage: 10,
    cooldownMs: 10000,
    radius: 80,
    chainChance: 0,
    maxLevel: MAX_WEAPON_LEVEL,
    animation: {
      textureKey: 'cherry-bomb',
      textureUrl: cherryBombSpritesheetUrl,
      frameWidth: 280,
      frameHeight: 212,
      frameCount: 14,
      frameRate: 30,
      displayHeight: 64,
      animationKey: 'cherry-bomb-throw',
    },
    explosion: {
      textureKey: 'bomb-explosion',
      textureUrl: bombExplosionTextureUrl,
      sizeRatio: 2.2,
      durationMs: 360,
    },
    upgradeLabels: {
      damage: '伤害',
      cooldownMs: '冷却时间',
      radius: '爆炸范围',
      chainChance: '连锁概率',
    },
    upgradeFormats: {
      cooldownMs: 'seconds',
      chainChance: 'percent',
    },
    // Absolute stats for the next level: index 0 upgrades level 1 -> 2.
    upgradeSteps: [
      { damage: 15 },
      { cooldownMs: 8000 },
      { damage: 20 },
      { radius: 120 },
      { damage: 30 },
      { cooldownMs: 6000 },
      { chainChance: 0.5 },
    ],
    description: [
      [
        { text: '每隔' },
        { stat: 'cooldownMs', format: 'seconds', tone: 'interval' },
        { text: '秒，投掷炸弹，造成' },
        { stat: 'damage', tone: 'damage' },
        { text: '点范围伤害。' },
      ],
    ],
    bonusDescriptions: [
      {
        minLevel: 8,
        blocks: [
          [
            { text: '蹦蹦炸弹爆炸后，有' },
            { stat: 'chainChance', format: 'percent', tone: 'chance' },
            { text: '概率分裂并弹跳至最近敌人。' },
          ],
        ],
      },
    ],
    flavor: '全都可以炸完~',
  },
};

export const TRINKETS = {
  ruby: {
    name: '红宝石',
    textureKey: 'ruby',
    textureUrl: rubyTextureUrl,
    price: 100,
    description: ['生命与最大生命+10。'],
    flavor: '这个加血，这个厉害。',
    effects: {
      hp: 10,
      maxHp: 10,
    },
  },
};

export const ZOMBIES = {
  normal: {
    name: '普通僵尸',
    populationCost: 1,
    speed: 30,
    maxHp: 10,
    reward: {
      gold: 21,
      xp: 60,
    },
    spawnIntervalMs: 2000,
    spawnAttempts: 20,
    worldInset: 64,
    cameraMargin: 80,
    spawnMaxMargin: 280,
    despawnDistance: 1600,
    displayHeight: 110,
    depth: -1,
    minFlipSpeed: 1,
    flashDurationMs: 120,
    flashTint: 0xff0000,
    specialDeaths: {
      [DAMAGE_TYPES.explosion]: 'charred',
    },
    decorations: {
      mustacheChance: 0.2,
      tongueChance: 0.2,
    },
    body: {
      radius: 33,
      offsetX: 72,
      offsetY: 78,
    },
    contact: {
      damage: 10,
      intervalMs: 500,
      rangePadding: 8,
    },
    walk: {
      repeat: -1,
      variants: [
        {
          textureKey: 'zombie-walk-1',
          textureUrl: zombieWalk1SpritesheetUrl,
          frameWidth: 166,
          frameHeight: 144,
          frameCount: 22,
          frameDurations: [90, 180],
          animationKey: 'normal-walk-1',
        },
        {
          textureKey: 'zombie-walk-2',
          textureUrl: zombieWalk2SpritesheetUrl,
          frameWidth: 166,
          frameHeight: 144,
          frameCount: 31,
          frameDurations: [100],
          animationKey: 'normal-walk-2',
        },
        {
          textureKey: 'zombie-walk-3',
          textureUrl: zombieWalk3SpritesheetUrl,
          frameWidth: 166,
          frameHeight: 144,
          frameCount: 18,
          frameDurations: [200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 100],
          animationKey: 'normal-walk-3',
        },
      ],
    },
    attack: {
      textureKey: 'zombie-attack',
      textureUrl: zombieAttackSpritesheetUrl,
      frameWidth: 166,
      frameHeight: 144,
      frameCount: 21,
      frameDurations: [150, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
      animationKey: 'normal-attack',
      repeat: -1,
    },
    die: {
      textureKey: 'zombie-die',
      textureUrl: zombieDieSpritesheetUrl,
      frameWidth: 166,
      frameHeight: 144,
      frameCount: 10,
      frameDurations: [100, 100, 200, 100, 100, 100, 100, 100, 100, 1000],
      animationKey: 'zombie-die',
      repeat: 0,
    },
    head: {
      textureKey: 'zombie-head',
      textureUrl: zombieHeadSpritesheetUrl,
      frameWidth: 150,
      frameHeight: 186,
      frameCount: 12,
      frameDurations: [40, 40, 40, 40, 40, 40, 40, 40, 40, 80, 80, 40],
      animationKey: 'zombie-head-die',
      repeat: 0,
      neckOffset: { x: 64, y: 39 },
    },
    sounds: {
      hitKey: 'zombie-hit',
      hitUrl: zombieHitSoundUrl,
      dieKey: 'zombie-die',
      dieUrl: zombieDieSoundUrl,
    },
  },
};
