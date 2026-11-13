import { describeUpgrade, getItem } from './items.js';
import { MAX_WEAPON_LEVEL } from './config.js';
import { FONT_FAMILY } from './fonts.js';
import ItemTooltip from './ItemTooltip.js';

const GOLD = 0xc8aa6e;
const BRONZE = 0x785a28;
const DARK = 0x0a1420;
const INNER = 0x1e2328;

const BAR_WIDTH = 680;
const BAR_HEIGHT = 114;
const BAR_MARGIN_BOTTOM = 8;
const BAR_MARGIN_SIDE = 14;
const SIDE_WIDTH = 108;
const SIDE_GAP = 6;

const STYLE = {
  fontFamily: FONT_FAMILY,
  fontSize: '24px',
  color: '#111111',
};
const DIFFICULTY_STYLE = {
  ...STYLE,
  fontSize: '20px',
};
const HP_TEXT_STYLE = {
  fontFamily: FONT_FAMILY,
  fontSize: '16px',
  fontStyle: 'bold',
  color: '#f0e6d2',
};
const GOLD_TEXT_STYLE = {
  fontFamily: FONT_FAMILY,
  fontSize: '16px',
  fontStyle: 'bold',
  color: '#f0e6d2',
};
const LEVEL_TEXT_STYLE = {
  fontFamily: FONT_FAMILY,
  fontSize: '13px',
  fontStyle: 'bold',
  color: '#f0e6d2',
};
const MARGIN = 24;
const TOP = 20;

function chamferPoints(x, y, width, height, cut) {
  return [
    { x: x + cut, y },
    { x: x + width - cut, y },
    { x: x + width, y: y + cut },
    { x: x + width, y: y + height - cut },
    { x: x + width - cut, y: y + height },
    { x: x + cut, y: y + height },
    { x, y: y + height - cut },
    { x, y: y + cut },
  ];
}

function drawPanel(graphics, x, y, width, height, cut = 6) {
  const points = chamferPoints(x, y, width, height, cut);
  graphics.fillStyle(DARK, 1);
  graphics.fillPoints(points, true);
  graphics.lineStyle(1, BRONZE, 1);
  graphics.strokePoints(points, true);
  graphics.lineStyle(1, INNER, 0.9);
  graphics.strokePoints(chamferPoints(x + 1.5, y + 1.5, width - 3, height - 3, Math.max(0, cut - 2)), true);
  graphics.lineStyle(1, GOLD, 0.22);
  graphics.lineBetween(x + cut, y + 1.5, x + width - cut, y + 1.5);
}

function drawSlot(graphics, x, y, size) {
  graphics.fillStyle(0x070c10, 1);
  graphics.fillRect(x, y, size, size);
  graphics.lineStyle(1, 0x3c3220, 1);
  graphics.strokeRect(x, y, size, size);
  graphics.lineStyle(1, 0x141c25, 1);
  graphics.strokeRect(x + 1.5, y + 1.5, size - 3, size - 3);
  graphics.fillStyle(INNER, 0.35);
  graphics.fillRect(x + 2, y + 2, size - 4, 2);
}

function drawRing(graphics, x, y, radius) {
  graphics.fillStyle(0x071019, 1);
  graphics.fillCircle(x, y, radius);
  graphics.lineStyle(2, GOLD, 1);
  graphics.strokeCircle(x, y, radius - 1);
  graphics.lineStyle(1, BRONZE, 1);
  graphics.strokeCircle(x, y, radius + 1);
}

