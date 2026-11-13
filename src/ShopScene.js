import Phaser from 'phaser';
import { canRepeat, getDescriptionText, ITEMS, ITEM_CATEGORY } from './items.js';
import { FONT_FAMILY } from './fonts.js';

const GOLD = 0xc8aa6e;
const BRONZE = 0x785a28;
const DARK = 0x0a1420;
const CELL_FILL = 0x101b27;
const CELL_HOVER = 0x172838;
const CELL_ACTIVE = 0x1c2f3f;
const DISABLED_FILL = 0x141c25;
const BUY_FILL = 0x1e3a2a;
const BUY_HOVER = 0x2a4d38;

const PANEL = { x: 190, y: 76, width: 900, height: 568 };
const PADDING = 28;
const TAB_WIDTH = 96;
const TAB_HEIGHT = 34;
const TAB_GAP = 8;
const CONTENT_Y = 138;
const CONTENT_HEIGHT = PANEL.height - CONTENT_Y - 88;
const LIST_WIDTH = 540;
const LIST_GAP = 20;
const DETAIL_WIDTH = PANEL.width - PADDING * 2 - LIST_GAP - LIST_WIDTH;
const GRID_COLUMNS = 4;
const GRID_PAD = 12;
const GRID_GAP = 12;

const TITLE_STYLE = {
  fontFamily: FONT_FAMILY,
  fontSize: '30px',
  fontStyle: 'bold',
  color: '#f0e6d2',
};
const GOLD_STYLE = {
  fontFamily: FONT_FAMILY,
  fontSize: '18px',
  fontStyle: 'bold',
  color: '#ffd166',
};
const TAB_STYLE = {
  fontFamily: FONT_FAMILY,
  fontSize: '16px',
  color: '#8b9bb4',
};
const EMPTY_STYLE = {
  fontFamily: FONT_FAMILY,
  fontSize: '12px',
  color: '#8b9bb4',
};
const CELL_NAME_STYLE = {
  fontFamily: FONT_FAMILY,
  fontSize: '15px',
  fontStyle: 'bold',
  color: '#f0e6d2',
};
const CELL_PRICE_STYLE = {
  fontFamily: FONT_FAMILY,
  fontSize: '14px',
  fontStyle: 'bold',
  color: '#ffd166',
};
const OWNED_STYLE = {
  fontFamily: FONT_FAMILY,
  fontSize: '11px',
  color: '#8ee08a',
};
const DETAIL_TITLE_STYLE = {
  fontFamily: FONT_FAMILY,
  fontSize: '13px',
  color: '#c8aa6e',
};
const DETAIL_NAME_STYLE = {
  fontFamily: FONT_FAMILY,
  fontSize: '20px',
  fontStyle: 'bold',
  color: '#f0e6d2',
};
const DETAIL_META_STYLE = {
  fontFamily: FONT_FAMILY,
  fontSize: '13px',
  color: '#c8aa6e',
};
const DESCRIPTION_STYLE = {
  fontFamily: FONT_FAMILY,
  fontSize: '15px',
  color: '#d6dee8',
  lineSpacing: 5,
};
const FLAVOR_STYLE = {
  fontFamily: FONT_FAMILY,
  fontSize: '13px',
  fontStyle: 'italic',
  color: '#c3a6ff',
  lineSpacing: 4,
};
const BUY_STYLE = {
  fontFamily: FONT_FAMILY,
  fontSize: '17px',
  fontStyle: 'bold',
  color: '#f0e6d2',
};
const STATUS_STYLE = {
  fontFamily: FONT_FAMILY,
  fontSize: '12px',
  color: '#8b9bb4',
};
const HINT_STYLE = {
  fontFamily: FONT_FAMILY,
  fontSize: '14px',
  color: '#7c8ea4',
};

