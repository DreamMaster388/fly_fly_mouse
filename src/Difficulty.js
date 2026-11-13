export const TIER_DURATION_MS = 60000;

export const DIFFICULTY_TIERS = [
  { name: '青铜', color: '#9C6B30' },
  { name: '白银', color: '#8C8F94' },
  { name: '黄金', color: '#B8860B' },
  { name: '翡翠', color: '#14915B' },
  { name: '钻石', color: '#2F7FD1' },
  { name: '大师', color: '#7B3FBF' },
  { name: '王者', color: '#D02B2B' },
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

  nextTierStartMs(elapsedMs) {
    const index = DIFFICULTY_TIERS.indexOf(this.tierAt(elapsedMs));
    if (index >= DIFFICULTY_TIERS.length - 1) return null;
    return (index + 1) * TIER_DURATION_MS;
  }
}