export default class Hud {
  constructor(scene, { hp, maxHp, level, xp, xpToNext, gold, inventory = null }) {
    const { width, height } = scene.scale;
    this.scene = scene;
    this.maxHp = maxHp;
    this.level = level;
    this.xp = xp;
    this.xpToNext = xpToNext;
    this.xpRatio = xpToNext > 0 ? Math.min(1, xp / xpToNext) : 1;
    this.inventory = inventory;
    this.currentAlpha = 1;
    this.icons = { weapon: [], trinket: [] };

    const groupWidth = BAR_WIDTH + SIDE_GAP + SIDE_WIDTH;
    const barX = (width - groupWidth) / 2;
    const barY = height - BAR_HEIGHT - BAR_MARGIN_BOTTOM;
    const centerY = barY + BAR_HEIGHT / 2;
    const gridX = barX + BAR_MARGIN_SIDE;
    const gridSize = 68;
    const gridY = centerY - gridSize / 2;
    const avatarRadius = 42;
    const avatarX = gridX + gridSize + 6 + avatarRadius + 4;
    const avatarY = centerY;
    const middleX = avatarX + avatarRadius + 4 + 8;
    const middleWidth = 392;
    const middleY = centerY - 50;
    const middleHeight = 100;

    const sideX = barX + BAR_WIDTH + SIDE_GAP;
    const sideY = barY;
    const trinketSize = 27;
    const trinketGap = 5;
    const trinketX = sideX + 8;
    const trinketY = sideY + 6;
    const goldButton = {
      x: trinketX,
      y: trinketY + trinketSize * 2 + trinketGap + 9,
      width: trinketSize * 3 + trinketGap * 2,
      height: 32,
    };

    const itemSize = 46;
    const itemGap = 8;
    const itemsWidth = itemSize * 6 + itemGap * 5;
    const itemsX = middleX + (middleWidth - itemsWidth) / 2;
    const itemsY = middleY + 5;
    const hpBar = {
      x: itemsX,
      y: middleY + 62,
      width: itemsWidth,
      height: 26,
    };

    const gridSlots = [];
    for (let row = 0; row < 2; row += 1) {
      for (let column = 0; column < 2; column += 1) {
        gridSlots.push({
          x: gridX + 4 + column * 32,
          y: gridY + 4 + row * 32,
          size: 28,
        });
      }
    }

    const trinketSlots = [];
    for (let row = 0; row < 2; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        trinketSlots.push({
          x: trinketX + column * (trinketSize + trinketGap),
          y: trinketY + row * (trinketSize + trinketGap),
          size: trinketSize,
        });
      }
    }

    const weaponSlots = Array.from({ length: 6 }, (_, index) => ({
      x: itemsX + index * (itemSize + itemGap),
      y: itemsY,
      size: itemSize,
    }));

    const pipCount = MAX_WEAPON_LEVEL;
    const pipSpacing = 5;
    const levelPips = weaponSlots.map((slot) => ({
      y: slot.y + slot.size + 5.5,
      startX: slot.x + slot.size / 2 - ((pipCount - 1) * pipSpacing) / 2,
      spacing: pipSpacing,
      radius: 1.9,
      count: pipCount,
    }));

    const upgradeButton = {
      width: 38,
      height: 40,
      y: middleY - 28,
    };

    this.layout = {
      bar: { x: barX, y: barY, width: BAR_WIDTH, height: BAR_HEIGHT },
      grid: { x: gridX, y: gridY, size: gridSize, slots: gridSlots },
      avatar: {
        x: avatarX,
        y: avatarY,
        radius: avatarRadius,
        xpRadius: avatarRadius + 4,
        badge: { x: avatarX + 30, y: avatarY + 32, radius: 12 },
      },
      middle: { x: middleX, y: middleY, width: middleWidth, height: middleHeight },
      weaponSlots,
      levelPips,
      upgradeButton,
      hpBar,
      side: { x: sideX, y: sideY, width: SIDE_WIDTH, height: BAR_HEIGHT },
      trinketSlots,
      goldButton,
    };

    this.chrome = scene.add.graphics().setScrollFactor(0).setDepth(1000);
    this.hpGraphics = scene.add.graphics().setScrollFactor(0).setDepth(1001);
    this.xpGraphics = scene.add.graphics().setScrollFactor(0).setDepth(1001);
    this.drawChrome();

    this.avatar = scene.add
      .image(avatarX, avatarY, 'player-avatar')
      .setDisplaySize(avatarRadius * 2 - 8, avatarRadius * 2 - 8)
      .setScrollFactor(0)
      .setDepth(1001);