const CATEGORIES = [
  { id: ITEM_CATEGORY.weapon, label: '武器' },
  { id: ITEM_CATEGORY.trinket, label: '饰品' },
];
const CATEGORY_LABEL = Object.fromEntries(
  CATEGORIES.map((category) => [category.id, category.label]),
);

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

function shopItems(category, inventory = null) {
  return Object.values(ITEMS).filter((item) => {
    if (item.category !== category || !Number.isFinite(item.price)) return false;
    // Unique weapons leave the shop once the player owns them.
    return canRepeat(item) || !inventory || !inventory.hasItem(item.id);
  });
}

export default class ShopScene extends Phaser.Scene {
  constructor() {
    super('shop');
  }

  create() {
    this.closed = false;
    this.world = this.scene.get('world');

    const { width, height } = this.scale;
    const list = {
      x: PANEL.x + PADDING,
      y: PANEL.y + CONTENT_Y,
      width: LIST_WIDTH,
      height: CONTENT_HEIGHT,
    };
    const detail = {
      x: list.x + LIST_WIDTH + LIST_GAP,
      y: list.y,
      width: DETAIL_WIDTH,
      height: CONTENT_HEIGHT,
    };
    const exitButton = {
      x: PANEL.x + PANEL.width - PADDING - 120,
      y: PANEL.y + PANEL.height - PADDING - 40,
      width: 120,
      height: 40,
    };
    this.layout = { panel: PANEL, list, detail, exitButton };

    this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.72);

    const g = this.add.graphics();
    const points = chamferPoints(PANEL.x, PANEL.y, PANEL.width, PANEL.height, 14);
    g.fillStyle(DARK, 0.98);
    g.fillPoints(points, true);
    g.lineStyle(2, GOLD, 0.9);
    g.strokePoints(points, true);
    g.lineStyle(1, BRONZE, 0.9);
    g.strokePoints(
      chamferPoints(PANEL.x + 3, PANEL.y + 3, PANEL.width - 6, PANEL.height - 6, 12),
      true,
    );
    g.lineStyle(1, GOLD, 0.35);
    g.lineBetween(PANEL.x + PADDING, PANEL.y + 122, PANEL.x + PANEL.width - PADDING, PANEL.y + 122);

    for (const area of [list, detail]) {
      const areaPoints = chamferPoints(area.x, area.y, area.width, area.height, 10);
      g.fillStyle(0x0b141e, 0.92);
      g.fillPoints(areaPoints, true);
      g.lineStyle(1, BRONZE, 0.7);
      g.strokePoints(areaPoints, true);
    }

    g.lineStyle(1, BRONZE, 0.8);
    g.lineBetween(detail.x + 16, detail.y + 148, detail.x + detail.width - 16, detail.y + 148);

    this.add.text(PANEL.x + PADDING, PANEL.y + 18, '商店', TITLE_STYLE);
    this.goldText = this.add
      .text(PANEL.x + PANEL.width - PADDING, PANEL.y + 38, String(this.world.gold), GOLD_STYLE)
      .setOrigin(1, 0.5);
    this.goldLabel = this.add
      .text(0, PANEL.y + 38, '金币', {
        ...GOLD_STYLE,
        fontSize: '13px',
        color: '#8b9bb4',
      })
      .setOrigin(1, 0.5);
    this.layoutGold();
    this.noticeText = this.add
      .text(PANEL.x + PANEL.width - PADDING, PANEL.y + 60, '', {
        ...STATUS_STYLE,
        fontSize: '12px',
      })
      .setOrigin(1, 0.5);

    this.tabs = CATEGORIES.map((category, index) => {
      const x = PANEL.x + PADDING + index * (TAB_WIDTH + TAB_GAP);
      const y = PANEL.y + 76;
      const bg = this.add
        .rectangle(x, y, TAB_WIDTH, TAB_HEIGHT, 0x0d1722, 1)
        .setOrigin(0)
        .setStrokeStyle(1, BRONZE, 0.7)
        .setInteractive({ useHandCursor: true });
      const text = this.add
        .text(x + TAB_WIDTH / 2, y + TAB_HEIGHT / 2, category.label, TAB_STYLE)
        .setOrigin(0.5);
      bg.on('pointerover', () => {
        if (this.category !== category.id) bg.setFillStyle(0x16222f, 1);
      });
      bg.on('pointerout', () => this.updateTabs());
      bg.on('pointerdown', () => this.selectCategory(category.id));
      return { ...category, bg, text };
    });

