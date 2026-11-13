import { FONT_FAMILY } from './fonts.js';

const GOLD = 0xc8aa6e;
const BRONZE = 0x785a28;
const DARK = 0x0a1420;
const BUTTON_FILL = 0x1e2328;
const BUTTON_HOVER = 0x2c3540;
const BUTTON_ACTIVE = 0x1c3a2a;

const PANEL_WIDTH = 232;
const PANEL_MARGIN = 16;
const PANEL_PADDING = 10;
const TITLE_HEIGHT = 34;
const BUTTON_HEIGHT = 34;
const BUTTON_GAP = 6;
const STATUS_HEIGHT = 20;

const TEXT_STYLE = {
  fontFamily: FONT_FAMILY,
  fontSize: '14px',
  color: '#f0e6d2',
};
const TITLE_STYLE = {
  fontFamily: FONT_FAMILY,
  fontSize: '14px',
  fontStyle: 'bold',
  color: '#c8aa6e',
};
const STATUS_STYLE = {
  fontFamily: FONT_FAMILY,
  fontSize: '12px',
  color: '#8c8f94',
};

const BUTTONS = [
  { id: 'spawn', label: '刷出当前敌人' },
  { id: 'clear', label: '清空场上敌人' },
  { id: 'hpLock', label: '生命锁定：关' },
  { id: 'heal', label: '回满生命' },
  { id: 'gold', label: '金钱 +100' },
  { id: 'xp', label: '经验 +500' },
  { id: 'tier', label: '进入下一难度' },
  { id: 'end', label: '结束本局' },
];

export default class DevConsole {
  constructor(scene) {
    this.scene = scene;
    this.buttons = new Map();

    const x = scene.scale.width - PANEL_MARGIN - PANEL_WIDTH;
    const y = PANEL_MARGIN;
    const buttonX = x + PANEL_PADDING;
    const buttonWidth = PANEL_WIDTH - PANEL_PADDING * 2;
    const panelHeight =
      TITLE_HEIGHT +
      BUTTONS.length * BUTTON_HEIGHT +
      (BUTTONS.length - 1) * BUTTON_GAP +
      8 +
      STATUS_HEIGHT +
      PANEL_PADDING;

    this.root = scene.add.container(0, 0).setScrollFactor(0).setDepth(1500);

    this.bounds = { x, y, width: PANEL_WIDTH, height: panelHeight };

    const panel = scene.add
      .rectangle(x, y, PANEL_WIDTH, panelHeight, DARK, 0.94)
      .setOrigin(0)
      .setStrokeStyle(1, BRONZE);
    this.panel = panel;
    const title = scene.add.text(x + PANEL_PADDING, y + 10, '测试控制台', TITLE_STYLE);
    const tag = scene.add
      .text(x + PANEL_WIDTH - PANEL_PADDING, y + 10, 'DEV', {
        ...STATUS_STYLE,
        color: '#c8aa6e',
      })
      .setOrigin(1, 0);
    const divider = scene.add
      .rectangle(x + PANEL_PADDING, y + TITLE_HEIGHT - 4, buttonWidth, 1, GOLD, 0.45)
      .setOrigin(0, 0.5);

    const children = [panel, title, tag, divider];

    BUTTONS.forEach(({ id, label }, index) => {
      const buttonY = y + TITLE_HEIGHT + 4 + index * (BUTTON_HEIGHT + BUTTON_GAP);
      const rect = scene.add
        .rectangle(buttonX, buttonY, buttonWidth, BUTTON_HEIGHT, BUTTON_FILL, 1)
        .setOrigin(0)
        .setStrokeStyle(1, 0x3c3220)
        .setInteractive({ useHandCursor: true });
      const text = scene.add
        .text(buttonX + buttonWidth / 2, buttonY + BUTTON_HEIGHT / 2, label, TEXT_STYLE)
        .setOrigin(0.5);

      const entry = { id, rect, text, active: false };
      rect.on('pointerover', () => {
        if (!entry.active) rect.setFillStyle(BUTTON_HOVER, 1);
      });
      rect.on('pointerout', () => {
        if (!entry.active) rect.setFillStyle(BUTTON_FILL, 1);
      });
      rect.on('pointerdown', () => this.run(id));

      this.buttons.set(id, entry);
      children.push(rect, text);
    });

    const statusY = y + panelHeight - STATUS_HEIGHT - PANEL_PADDING + 2;
    this.statusText = scene.add
      .text(x + PANEL_PADDING, statusY, '开发模式 · 仅测试用', {
        ...STATUS_STYLE,
        wordWrap: { width: buttonWidth },
      })
      .setOrigin(0);
    children.push(this.statusText);

    for (const child of children) child.setScrollFactor(0);
    this.root.add(children);
  }

  run(id) {
    switch (id) {
      case 'spawn':
        this.spawnEnemy();
        break;
      case 'clear':
        this.clearEnemies();
        break;
      case 'hpLock':
        this.toggleHpLock();
        break;
      case 'heal':
        this.scene.restoreHp();
        this.setStatus('生命值已回满');
        break;
      case 'gold':
        this.scene.addGold(100);
        this.setStatus(`金钱 +100（当前 ${this.scene.gold}）`);
        break;
      case 'xp':
        this.scene.addXp(500);
        this.scene.hud.setXp(this.scene.level, this.scene.xp, this.scene.xpToNext);
        this.setStatus(`经验 +500（当前等级 ${this.scene.level}）`);
        break;
      case 'tier':
        this.advanceTier();
        break;
      case 'end':
        this.scene.endGame();
        break;
      default:
        break;
    }
  }

  spawnEnemy() {
    const zombie = this.scene.zombieManager.spawn();
    this.setStatus(
      zombie ? `已刷出：${zombie.config.name}` : '刷怪失败：人口已满或无可用位置',
    );
  }

  clearEnemies() {
    const count = this.scene.zombieManager.clear();
    this.setStatus(`已清空 ${count} 个敌人`);
  }

  toggleHpLock() {
    const locked = this.scene.toggleHpLock();
    this.setButtonLabel('hpLock', `生命锁定：${locked ? '开' : '关'}`);
    this.setButtonActive('hpLock', locked);
    this.setStatus(locked ? '主角生命已锁定' : '主角生命已解锁');
  }

  advanceTier() {
    const tier = this.scene.skipToNextTier();
    this.setStatus(tier ? `当前难度：${tier.name}` : '已是最高难度');
  }

  setStatus(message) {
    this.statusText.setText(message);
  }

  setButtonLabel(id, label) {
    const entry = this.buttons.get(id);
    if (entry) entry.text.setText(label);
  }

  setButtonActive(id, active) {
    const entry = this.buttons.get(id);
    if (!entry) return;

    entry.active = active;
    entry.rect.setFillStyle(active ? BUTTON_ACTIVE : BUTTON_FILL, 1);
    entry.rect.setStrokeStyle(1, active ? 0x3fa06a : 0x3c3220);
  }

  setVisible(visible) {
    this.root.setVisible(visible);
  }

  setAlpha(alpha) {
    this.root.setAlpha(alpha);
  }
}