    this.goldHover = scene.add.graphics().setScrollFactor(0).setDepth(1001).setVisible(false);
    this.goldHover.fillStyle(GOLD, 0.16);
    this.goldHover.fillPoints(
      chamferPoints(goldButton.x, goldButton.y, goldButton.width, goldButton.height, 4),
      true,
    );
    this.goldButtonHit = scene.add
      .zone(goldButton.x, goldButton.y, goldButton.width, goldButton.height)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(1001)
      .setInteractive({ useHandCursor: true });
    this.goldButtonHit.on('pointerover', () => this.goldHover.setVisible(true));
    this.goldButtonHit.on('pointerout', () => this.goldHover.setVisible(false));
    this.goldButtonHit.on('pointerdown', () => this.scene.openShop());

    this.timeText = scene.add
      .text(MARGIN, TOP, '0:00', STYLE)
      .setScrollFactor(0)
      .setDepth(1000);
    this.difficultyText = scene.add
      .text(MARGIN, TOP + 34, '难度', DIFFICULTY_STYLE)
      .setScrollFactor(0)
      .setDepth(1000);
    this.levelText = scene.add
      .text(this.layout.avatar.badge.x, this.layout.avatar.badge.y + 1, '1', LEVEL_TEXT_STYLE)
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1002);
    this.goldText = scene.add
      .text(goldButton.x + 27, goldButton.y + goldButton.height / 2, '0', GOLD_TEXT_STYLE)
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(1002);
    this.hpText = scene.add
      .text(
        hpBar.x + hpBar.width / 2,
        hpBar.y + hpBar.height / 2,
        '',
        HP_TEXT_STYLE,
      )
      .setOrigin(0.5)
      .setStroke('#06120a', 3)
      .setScrollFactor(0)
      .setDepth(1002);

    this.tooltip = new ItemTooltip(scene);
    this.tooltipIndex = null;
    this.itemZones = { weapon: [], trinket: [] };
    this.bindItemHover('weapon', weaponSlots);
    this.bindItemHover('trinket', trinketSlots);

    this.weaponLevelGraphics = scene.add
      .graphics()
      .setScrollFactor(0)
      .setDepth(1002);
    this.pipStates = weaponSlots.map(() => ({ level: 0, count: MAX_WEAPON_LEVEL, lit: 0 }));
    this.upgradeButtons = this.createUpgradeButtons();

    this.setHp(hp, maxHp);
    this.setXp(level, xp, xpToNext);
    this.setGold(gold);
    this.refreshItems();

    this.fadeRegions = [
      { x: barX, y: barY, width: BAR_WIDTH, height: BAR_HEIGHT },
      { x: sideX, y: sideY, width: SIDE_WIDTH, height: BAR_HEIGHT },
      { x: MARGIN, y: TOP, width: 220, height: 64 },
      {
        x: middleX,
        y: middleY - 52,
        width: middleWidth,
        height: 52,
      },
    ];
    this.fadeObjects = [
      this.chrome,
      this.hpGraphics,
      this.xpGraphics,
      this.weaponLevelGraphics,
      this.avatar,
      this.goldHover,
      this.timeText,
      this.difficultyText,
      this.levelText,
      this.goldText,
      this.hpText,
      ...this.upgradeButtons.map((button) => button.image),
    ];
  }

  setAlpha(alpha) {
    this.currentAlpha = alpha;
    for (const object of this.fadeObjects) object.setAlpha(alpha);
    for (const icons of Object.values(this.icons)) {
      for (const icon of icons) {
        if (icon) icon.setAlpha(alpha);
      }
    }
  }

  setInventory(inventory) {
    this.inventory = inventory;
    this.refreshItems();
  }

  createUpgradeButtons() {
    const { weaponSlots, upgradeButton } = this.layout;
    return weaponSlots.map((slot, index) => {
      const x = slot.x + slot.size / 2;
      const y = upgradeButton.y;
      const image = this.scene.add
        .image(x, y, 'upgrade-button')
        .setDisplaySize(upgradeButton.width, upgradeButton.height)
        .setScrollFactor(0)
        .setDepth(1002)
        .setVisible(false);
      const zone = this.scene.add
        .zone(x, y, upgradeButton.width + 8, upgradeButton.height + 8)
        .setScrollFactor(0)
        .setDepth(1002)
        .setInteractive({ useHandCursor: true });
      zone.input.enabled = false;

      const entry = { index, x, y, image, zone, active: false, hovered: false };

      zone.on('pointerover', () => {
        if (!entry.active) return;
        entry.hovered = true;
        image.setDisplaySize(upgradeButton.width * 1.08, upgradeButton.height * 1.08);
        this.showUpgradeTooltip(index);
      });
      zone.on('pointerout', () => {
        entry.hovered = false;
        image.setDisplaySize(upgradeButton.width, upgradeButton.height);
        if (this.tooltipIndex?.kind === 'upgrade' && this.tooltipIndex.index === index) {
          this.hideItemTooltip();
        }
      });
      zone.on('pointerdown', () => {
        if (entry.active) this.upgradeWeapon(index);
      });

      return entry;
    });
  }

  getWeaponLevel(index) {
    const id = this.inventory ? this.inventory.weapons[index] : null;
    return id && this.scene.getWeaponLevel ? this.scene.getWeaponLevel(id) : 1;
  }

  refreshWeaponLevels() {
    const g = this.weaponLevelGraphics;
    g.clear();
    const weapons = this.inventory ? this.inventory.weapons : [];

    this.pipStates = this.layout.levelPips.map((pips, index) => {
      const level = weapons[index] ? this.getWeaponLevel(index) : 0;
      const lit = Math.min(level, pips.count);
      if (level > 0) {
        for (let pip = 0; pip < pips.count; pip += 1) {
          const x = pips.startX + pip * pips.spacing;
          if (pip < lit) {
            g.fillStyle(GOLD, 0.95);
            g.fillCircle(x, pips.y, pips.radius);
            g.lineStyle(0.7, 0xf0e6d2, 0.7);
            g.strokeCircle(x, pips.y, pips.radius);
          } else {
            g.fillStyle(0x071019, 1);
            g.fillCircle(x, pips.y, pips.radius);
            g.lineStyle(0.7, 0x3c3220, 0.95);
            g.strokeCircle(x, pips.y, pips.radius);
          }
        }
      }
      return { level, count: pips.count, lit };
    });
  }

  updateUpgradeButtons() {
    const weapons = this.inventory ? this.inventory.weapons : [];
    const points = this.scene.upgradePoints || 0;

    for (const button of this.upgradeButtons) {
      const id = weapons[button.index];
      const level = id ? this.getWeaponLevel(button.index) : MAX_WEAPON_LEVEL;
      const active = !!id && points > 0 && level < MAX_WEAPON_LEVEL;
      button.active = active;
      button.image.setVisible(active);
      if (button.zone.input) button.zone.input.enabled = active;
      if (!active) {
        button.image.setDisplaySize(
          this.layout.upgradeButton.width,
          this.layout.upgradeButton.height,
        );
      }
    }
  }

  showUpgradeTooltip(index) {
    const id = this.inventory ? this.inventory.weapons[index] : null;
    const item = id ? getItem(id) : null;
    const level = this.getWeaponLevel(index);
    if (!item || level >= MAX_WEAPON_LEVEL) {
      this.hideItemTooltip();
      return;
    }

    const stats = this.scene.getWeaponStats ? this.scene.getWeaponStats(id) : item;
    const changes = describeUpgrade(item, level, stats);
    const button = this.upgradeButtons[index];
    this.tooltip.showUpgrade(item, level, changes, {
      x: button.x,
      y: button.y - this.layout.upgradeButton.height / 2,
      size: this.layout.upgradeButton.height,
    });
    this.tooltipIndex = { kind: 'upgrade', index };
  }

  upgradeWeapon(index) {
    if (!this.scene.upgradeWeapon || !this.scene.upgradeWeapon(index)) return false;
    const button = this.upgradeButtons[index];
    if (button && button.active && button.hovered) this.showUpgradeTooltip(index);
    return true;
  }

  bindItemHover(kind, slots) {
    this.itemZones[kind] = slots.map((slot, index) => {
      const zone = this.scene.add
        .zone(slot.x, slot.y, slot.size, slot.size)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(1001)
        .setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => this.showItemTooltip(kind, index));
      zone.on('pointerout', () => {
        if (
          this.tooltipIndex &&
          this.tooltipIndex.kind === kind &&
          this.tooltipIndex.index === index
        ) {
          this.hideItemTooltip();
        }
      });
      return zone;
    });
  }

  showItemTooltip(kind, index) {
    const ids = this.inventory
      ? kind === 'weapon'
        ? this.inventory.weapons
        : this.inventory.trinkets
      : [];
    const item = ids[index] ? getItem(ids[index]) : null;
    if (!item) {
      this.hideItemTooltip();
      return;
    }

    const slots = kind === 'weapon' ? this.layout.weaponSlots : this.layout.trinketSlots;
    const slot = slots[index];
    const stats = this.scene.getWeaponStats ? this.scene.getWeaponStats(item.id) : item;
    this.tooltip.show(item, {
      x: slot.x + slot.size / 2,
      y: slot.y,
      size: slot.size,
      stats,
      level: kind === 'weapon' ? this.getWeaponLevel(index) : 1,
    });
    this.tooltipIndex = { kind, index };
  }

  hideItemTooltip() {
    this.tooltipIndex = null;
    if (this.tooltip) this.tooltip.hide();
  }

  refreshItems() {
    this.hideItemTooltip();
    const weapons = this.inventory ? this.inventory.weapons : [];
    const trinkets = this.inventory ? this.inventory.trinkets : [];
    this.syncIcons('weapon', this.layout.weaponSlots, weapons);
    this.syncIcons('trinket', this.layout.trinketSlots, trinkets);
    this.refreshWeaponLevels();
    this.updateUpgradeButtons();

    for (const [kind, ids] of [
      ['weapon', weapons],
      ['trinket', trinkets],
    ]) {
      this.itemZones[kind].forEach((zone, index) => {
        if (zone.input) zone.input.cursor = ids[index] ? 'pointer' : 'default';
      });
    }
  }

  syncIcons(kind, slots, ids) {
    const icons = this.icons[kind];
    for (let index = 0; index < slots.length; index += 1) {
      const item = ids[index] ? getItem(ids[index]) : null;
      const slot = slots[index];
      if (!item) {
        if (icons[index]) icons[index].setVisible(false);
        continue;
      }

      const x = slot.x + slot.size / 2;
      const y = slot.y + slot.size / 2;
      let icon = icons[index];
      if (icon) {
        icon.setTexture(item.textureKey);
        icon.setPosition(x, y);
      } else {
        icon = this.scene.add
          .image(x, y, item.textureKey)
          .setScrollFactor(0)
          .setDepth(1002);
        icons[index] = icon;
      }

      icon.setDisplaySize(slot.size - 10, slot.size - 10);
      icon.setVisible(true);
      icon.setAlpha(this.currentAlpha);
    }
  }

  drawChrome() {
    const g = this.chrome;
    const { bar, grid, avatar, middle, weaponSlots, hpBar, side, trinketSlots, goldButton } =
      this.layout;

    g.fillStyle(0x050b0f, 0.9);
    g.fillPoints(chamferPoints(bar.x, bar.y, bar.width, bar.height, 12), true);
    g.lineStyle(1, BRONZE, 0.9);
    g.strokePoints(chamferPoints(bar.x, bar.y, bar.width, bar.height, 12), true);

    drawPanel(g, grid.x, grid.y, grid.size, grid.size);
    for (const slot of grid.slots) drawSlot(g, slot.x, slot.y, slot.size);

    drawPanel(g, middle.x, middle.y, middle.width, middle.height);
    for (const slot of weaponSlots) drawSlot(g, slot.x, slot.y, slot.size);

    g.fillStyle(0x02080c, 1);
    g.fillRect(hpBar.x - 2, hpBar.y - 2, hpBar.width + 4, hpBar.height + 4);
    g.lineStyle(1, BRONZE, 1);
    g.strokeRect(hpBar.x - 2, hpBar.y - 2, hpBar.width + 4, hpBar.height + 4);

    g.lineStyle(4, INNER, 1);
    g.strokeCircle(avatar.x, avatar.y, avatar.xpRadius);
    drawRing(g, avatar.x, avatar.y, avatar.radius);

    drawPanel(g, side.x, side.y, side.width, side.height);
    for (const slot of trinketSlots) drawSlot(g, slot.x, slot.y, slot.size);

    const buttonPoints = chamferPoints(
      goldButton.x,
      goldButton.y,
      goldButton.width,
      goldButton.height,
      4,
    );
    g.fillStyle(0x071019, 1);
    g.fillPoints(buttonPoints, true);
    g.lineStyle(1, BRONZE, 1);
    g.strokePoints(buttonPoints, true);
    g.lineStyle(1, GOLD, 0.28);
    g.lineBetween(
      goldButton.x + 4,
      goldButton.y + 1,
      goldButton.x + goldButton.width - 4,
      goldButton.y + 1,
    );

    const coinX = goldButton.x + 14;
    const coinY = goldButton.y + goldButton.height / 2;
    g.fillStyle(0xd4af37, 1);
    g.fillCircle(coinX, coinY, 8);
    g.lineStyle(1.5, 0xf0e6d2, 0.9);
    g.strokeCircle(coinX, coinY, 8);
    g.fillStyle(0xb8860b, 1);
    g.fillCircle(coinX, coinY, 4.5);
    g.fillStyle(0xf7e7a1, 0.9);
    g.fillCircle(coinX - 2, coinY - 2.5, 1.8);

    const badge = avatar.badge;
    g.fillStyle(0x071019, 1);
    g.fillCircle(badge.x, badge.y, badge.radius);
    g.lineStyle(2, GOLD, 1);
    g.strokeCircle(badge.x, badge.y, badge.radius);
    g.lineStyle(1, BRONZE, 1);
    g.strokeCircle(badge.x, badge.y, badge.radius + 1);
  }

  setTime(text) {
    this.timeText.setText(text);
  }

  setDifficulty(name, color) {
    this.difficultyText.setText(`难度 ${name}`);
    this.difficultyText.setColor(color);
  }

  setGold(gold) {
    this.goldText.setText(String(gold));
  }

  setHp(hp, maxHp) {
    this.maxHp = maxHp;
    const ratio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
    const g = this.hpGraphics;
    const { x, y, width, height } = this.layout.hpBar;

    g.clear();
    g.fillStyle(0x0a2a12, 1);
    g.fillRect(x, y, width, height);

    const innerWidth = Math.max(0, (width - 4) * ratio);
    if (innerWidth > 0) {
      g.fillStyle(0x1d7a2b, 1);
      g.fillRect(x + 2, y + 2, innerWidth, height - 4);
      g.fillStyle(0x379b3f, 1);
      g.fillRect(x + 2, y + 2, innerWidth, Math.floor((height - 4) / 2));
      g.fillStyle(0x69c96f, 0.85);
      g.fillRect(x + 2, y + 2, innerWidth, 2);
    }

    g.lineStyle(1, 0x061006, 0.5);
    for (let value = 100; value < maxHp; value += 100) {
      const tickX = x + 2 + (width - 4) * (value / maxHp);
      g.lineBetween(tickX, y + 3, tickX, y + height - 3);
    }

    this.hpText.setText(`${hp} / ${maxHp}`);
  }

  setXp(level, xp, xpToNext) {
    this.level = level;
    this.xp = xp;
    this.xpToNext = xpToNext;
    this.xpRatio = xpToNext > 0 ? Math.max(0, Math.min(1, xp / xpToNext)) : 1;
    this.levelText.setText(String(level));

    const g = this.xpGraphics;
    const { x, y, xpRadius } = this.layout.avatar;
    g.clear();
    if (this.xpRatio <= 0) return;

    const start = Math.PI / 2;
    const end = start + Math.PI * 2 * this.xpRatio;
    g.lineStyle(4, GOLD, 1);
    g.beginPath();
    g.arc(x, y, xpRadius, start, end, false);
    g.strokePath();
    g.lineStyle(1, 0xf0e6d2, 0.55);
    g.beginPath();
    g.arc(x, y, xpRadius, start, end, false);
    g.strokePath();
  }
}
