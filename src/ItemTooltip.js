import { FONT_FAMILY } from './fonts.js';
import { formatStatValue, getDescriptionBlocks } from './items.js';

const GOLD = 0xc8aa6e;
const BRONZE = 0x785a28;
const DARK = 0x0a1420;

const WIDTH = 380;
const UPGRADE_WIDTH = 300;
const PADDING = 14;
const TITLE_SIZE = 18;
const TITLE_HEIGHT = 24;
const BODY_SIZE = 14;
const BODY_LINE_HEIGHT = 21;
const FLAVOR_SIZE = 13;
const FLAVOR_LINE_HEIGHT = 19;
const PARAGRAPH_GAP = 4;
const FLAVOR_GAP = 9;
const SCREEN_MARGIN = 8;

const PLAIN_COLOR = '#d6dee8';
const FLAVOR_COLOR = '#c3a6ff';
const OLD_VALUE_COLOR = '#93a1b3';
const NEW_VALUE_COLOR = '#8ee08a';
const ARROW_COLOR = '#c8aa6e';
const VALUE_COLORS = {
  interval: '#6fd3ff',
  count: '#8ee08a',
  max: '#ffd166',
  damage: '#ff8a7a',
  chance: '#c3a6ff',
};
const DEFAULT_VALUE_COLOR = '#ffd166';

const TOKEN_PATTERN = /[0-9A-Za-z.%-]+|[\s\S]/gu;
const NO_LINE_START = /^[，。！？、；：）》」』】,.!?;:%)]$/;

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

function formatUpgradeValue(value, format) {
  const text = formatStatValue(value, format);
  return format === 'seconds' ? `${text}秒` : text;
}

/** Rich hover card: item name, description with coloured stats, optional flavour. */
export default class ItemTooltip {
  constructor(scene) {
    this.scene = scene;
    this.container = scene.add
      .container(0, 0)
      .setScrollFactor(0)
      .setDepth(1200) // above the minimap (1090+); the card is transient
      .setVisible(false);
    this.measureContext = document.createElement('canvas').getContext('2d');
    this.visible = false;
    this.mode = null;
    this.item = null;
    this.itemName = null;
    this.runs = [];
    this.flavor = '';
    this.upgrade = null;
    this.bounds = null;
  }

  measure(text, size, style = '') {
    this.measureContext.font = [style, `${size}px`, FONT_FAMILY].filter(Boolean).join(' ');
    return this.measureContext.measureText(text).width;
  }

  normalizeParts(block, item) {
    if (typeof block === 'string') return [{ text: block, color: PLAIN_COLOR }];
    return block.map((part) => {
      if (typeof part === 'string') return { text: part, color: PLAIN_COLOR };
      if (part.stat) {
        return {
          text: formatStatValue(item[part.stat], part.format),
          color: VALUE_COLORS[part.tone] || DEFAULT_VALUE_COLOR,
          bold: true,
          stat: part.stat,
        };
      }
      return { text: part.text || '', color: part.color || PLAIN_COLOR };
    });
  }

  wrap(parts, maxWidth) {
    const lines = [];
    let line = [];
    let width = 0;
    const flush = () => {
      if (line.length) lines.push(line);
      line = [];
      width = 0;
    };

    for (const part of parts) {
      const style = part.bold ? 'bold' : part.italic ? 'italic' : '';
      const tokens = part.text.match(TOKEN_PATTERN) || [];
      for (const token of tokens) {
        const tokenWidth = this.measure(token, BODY_SIZE, style);
        if (line.length && width + tokenWidth > maxWidth && !NO_LINE_START.test(token)) {
          flush();
        }
        if (!line.length && token.trim() === '') continue;

        const last = line[line.length - 1];
        if (
          last &&
          last.color === part.color &&
          !!last.bold === !!part.bold &&
          !!last.italic === !!part.italic
        ) {
          last.text += token;
        } else {
          line.push({
            text: token,
            color: part.color,
            bold: !!part.bold,
            italic: !!part.italic,
            stat: part.stat,
          });
        }
        width += tokenWidth;
      }
    }
    flush();
    return lines;
  }

  prepare(item, stats = item, level = 1) {
    const bodyMaxWidth = WIDTH - PADDING * 2;
    const blocks = getDescriptionBlocks(item, level);
    const blockLines = blocks.map((block) =>
      this.wrap(this.normalizeParts(block, stats), bodyMaxWidth),
    );
    const flavor = typeof item.flavor === 'string' ? item.flavor.trim() : '';
    const flavorLines = flavor
      ? this.wrap([{ text: flavor, color: FLAVOR_COLOR, italic: true }], bodyMaxWidth)
      : [];

    let bodyHeight = 0;
    const bodyLines = [];
    blockLines.forEach((lines, index) => {
      for (const runs of lines) {
        bodyLines.push({ runs, offset: bodyHeight });
        bodyHeight += BODY_LINE_HEIGHT;
      }
      if (index < blockLines.length - 1) bodyHeight += PARAGRAPH_GAP;
    });

    const dividerY = PADDING + TITLE_HEIGHT + 6;
    const bodyY = dividerY + 9;
    const flavorY = bodyY + bodyHeight + FLAVOR_GAP;
    const height = flavor
      ? flavorY + flavorLines.length * FLAVOR_LINE_HEIGHT + PADDING
      : bodyY + bodyHeight + PADDING;

    return {
      bodyLines,
      flavorLines,
      flavor,
      bodyY,
      flavorY,
      dividerY,
      height,
      runs: bodyLines.flatMap((line) => line.runs),
    };
  }

