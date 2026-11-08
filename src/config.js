import dartTextureUrl from '../resource/weapon/武器-飞镖-透明.png';
import zombieWalkSpritesheetUrl from '../resource/enemy/zombie-walk-spritesheet.png';
import zombieDieSpritesheetUrl from '../resource/enemy/zombie-die-spritesheet.png';
import zombieHitSoundUrl from '../resource/audio/zombie-hit.mp3';
import zombieDieSoundUrl from '../resource/audio/zombie-die.mp3';
import chompSoundUrl from '../resource/audio/chomp.mp3';
import bgmSoundUrl from '../resource/audio/2.75.mp3';

export const GAMEPLAY = {
  initialHp: 10,
  contactDamage: 1,
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
    textureKey: 'dart',
    textureUrl: dartTextureUrl,
    damage: 1,
    slotCount: 8,
    displayHeight: 27,
    orbitRadius: 90,
    orbitDegreesPerSecond: 90,
    spinDegreesPerSecond: 360,
    bodyRadiusRatio: 0.35,
  },
};

export const ZOMBIES = {
  walker: {
    spawnIntervalMs: 2000,
    spawnAttempts: 20,
    worldInset: 64,
    cameraMargin: 80,
    displayHeight: 110,
    depth: -1,
    minFlipSpeed: 1,
    flashDurationMs: 120,
    flashTint: 0xff0000,
    body: {
      radius: 33,
      offsetX: 50,
      offsetY: 78,
    },
    walk: {
      textureKey: 'zombie',
      textureUrl: zombieWalkSpritesheetUrl,
      frameWidth: 166,
      frameHeight: 144,
      frameCount: 22,
      frameDurations: [90, 180],
      animationKey: 'zombie-walk',
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
    sounds: {
      hitKey: 'zombie-hit',
      hitUrl: zombieHitSoundUrl,
      dieKey: 'zombie-die',
      dieUrl: zombieDieSoundUrl,
    },
  },
};
