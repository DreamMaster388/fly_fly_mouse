import Phaser from 'phaser';

const TIER_DURATION_MS = 30000;
const SPEED_STD_RATIO = 0.2;
const SPEED_FLOOR = 30;

export const DIFFICULTY_TIERS = [
  {
    name: '青铜',
    color: '#9C6B30',
    speedMean: 30,
    maxAlive: 4,
    maxHp: 4,
    killScore: 1,
    refillIntervalMs: 250,
  },
  {
    name: '白银',
    color: '#8C8F94',
    speedMean: 60,
    maxAlive: 5,
    maxHp: 5,
    killScore: 2,
    refillIntervalMs: 1000 / 3.5,
  },
  {
    name: '黄金',
    color: '#B8860B',
    speedMean: 90,
    maxAlive: 6,
    maxHp: 6,
    killScore: 3,
    refillIntervalMs: 1000 / 3,
  },
  {
    name: '翡翠',
    color: '#14915B',
    speedMean: 120,
    maxAlive: 7,
    maxHp: 7,
    killScore: 4,
    refillIntervalMs: 1000 / 2.5,
  },
  {
    name: '钻石',
    color: '#2F7FD1',
    speedMean: 150,
    maxAlive: 8,
    maxHp: 8,
    killScore: 5,
    refillIntervalMs: 1000 / 2,
  },
  {
    name: '大师',
    color: '#7B3FBF',
    speedMean: 180,
    maxAlive: 9,
    maxHp: 9,
    killScore: 6,
    refillIntervalMs: 1000 / 1.5,
  },
  {
    name: '王者',
    color: '#D02B2B',
    speedMean: 210,
    maxAlive: 10,
    maxHp: 10,
    killScore: 7,
    refillIntervalMs: 1000,
  },
];

export default class Difficulty {
  constructor() {
    this.tier = DIFFICULTY_TIERS[0];
  }

  update(elapsedMs) {
    const next = this.tierAt(elapsedMs);
    if (next === this.tier) return false;

    this.tier = next;
    return true;
  }

  tierAt(elapsedMs) {
    const index = Math.min(
      DIFFICULTY_TIERS.length - 1,
      Math.floor(Math.max(0, elapsedMs) / TIER_DURATION_MS),
    );
    return DIFFICULTY_TIERS[index];
  }

  rollZombieSpeed() {
    const u1 = Math.max(Phaser.Math.RND.frac(), Number.EPSILON);
    const u2 = Phaser.Math.RND.frac();
    const gaussian = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const speed = this.tier.speedMean + gaussian * this.tier.speedMean * SPEED_STD_RATIO;
    return Math.max(SPEED_FLOOR, speed);
  }
}