  addText(x, y, text, { size, color, style = '', originX = 0 } = {}) {
    const object = this.scene.add
      .text(x, y, text, {
        fontFamily: FONT_FAMILY,
        fontSize: `${size}px`,
        fontStyle: style,
        color,
      })
      .setScrollFactor(0);
    if (originX !== 0) object.setOrigin(originX, 0);
    this.container.add(object);
    return object;
  }

  addRuns(lines, startY) {
    for (const line of lines) {
      let x = PADDING;
      const y = startY + line.offset;
      for (const run of line.runs) {
        const text = this.addText(x, y, run.text, {
          size: BODY_SIZE,
          color: run.color,
          style: run.bold ? 'bold' : run.italic ? 'italic' : '',
        });
        x += text.width;
      }
    }
  }

  drawFrame(width, height, dividerY) {
    const background = this.scene.add.graphics();
    background.fillStyle(DARK, 0.97);
    background.fillPoints(chamferPoints(0, 0, width, height, 8), true);
    background.lineStyle(1, GOLD, 0.9);
    background.strokePoints(chamferPoints(0, 0, width, height, 8), true);
    background.lineStyle(1, BRONZE, 0.85);
    background.strokePoints(chamferPoints(2, 2, width - 4, height - 4, 6), true);
    background.lineStyle(1, BRONZE, 0.8);
    background.lineBetween(PADDING, dividerY, width - PADDING, dividerY);
    this.container.addAt(background, 0);
  }

  position(anchor, width, height) {
    const screenWidth = this.scene.scale.width;
    const screenHeight = this.scene.scale.height;
    const x = Math.max(
      SCREEN_MARGIN,
      Math.min(anchor.x - width / 2, screenWidth - width - SCREEN_MARGIN),
    );
    let y = anchor.y - height - 14;
    if (y < SCREEN_MARGIN) {
      y = Math.min(anchor.y + anchor.size + 14, screenHeight - height - SCREEN_MARGIN);
    }

    this.bounds = { x, y, width, height };
    this.container.setSize(width, height);
    this.container.setPosition(x, y);
    this.container.setVisible(true);
    this.visible = true;
  }

  show(item, anchor) {
    if (!item) {
      this.hide();
      return;
    }

    const data = this.prepare(item, anchor.stats || item, anchor.level || 1);
    this.container.removeAll(true);
    this.mode = 'item';
    this.item = item;
    this.itemName = item.name;
    this.runs = data.runs;
    this.flavor = data.flavor;
    this.upgrade = null;

    this.drawFrame(WIDTH, data.height, data.dividerY);

    this.addText(PADDING, PADDING, item.name, {
      size: TITLE_SIZE,
      color: '#f0e6d2',
      style: 'bold',
    });
    this.addText(WIDTH - PADDING, PADDING + 4, item.category === 'trinket' ? '饰品' : '武器', {
      size: 12,
      color: '#c8aa6e',
      originX: 1,
    });

    this.addRuns(data.bodyLines, data.bodyY);
    if (data.flavor) {
      data.flavorLines.forEach((runs, lineIndex) => {
        let x = PADDING;
        const y = data.flavorY + lineIndex * FLAVOR_LINE_HEIGHT;
        for (const run of runs) {
          const text = this.addText(x, y, run.text, {
            size: FLAVOR_SIZE,
            color: run.color,
            style: 'italic',
          });
          x += text.width;
        }
      });
    }

    this.position(anchor, WIDTH, data.height);
  }

  /** Compact card for the next weapon level: label plus old -> new numbers. */
  showUpgrade(item, level, changes, anchor) {
    if (!item || !changes || changes.length === 0) {
      this.hide();
      return;
    }

    const maxWidth = UPGRADE_WIDTH - PADDING * 2;
    const parts = [];
    changes.forEach((change, index) => {
      if (index > 0) parts.push({ text: '，', color: PLAIN_COLOR });
      parts.push({ text: `${change.label} `, color: PLAIN_COLOR });
      parts.push({
        text: formatUpgradeValue(change.from, change.format),
        color: OLD_VALUE_COLOR,
      });
      parts.push({ text: ' → ', color: ARROW_COLOR });
      parts.push({
        text: formatUpgradeValue(change.to, change.format),
        color: NEW_VALUE_COLOR,
        bold: true,
      });
    });

    const bodyLines = this.wrap(parts, maxWidth);
    const dividerY = PADDING + TITLE_HEIGHT + 6;
    const bodyY = dividerY + 9;
    const bodyHeight = bodyLines.length * BODY_LINE_HEIGHT;
    const height = bodyY + bodyHeight + PADDING;

    this.container.removeAll(true);
    this.mode = 'upgrade';
    this.item = item;
    this.itemName = item.name;
    this.runs = bodyLines.flat();
    this.flavor = '';
    this.upgrade = { level, changes };

    this.drawFrame(UPGRADE_WIDTH, height, dividerY);
    this.addText(PADDING, PADDING, item.name, {
      size: TITLE_SIZE,
      color: '#f0e6d2',
      style: 'bold',
    });
    this.addText(
      UPGRADE_WIDTH - PADDING,
      PADDING + 4,
      `升级 ${level} → ${level + 1}`,
      { size: 12, color: '#c8aa6e', originX: 1 },
    );

    bodyLines.forEach((runs, lineIndex) => {
      let x = PADDING;
      const y = bodyY + lineIndex * BODY_LINE_HEIGHT;
      for (const run of runs) {
        const text = this.addText(x, y, run.text, {
          size: BODY_SIZE,
          color: run.color,
          style: run.bold ? 'bold' : '',
        });
        x += text.width;
      }
    });

    this.position(anchor, UPGRADE_WIDTH, height);
  }

  hide() {
    this.visible = false;
    this.mode = null;
    this.item = null;
    this.itemName = null;
    this.runs = [];
    this.flavor = '';
    this.upgrade = null;
    this.bounds = null;
    this.container.setVisible(false);
  }
}
