import { TRINKETS, WEAPONS } from './config.js';

export const MAX_WEAPONS = 6;
export const MAX_TRINKETS = 6;

export const ITEM_CATEGORY = {
  weapon: 'weapon',
  trinket: 'trinket',
};

// Keep the live config objects so tooltips always reflect current weapon stats.
function registerCategory(category, entries) {
  for (const [id, entry] of Object.entries(entries)) {
    entry.id = id;
    entry.category = category;
  }
  return entries;
}

export const ITEMS = {
  ...registerCategory(ITEM_CATEGORY.weapon, WEAPONS),
  ...registerCategory(ITEM_CATEGORY.trinket, TRINKETS),
};

export function getItem(id) {
  return ITEMS[id] || null;
}

/** Trinkets can be bought again; every copy still takes its own slot. */
export function canRepeat(item) {
  return !!item && item.category === ITEM_CATEGORY.trinket;
}

/** Stats of the next weapon level, or null when the item is maxed. */
export function nextUpgradeStats(item, level) {
  if (!item || !Array.isArray(item.upgradeSteps)) return null;
  return item.upgradeSteps[level - 1] || null;
}

/** One concise { label, from, to } row per upgraded stat, for the hover card. */
export function describeUpgrade(item, level, stats = item) {
  const step = nextUpgradeStats(item, level);
  if (!step) return [];

  const changes = [];
  for (const [key, to] of Object.entries(step)) {
    const label = item.upgradeLabels?.[key];
    if (!label) continue;
    changes.push({
      key,
      label,
      from: stats[key],
      to,
      format: item.upgradeFormats?.[key] || (key === 'refillIntervalMs' ? 'seconds' : null),
    });
  }
  return changes;
}

/** Description blocks unlocked by the weapon's current level. */
export function getDescriptionBlocks(item, level = 1) {
  const blocks = Array.isArray(item?.description) ? [...item.description] : [];
  for (const bonus of item?.bonusDescriptions || []) {
    if (level >= (bonus.minLevel || 1)) blocks.push(...(bonus.blocks || []));
  }
  return blocks;
}

export function formatStatValue(value, format) {
  if (value === undefined || value === null) return '?';
  if (format === 'seconds') {
    return String(Math.round((value / 1000) * 100) / 100);
  }
  if (format === 'percent') {
    return `${Math.round(value * 100)}%`;
  }
  return String(value);
}

/** Plain multi-line description for panels that cannot colour stat runs. */
export function getDescriptionText(item, stats = item, level = 1) {
  return getDescriptionBlocks(item, level)
    .map((block) =>
      typeof block === 'string'
        ? block
        : block
            .map((part) =>
              part.stat ? formatStatValue(stats[part.stat], part.format) : part.text || '',
            )
            .join(''),
    )
    .join('\n');
}

/** Owned items in acquisition order: weapons fill left-to-right, trinkets too. */
export default class Inventory {
  constructor({ weapons = [], trinkets = [] } = {}, catalog = ITEMS) {
    this.catalog = catalog;
    this.weapons = [];
    this.trinkets = [];
    for (const id of weapons) this.addItem(id);
    for (const id of trinkets) this.addItem(id);
  }

  list(category) {
    return category === ITEM_CATEGORY.trinket ? this.trinkets : this.weapons;
  }

  addItem(id) {
    const item = this.catalog[id];
    if (!item || !this.hasRoom(id)) return false;

    this.list(item.category).push(id);
    return true;
  }

  hasRoom(id) {
    const item = this.catalog[id];
    if (!item) return false;

    const list = this.list(item.category);
    const max = item.category === ITEM_CATEGORY.trinket ? MAX_TRINKETS : MAX_WEAPONS;
    if (list.length >= max) return false;
    return canRepeat(item) || !list.includes(id);
  }

  count(id) {
    const matches = (list) => list.filter((entry) => entry === id).length;
    return matches(this.weapons) + matches(this.trinkets);
  }

  hasItem(id) {
    return this.count(id) > 0;
  }
}