    const exit = this.add
      .rectangle(
        exitButton.x + exitButton.width / 2,
        exitButton.y + exitButton.height / 2,
        exitButton.width,
        exitButton.height,
        0x1e2328,
      )
      .setStrokeStyle(1, BRONZE)
      .setInteractive({ useHandCursor: true });
    const exitLabel = this.add
      .text(exitButton.x + exitButton.width / 2, exitButton.y + exitButton.height / 2, '退出', {
        ...BUY_STYLE,
        fontSize: '20px',
      })
      .setOrigin(0.5);
    exit.on('pointerover', () => exit.setFillStyle(0x2b3a4a));
    exit.on('pointerout', () => exit.setFillStyle(0x1e2328));
    exit.on('pointerdown', () => this.close());
    this.add
      .text(PANEL.x + PADDING, PANEL.y + PANEL.height - PADDING, '按 ESC 关闭商店', HINT_STYLE)
      .setOrigin(0, 1);

    this.input.keyboard.on('keydown-ESC', () => this.close());

    this.exitButton = exit;
    this.exitLabel = exitLabel;
    this.buyButton = null;

    this.category =
      CATEGORIES.find((entry) => this.getShopItems(entry.id).length)?.id || CATEGORIES[0].id;
    this.selectedId = this.getShopItems(this.category)[0]?.id || null;
    this.updateTabs();
    this.renderList();
    this.renderDetail();
  }

  getShopItems(category) {
    return shopItems(category, this.world ? this.world.inventory : null);
  }

  selectCategory(id) {
    if (this.category === id) return;
    this.category = id;
    this.selectedId = this.getShopItems(id)[0]?.id || null;
    this.setNotice('');
    this.updateTabs();
    this.renderList();
    this.renderDetail();
  }

  updateTabs() {
    for (const tab of this.tabs) {
      const active = tab.id === this.category;
      tab.bg.setFillStyle(active ? 0x1b2a39 : 0x0d1722, 1);
      tab.bg.setStrokeStyle(1, active ? GOLD : BRONZE, active ? 1 : 0.7);
      tab.text.setColor(active ? '#f0e6d2' : '#8b9bb4');
    }
  }

  renderList() {
    if (this.listLayer) this.listLayer.destroy(true);
    this.listLayer = this.add.container(0, 0);
    this.listEntries = [];

    const { x, y, width, height } = this.layout.list;
    const items = this.getShopItems(this.category);
    if (!items.some((item) => item.id === this.selectedId)) {
      this.selectedId = items[0]?.id || null;
    }
    const cell = Math.floor(
      (width - GRID_PAD * 2 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS,
    );
    this.grid = { columns: GRID_COLUMNS, cell, gap: GRID_GAP, pad: GRID_PAD };

    if (items.length === 0) {
      this.listLayer.add(
        this.add
          .text(x + width / 2, y + height / 2 - 10, '暂无商品', {
            ...EMPTY_STYLE,
            fontSize: '22px',
          })
          .setOrigin(0.5),
      );
      this.listLayer.add(
        this.add
          .text(x + width / 2, y + height / 2 + 24, '该分类的商品尚未上架', {
            ...EMPTY_STYLE,
            fontSize: '14px',
          })
          .setOrigin(0.5),
      );
      return;
    }

    items.forEach((item, index) => {
      const column = index % GRID_COLUMNS;
      const row = Math.floor(index / GRID_COLUMNS);
      const cellX = x + GRID_PAD + column * (cell + GRID_GAP);
      const cellY = y + GRID_PAD + row * (cell + GRID_GAP);
      const centerX = cellX + cell / 2;
      const selected = item.id === this.selectedId;
      const count = this.world.inventory.count(item.id);

      const bg = this.add
        .rectangle(cellX, cellY, cell, cell, selected ? CELL_ACTIVE : CELL_FILL, 1)
        .setOrigin(0)
        .setStrokeStyle(1, selected ? GOLD : BRONZE, selected ? 1 : 0.7)
        .setInteractive({ useHandCursor: true });
      const icon = this.add.image(centerX, cellY + 40, item.textureKey);
      icon.setDisplaySize(56, 56);
      const name = this.add
        .text(centerX, cellY + 84, item.name, CELL_NAME_STYLE)
        .setOrigin(0.5);
      const price = this.add
        .text(centerX + 7, cellY + 104, String(item.price), CELL_PRICE_STYLE)
        .setOrigin(0.5);
      const coin = this.add.graphics();
      coin.fillStyle(0xd4af37, 1);
      coin.fillCircle(price.x - price.width / 2 - 9, price.y, 5);
      coin.lineStyle(1, 0xf0e6d2, 0.8);
      coin.strokeCircle(price.x - price.width / 2 - 9, price.y, 5);

      const children = [bg, icon, name, coin, price];
      if (count > 0) {
        children.push(
          this.add
            .text(
              cellX + cell - 7,
              cellY + 6,
              canRepeat(item) ? `×${count}` : '已拥有',
              OWNED_STYLE,
            )
            .setOrigin(1, 0),
        );
      }

      bg.on('pointerover', () => {
        if (this.selectedId !== item.id) bg.setFillStyle(CELL_HOVER, 1);
      });
      bg.on('pointerout', () => {
        bg.setFillStyle(this.selectedId === item.id ? CELL_ACTIVE : CELL_FILL, 1);
      });
      bg.on('pointerdown', () => this.selectItem(item.id));

      this.listLayer.add(children);
      this.listEntries.push({
        id: item.id,
        bg,
        x: cellX,
        y: cellY,
        width: cell,
        height: cell,
      });
    });
  }

  selectItem(id) {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.setNotice('');
    for (const entry of this.listEntries) {
      const selected = entry.id === id;
      entry.bg.setFillStyle(selected ? CELL_ACTIVE : CELL_FILL, 1);
      entry.bg.setStrokeStyle(1, selected ? GOLD : BRONZE, selected ? 1 : 0.7);
    }
    this.renderDetail();
  }

  renderDetail() {
    if (this.detailLayer) this.detailLayer.destroy(true);
    this.detailLayer = this.add.container(0, 0);
    this.buyButton = null;

    const { x, y, width, height } = this.layout.detail;
    this.detailLayer.add(
      this.add.text(x + 16, y + 14, '物品详情', DETAIL_TITLE_STYLE),
    );

    const item = this.selectedId ? ITEMS[this.selectedId] : null;
    if (!item) {
      this.detailLayer.add(
        this.add
          .text(x + width / 2, y + height / 2, '选择一件商品查看详情', {
            ...EMPTY_STYLE,
            fontSize: '14px',
          })
          .setOrigin(0.5),
      );
      return;
    }

    const repeatable = canRepeat(item);
    const count = this.world.inventory.count(item.id);
    const owned = count > 0;
    const hasRoom = this.world.inventory.hasRoom(item.id);
    const affordable = this.world.gold >= item.price;
    const blocked = !hasRoom;
    const enabled = affordable && !blocked;
    const labelText = blocked
      ? repeatable || !owned
        ? '栏位已满'
        : '已拥有'
      : affordable
        ? '购买'
        : '金钱不足';

    const icon = this.add.image(x + width / 2, y + 64, item.textureKey);
    icon.setDisplaySize(70, 70);
    const name = this.add
      .text(x + width / 2, y + 112, item.name, DETAIL_NAME_STYLE)
      .setOrigin(0.5);
    const meta = this.add
      .text(
        x + width / 2,
        y + 134,
        `${CATEGORY_LABEL[item.category]} · ${item.price} 金币`,
        DETAIL_META_STYLE,
      )
      .setOrigin(0.5);

    const descriptionText = getDescriptionText(item);
    const description = this.add.text(x + 16, y + 164, descriptionText, {
      ...DESCRIPTION_STYLE,
      wordWrap: { width: width - 32, useAdvancedWrap: true },
    });
    const flavor = item.flavor
      ? this.add.text(x + 16, description.y + description.height + 10, item.flavor, {
          ...FLAVOR_STYLE,
          wordWrap: { width: width - 32, useAdvancedWrap: true },
        })
      : null;

    const button = {
      x: x + 16,
      y: y + height - 52,
      width: width - 32,
      height: 40,
    };
    const bg = this.add
      .rectangle(
        button.x,
        button.y,
        button.width,
        button.height,
        enabled ? BUY_FILL : DISABLED_FILL,
        1,
      )
      .setOrigin(0)
      .setStrokeStyle(1, enabled ? GOLD : BRONZE, enabled ? 0.9 : 0.6);
    const label = this.add
      .text(button.x + button.width / 2, button.y + button.height / 2, labelText, {
        ...BUY_STYLE,
        color: enabled ? '#f0e6d2' : '#6f7c8c',
      })
      .setOrigin(0.5);

    const statusY = button.y - 20;
    let status = null;
    if (blocked && repeatable) {
      status = this.add
        .text(x + width / 2, statusY, '饰品栏已满 · 不可堆叠', {
          ...STATUS_STYLE,
          color: '#ff8a7a',
        })
        .setOrigin(0.5);
    } else if (blocked) {
      status = this.add
        .text(x + width / 2, statusY, '已拥有 · 不可堆叠', STATUS_STYLE)
        .setOrigin(0.5);
    } else if (owned) {
      status = this.add
        .text(x + width / 2, statusY, `已拥有 ×${count} · 不可堆叠`, OWNED_STYLE)
        .setOrigin(0.5);
    } else if (!affordable) {
      status = this.add
        .text(x + width / 2, statusY, `金钱不足，还差 ${item.price - this.world.gold}`, {
          ...STATUS_STYLE,
          color: '#ff8a7a',
        })
        .setOrigin(0.5);
    }

    if (enabled) {
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerover', () => bg.setFillStyle(BUY_HOVER, 1));
      bg.on('pointerout', () => bg.setFillStyle(BUY_FILL, 1));
      bg.on('pointerdown', () => this.purchase());
    }

    const children = [icon, name, meta, description, bg, label];
    if (flavor) children.push(flavor);
    if (status) children.push(status);
    this.detailLayer.add(children);

    this.buyButton = {
      ...button,
      enabled,
      label: label.text,
      itemId: item.id,
    };
  }

  purchase() {
    if (!this.selectedId) return { ok: false, reason: 'none' };
    const result = this.world.purchaseItem(this.selectedId);
    this.goldText.setText(String(this.world.gold));
    this.layoutGold();
    this.renderList();
    this.renderDetail();
    if (result.ok) {
      this.setNotice(`已购买 ${result.item.name}`, '#8ee08a');
    } else {
      const messages = {
        gold: '金钱不足',
        owned: '已拥有该物品',
        full: '栏位已满',
        closed: '本局已结束',
      };
      this.setNotice(messages[result.reason] || '无法购买', '#ff8a7a');
    }
    return result;
  }

  layoutGold() {
    this.goldLabel.x = this.goldText.x - this.goldText.width - 8;
  }

  setNotice(message, color = '#8b9bb4') {
    this.noticeText.setText(message);
    this.noticeText.setColor(color);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.scene.resume('world');
    this.scene.stop();
  }
}
